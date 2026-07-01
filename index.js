const express = require('express');
const multer = require('multer');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

dotenv.config(); // Initialize dotenv to load your environment variables

const app = express();
const upload = multer();

// 1. Initialize Supabase Client
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(), // Saves session locally so you only scan QR once
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for cloud environments like Render
    }
});

client.on('qr', (qr) => {
    console.log('\n--- Scan this QR code with your WhatsApp app ---');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready and authenticated!');
});

client.on('auth_failure', msg => {
    console.error('WhatsApp Authentication failure:', msg);
});

// Start the WhatsApp client connection
client.initialize();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/webhook/jotform', upload.none(), async (req, res) => {
    try {
        console.log('\n--- ===== PROCESSING NEW SUBMISSION ===== ---');

        // Extract IDs directly from the parsed multipart body
        const formId = req.body.formID;
        const submissionId = req.body.submissionID;
        const uniqueId = req.body.q8_uniqueId; // e.g., "WS/AC/0002556"
        const assignedTechName = req.body.q71_assignedTo71; // The selected technician name

        console.log(`Form ID: ${formId}`);
        console.log(`Submission ID: ${submissionId}`);
        console.log(`Unique ID: ${uniqueId}`);
        console.log(`Assigned Tech Field Value: ${assignedTechName}`);

        // If no technician is assigned yet, stop here so we don't query unnecessarily
        if (!assignedTechName) {
            console.log('No technician assigned in this event. Skipping database lookup.');
            return res.status(200).send('No technician assigned.');
        }

        // 3. Look up the technician data in Supabase
        const { data: technician, error } = await supabase
            .from('technicians')
            .select('phone') 
            .eq('form_id', formId)
            .eq('name', assignedTechName)
            .single();

        if (error || !technician) {
            console.error(`Database Lookup Failed or Tech Not Found for Form ${formId}:`, error?.message);
            return res.status(200).send('Webhook received, but technician data not found in Supabase.');
        }

        console.log(`Successfully fetched technician details from Supabase!`);
        console.log(`Raw Database Phone: ${technician.phone}`);

        // 4. Send the WhatsApp notification
        // Clean the phone number (remove any '+', spaces, or dashes from the database record)
        const formattedPhone = technician.phone.replace(/\D/g, ''); 
        
        // Append '@c.us' as required by whatsapp-web.js
        const chatId = `${formattedPhone}@c.us`; 
        
        // Draft the message content using your Jotform data
        const message = `🛠️ *New Job Assignment*\n\n*Task ID:* ${uniqueId || 'N/A'}\n*Submission:* ${submissionId}\n\nYou have been assigned a new task. Please check your dashboard for details.`;

        // Dispatch the message
        await client.sendMessage(chatId, message);
        console.log(`✅ WhatsApp notification sent successfully to ${assignedTechName} at ${formattedPhone}`);
        
        console.log('--- ======================================== --- \n');
        res.status(200).send('Payload successfully processed, database queried, and message sent.');

    } catch (error) {
        console.error('Error handling webhook workflow:', error);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server executing smoothly on port ${PORT}`));