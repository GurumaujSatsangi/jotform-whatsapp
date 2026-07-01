const express = require('express');
const multer = require('multer');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

dotenv.config();

const app = express();
const upload = multer();

// 1. Initialize Supabase Client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Global variable to hold the active WhatsApp socket
let sock;

// 3. Initialize Baileys WhatsApp Connection
async function connectToWhatsApp() {
    // This helper saves and loads the login session securely
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Automatically prints the QR code to your Render logs
    });

    // Listen for connection updates (QR code, connected, disconnected)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp connection closed due to', lastDisconnect.error, ', reconnecting:', shouldReconnect);
            // Reconnect if not explicitly logged out
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Socket is securely connected via Baileys!');
        }
    });

    // Save credentials whenever they are updated
    sock.ev.on('creds.update', saveCreds);
}

// Start the WhatsApp connection process
connectToWhatsApp();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/webhook/jotform', upload.none(), async (req, res) => {
    try {
        console.log('\n--- ===== PROCESSING NEW SUBMISSION ===== ---');

        const formId = req.body.formID;
        const submissionId = req.body.submissionID;
        const uniqueId = req.body.q8_uniqueId; 
        const assignedTechName = req.body.q71_assignedTo71;

        console.log(`Form ID: ${formId}`);
        console.log(`Submission ID: ${submissionId}`);
        console.log(`Assigned Tech: ${assignedTechName}`);

        if (!assignedTechName) {
            console.log('No technician assigned. Skipping.');
            return res.status(200).send('No technician assigned.');
        }

        // Look up the technician data in Supabase
        const { data: technician, error } = await supabase
            .from('technicians')
            .select('phone') 
            .eq('form_id', formId)
            .eq('name', assignedTechName)
            .single();

        if (error || !technician) {
            console.error(`Database Lookup Failed for Form ${formId}:`, error?.message);
            return res.status(200).send('Webhook received, but technician data not found.');
        }

        console.log(`Database Phone: ${technician.phone}`);

        // Clean the phone number to strictly digits
        const formattedPhone = technician.phone.replace(/\D/g, ''); 
        
        // Baileys requires the '@s.whatsapp.net' suffix
        const jid = `${formattedPhone}@s.whatsapp.net`; 
        
        const messageText = `🛠️ *New Job Assignment*\n\n*Task ID:* ${uniqueId || 'N/A'}\n*Submission:* ${submissionId}\n\nYou have been assigned a new task. Please check your dashboard for details.`;

        // Make sure the socket is actually connected before sending
        if (sock) {
            await sock.sendMessage(jid, { text: messageText });
            console.log(`✅ WhatsApp notification sent successfully to ${assignedTechName} at ${formattedPhone}`);
        } else {
            console.error('WhatsApp socket is not initialized yet!');
        }
        
        console.log('--- ======================================== --- \n');
        res.status(200).send('Payload successfully processed.');

    } catch (error) {
        console.error('Error handling webhook workflow:', error);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server executing smoothly on port ${PORT}`));