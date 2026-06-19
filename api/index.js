const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
// Parse both URL-encoded and raw JSON bodies sent by Jotform
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CONFIGURATION ---
// The keys MUST exactly match the Dropdown options in your Jotform.
// The values must include the country code with NO '+' or spaces.
const technicianDirectory = {
    "Gurumauj": "919875691340",
    "Parul": "916289682035"
};

let sock; // Global variable to hold the active WhatsApp socket session

// --- WHATSAPP CONNECTION LOGIC ---
async function connectToWhatsApp() {
    // Stores session keys locally so you only have to scan the QR code once
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        // Disable built-in QR printing to let qrcode-terminal handle it cleanly
        printQRInTerminal: false, 
        logger: pino({ level: 'silent' }) // Keeps the terminal clean of Baileys internal logs
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Render the QR code safely if it's generated
        if (qr) {
            console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP LINKED DEVICES ---');
            qrcode.generate(qr, { small: true });
            console.log('-------------------------------------------------------\n');
        }

        if (connection === 'close') {
            // Reconnect if it wasn't a manual logout (status code 401)
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
            console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection established and ready to send messages!');
        }
    });
}

// --- JOTFORM WEBHOOK ENDPOINT ---
app.post('/jotform-webhook', async (req, res) => {
    try {
        if (!req.body.rawRequest) {
            console.log('❌ Received empty webhook or missing rawRequest payload.');
            return res.status(400).send('Invalid payload: Missing rawRequest');
        }

        // Jotform packages form data inside a stringified JSON object called 'rawRequest'
        const rawData = JSON.parse(req.body.rawRequest);
        
        // Extract fields using their exact "Unique Names" from Jotform
        const techName = rawData.q1_assignedTechnician; 
        const jobDetails = rawData.q2_jobDescription;   
        const address = rawData.q3_clientAddress;       

        const techPhone = technicianDirectory[techName];

        if (!techPhone) {
            console.log(`⚠️ Webhook triggered, but technician "${techName}" is not in your index.js directory.`);
            return res.status(444).send('Technician mapping not found');
        }

        // Format the destination ID for the WhatsApp Network
        const jid = `${techPhone}@s.whatsapp.net`;
        
        // Build the formatted text notification
        const message = `*🔧 New Job Assignment*\n\n*Technician:* ${techName}\n*Details:* ${jobDetails}\n*Location:* ${address}\n\nPlease acknowledge receipt by replying to this message.`;

        // Send the message instantly
        await sock.sendMessage(jid, { text: message });
        console.log(`🚀 Dispatch message successfully sent to ${techName} (${techPhone})`);
        
        // Respond to Jotform immediately to avoid timeout retries
        res.status(200).send('Success');

    } catch (error) {
        console.error('❌ Error processing incoming webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Start the application
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Webhook listener active on port ${PORT}`);
    connectToWhatsApp();
});
