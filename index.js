const express = require('express');
const multer = require('multer');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal'); // <-- Import this again

dotenv.config();

const app = express();
const upload = multer();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        // printQRInTerminal: true is REMOVED
    });

    sock.ev.on('connection.update', (update) => {
        // Destructure 'qr' from the update payload
        const { connection, lastDisconnect, qr } = update;
        
        // MANUALLY print the QR code if it exists in the update
        if (qr) {
            console.log('\n--- 📱 Scan this QR code with your WhatsApp app ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Socket is securely connected via Baileys!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/webhook/jotform', upload.none(), async (req, res) => {
    try {
        console.log('\n--- ===== PROCESSING NEW SUBMISSION ===== ---');

        // 1. Start with the default body
        let formData = req.body;

        // 2. If Jotform sent a 'rawRequest' string, parse it and merge it
        if (req.body.rawRequest) {
            try {
                const parsedRaw = JSON.parse(req.body.rawRequest);
                formData = { ...formData, ...parsedRaw };
            } catch (err) {
                console.log('Error parsing rawRequest:', err.message);
            }
        }

        // Helper function to strip out weird escaped quotes Jotform sometimes adds
        const cleanString = (str) => {
            if (!str) return undefined;
            return typeof str === 'string' ? str.replace(/\\"/g, '').replace(/"/g, '').trim() : str;
        };

        // 3. Extract IDs securely from the parsed formData
        const formId = formData.formID;
        const submissionId = formData.submissionID;
        const uniqueId = cleanString(formData.q8_uniqueId); 
        const assignedTechName = cleanString(formData.q71_assignedTo71); 
        const detailsofwork = cleanString(formData.q17_detailsOf)
        const CREWNumber = cleanString(formData.q40_typeA)

        console.log(`Form ID: ${formId}`);
        console.log(`Submission ID: ${submissionId}`);
        console.log(`Unique ID: ${uniqueId}`);
        console.log(`Assigned Tech Field Value: ${assignedTechName}`);

        // If no technician is assigned yet, stop here
        if (!assignedTechName) {
            console.log('No technician assigned in this event. Skipping database lookup.');
            return res.status(200).send('No technician assigned.');
        }

        // 4. Look up the technician data in Supabase
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

        // 5. Format phone and construct WhatsApp JID
        const formattedPhone = technician.phone.replace(/\D/g, ''); 
        const jid = `${formattedPhone}@s.whatsapp.net`; 
        
        const messageText = `*New ARN Assigned to ${assignedTechName}!*\n\n*ARN:* ${uniqueId || 'N/A'}\n*Details of Work:* ${submissionId}\n*CREW Serial Number:* ${CREWNumber}\n\nYou have been assigned a new task. Please check your dashboard for details.`;

        // 6. Send the message via Baileys socket
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