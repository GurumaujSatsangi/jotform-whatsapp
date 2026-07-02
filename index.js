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

// 1. Define your Form Configuration Map
const formConfig = {
    // Your First Form
    '231359001898460': { 
        techField: 'q71_assignedTo71', 
        uniqueIdField: 'q8_uniqueId',
        detailsField: 'q17_detailsOf',
        serialField: 'q40_typeA',
        roomField: 'q48_roomNo'
    },
    // Your New Form (From Postman Payload)
    '242663164559464': { 
        techField: 'q69_assignedTo69', 
        uniqueIdField: 'q93_typeA',
        detailsField: 'q70_detailsOf',
        serialField: 'q40_crewserialnumber',
        roomField: 'q48_roomNo'
    },
    '242431311316442':{

        techField: 'q70_assignedTo70', 
        uniqueIdField: 'q8_uniqueId',
        detailsField: 'q17_detailsOf',
        roomField: 'q69_room'

    },
    '233044875347461':{

        techField: 'q60_assignedTo', 
        uniqueIdField: 'q8_uniqueId',
        detailsField: 'q17_detailsOf'

    },
    '242565520915457':{

        techField: 'q59_assignedTo59', 
        uniqueIdField: 'q8_uniqueId',
        detailsField: 'q17_detailsOf'

    },
    '261594476733468':{

        techField: 'q70_assignedTo70', 
        uniqueIdField: 'q8_uniqueId',
        detailsField: 'q17_detailsOf',
        roomField: 'q69_room'


    }
};

app.post('/webhook/jotform', upload.none(), async (req, res) => {
    try {
        console.log('\n--- ===== PROCESSING NEW SUBMISSION ===== ---');

        let formData = req.body;

        // Parse buried rawRequest data if present
        if (req.body.rawRequest) {
            try {
                const parsedRaw = JSON.parse(req.body.rawRequest);
                formData = { ...formData, ...parsedRaw };
            } catch (err) {
                console.log('Error parsing rawRequest:', err.message);
            }
        }

        const formId = formData.formID;
        const config = formConfig[formId];

        if (!config) {
            console.log(`Form ID ${formId} is not configured in our map. Skipping.`);
            return res.status(200).send('Ignored unconfigured form.');
        }

        // Helper function to extract array items and strip out weird escaped quotes
        // Helper function to handle arrays and strip out weird escaped quotes
const extractValue = (val) => {
    if (!val) return undefined;
    if (Array.isArray(val)) val = val[0]; 
    return typeof val === 'string' ? val.replace(/\\"/g, '').replace(/"/g, '').trim() : val;
};

// 2. Extract values dynamically based on the form config map
const submissionId = formData.submissionID;

// Define a helper to safely extract fields
const getField = (fieldName) => {
    if (!config[fieldName]) return 'N/A'; // Return N/A if field is missing from config
    const key = config[fieldName];
    const rawVal = formData[key] || formData[key.replace(/q\d+_/, '')];
    const val = extractValue(rawVal);
    return val || 'N/A'; // Return N/A if field is empty in payload
};

const assignedTechName = getField('techField');
const uniqueId = getField('uniqueIdField');
const detailsofwork = getField('detailsField');
const CREWNumber = getField('serialField');
const RoomNumber = getField('roomField');

        console.log(`Form ID: ${formId}`);
        console.log(`Submission ID: ${submissionId}`);
        console.log(`Unique ID (ARN): ${uniqueId}`);
        console.log(`Assigned Tech: ${assignedTechName}`);
        console.log(`Details of Work: ${detailsofwork}`);
        console.log(`Serial Number: ${CREWNumber}`);

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
            console.error(`Database Lookup Failed for Form ${formId}:`, error?.message);
            return res.status(200).send('Webhook received, but technician data not found.');
        }

        console.log(`Database Phone: ${technician.phone}`);

        // 4. Format phone and construct WhatsApp JID
        const formattedPhone = technician.phone.replace(/\D/g, ''); 
        const jid = `${formattedPhone}@s.whatsapp.net`; 
        
        // 5. Construct the dynamic WhatsApp message
        const messageText = `*New ARN Assigned to ${assignedTechName}!*\n\n*ARN:* ${uniqueId || 'N/A'}\n*Details of Work:* ${detailsofwork || 'N/A'}\n*CREW Serial Number:* ${CREWNumber || 'N/A'}\n*Room No.:* ${RoomNumber || 'N/A'}\n\nThis is a job assignment notification. Please log in to the Technician dashboard to view the job details and collect the hard copy of the Job Card.`;

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