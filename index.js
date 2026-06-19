const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const multer = require('multer');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const technicianDirectory = {
  Gurumauj: '919875691340',
  Parul: '916289682035'
};

const upload = multer().none();

let sock;

async function connectToWhatsApp() {
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
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connection established and ready to send messages!');
    }
  });
}

app.post('/jotform-webhook', upload, async (req, res) => {
  try {
    const rawRequest = req.body && req.body.rawRequest;

    if (!rawRequest) {
      return res.status(400).send('Invalid payload: Missing rawRequest');
    }

    console.log('Parsed Form Data:', JSON.parse(req.body.rawRequest));

    const rawData = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;
    const techName = rawData.q76_assignedTo;
    const jobDetails = rawData.q17_detailsOf;
    const address = rawData.q69_room;
    const jobId = rawData.q8_uniqueId;

    const techPhone = technicianDirectory[techName];

    if (!techPhone) {
      return res.status(400).send('Technician mapping not found');
    }

    const jid = `${techPhone}@s.whatsapp.net`;
    const message = `*New ARN Assigned: ${jobId}*\n\n*Technician:* ${techName}\n*Room:* ${address}\n*Issue:* ${jobDetails}`;
    await sock.sendMessage(jid, { text: message });
    return res.status(200).send('Success');
  } catch (error) {
    console.error('Error processing incoming webhook:', error);
    return res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook listener active on port ${PORT}`);
  connectToWhatsApp();
});