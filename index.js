const express = require('express');
const { default: makeWASocket, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- DATABASE CONFIGURATION ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('CRITICAL ERROR: Supabase credentials missing from environment variables.');
}
const supabase = createClient(supabaseUrl, supabaseKey);

const technicianDirectory = {
  "TAPAN SAHA- Himgiri, M-9734779358": '919734779358',
  "AYON DAS - Himgiri, M-9674705548": '919674705548'
};

const upload = multer().none();

let sock;

// --- CUSTOM SUPABASE AUTH ADAPTER ---
// This replaces useMultiFileAuthState to save session keys in PostgreSQL
async function useSupabaseAuthState(sessionId = 'session1') {
    const writeData = async (data, id) => {
        const jsonString = JSON.stringify(data, BufferJSON.replacer);
        await supabase.from('wa_auth_state').upsert({ id: `${sessionId}-${id}`, data: jsonString });
    };

    const readData = async (id) => {
        const { data, error } = await supabase.from('wa_auth_state').select('data').eq('id', `${sessionId}-${id}`).single();
        if (data && data.data) {
            return JSON.parse(data.data, BufferJSON.reviver);
        }
        return null;
    };

    const removeData = async (id) => {
        await supabase.from('wa_auth_state').delete().eq('id', `${sessionId}-${id}`);
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

// --- WHATSAPP CONNECTION LOGIC ---
async function connectToWhatsApp() {
  const { state, saveCreds } = await useSupabaseAuthState();

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
      console.log('✅ WhatsApp connection established using Supabase Auth!');
    }
  });
}

// --- WEBHOOK ENDPOINT ---
app.post('/jotform-webhook', upload, async (req, res) => {
  try {
    const rawRequest = req.body && req.body.rawRequest;

    if (!rawRequest) {
      return res.status(400).send('Invalid payload: Missing rawRequest');
    }

    const rawData = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;
    
    // Extract fields
    const selectedTechsRaw = rawData.q76_assignedTo;
    const jobDetails = rawData.q17_detailsOf;
    const address = rawData.q69_room;
    const jobId = rawData.q8_uniqueId;
    const crewSerialnumber = rawData.crew;

    let techsArray = [];
    if (Array.isArray(selectedTechsRaw)) {
        techsArray = selectedTechsRaw;
    } else if (typeof selectedTechsRaw === 'string') {
        techsArray = [selectedTechsRaw];
    } else {
        console.log('No technicians were selected.');
        return res.status(400).send('No technicians selected');
    }

    let sentCount = 0;
    
    for (const techName of techsArray) {
        const cleanTechName = techName.trim(); 
        const techPhone = technicianDirectory[cleanTechName];

        if (!techPhone) {
            console.log(`⚠️ Technician mapping not found for: ${cleanTechName}`);
            continue; 
        }

        const jid = `${techPhone}@s.whatsapp.net`;
        const message = `*New ARN Assigned: ${jobId}*\n\n*Technician:* ${cleanTechName}\n*Room:* ${address}\n*Issue:* ${jobDetails}`;
        
        try {
            await sock.sendMessage(jid, { text: message });
            console.log(`✅ Message successfully sent to ${cleanTechName}`);
            sentCount++;
        } catch (err) {
            console.error(`❌ Failed to send message to ${cleanTechName}:`, err);
        }
    }

    return res.status(200).send(`Processed successfully. Messages sent: ${sentCount}`);
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