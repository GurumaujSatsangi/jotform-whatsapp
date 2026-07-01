const express = require('express');
const app = express();

// Jotform sends data as URL-encoded form data by default
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const technicianDirectory = {
  "TAPAN SAHA- Himgiri, M-9734779358": '919734779358',
  "AYON DAS - Himgiri, M-9674705548": '919674705548',
  "Test":'916289682035'
};

const upload = multer().none();

let sock;

// --- WHATSAPP CONNECTION LOGIC ---
async function connectToWhatsApp() {
  console.log('🚀 Initializing WhatsApp connection using local storage...');
  
  // Reverted back to local folder auth
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n--- SCAN THIS QR CODE WITH WHATSAPP LINKED DEVICES ---');
      qrcode.generate(qr, { small: true });
      console.log('-------------------------------------------------------\n');
    }

    if (connection === 'close') {
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

// --- PING ROUTE FOR CRON-JOB.ORG ---
app.get('/ping', (req, res) => {
    // Cron job hits this every 14 minutes to prevent Render from sleeping
    res.status(200).send('Server is awake');
});

// --- WEBHOOK ENDPOINT ---
app.post('/jotform-webhook', upload, async (req, res) => {
  try {
    console.log('🔔 Incoming Webhook Triggered!');
    
    const rawRequest = req.body && req.body.rawRequest;

    if (!rawRequest) {
      console.log('❌ Webhook rejected: Missing rawRequest. Body was:', req.body);
      return res.status(400).send('Invalid payload: Missing rawRequest');
    }

    const rawData = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;
    
    // --- MASSIVE LOG TO SEE JOTFORM KEYS ---
    console.log('\n--- PARSED JOTFORM DATA ---');
    console.log(JSON.stringify(rawData, null, 2));
    console.log('---------------------------\n');

    // Extract fields
    const selectedTechsRaw = rawData.q69_assignedTo69;
    const jobDetails = rawData.q70_detailsOf;
    const address = rawData.q48_roomNo;
    const jobId = rawData.q93_typeA;

    let techsArray = [];
    if (Array.isArray(selectedTechsRaw)) {
        techsArray = selectedTechsRaw;
    } else if (typeof selectedTechsRaw === 'string') {
        techsArray = [selectedTechsRaw];
    } else {
        console.log(`❌ No technicians found in 'assignedTo69'. Value was:`, selectedTechsRaw);
        return res.status(400).send('No technicians selected');
    }

    let sentCount = 0;
    
    for (const techName of techsArray) {
        const cleanTechName = techName.trim(); 
        const techPhone = technicianDirectory[cleanTechName];

        if (!techPhone) {
            console.log(`⚠️ Technician mapping not found in directory for: "${cleanTechName}"`);
            continue; 
        }

        const jid = `${techPhone}@s.whatsapp.net`;
        const message = `*New ARN Assigned: ${jobId}*\n\n*Assigned To:* ${cleanTechName}\n*Room Number:* ${address}\n*Details of Work:* ${jobDetails}\n*CREW Serial Number:* ${jobId}\n\n*Please login to the Technician Panel.`;
        
        try {
            await sock.sendMessage(jid, { text: message });
            console.log(`✅ Message successfully sent to ${cleanTechName}`);
            sentCount++;
        } catch (err) {
            console.error(`❌ Failed to send message to ${cleanTechName} via Baileys:`, err);
        }
    }

    return res.status(200).send(`Processed successfully. Messages sent: ${sentCount}`);
  } catch (error) {
    console.error('❌ FATAL Error processing incoming webhook:', error);
    return res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Debug server running on port ${PORT}`);
    console.log(`Point your Jotform webhook to: http://<your-public-url>/webhook/jotform`);
});
