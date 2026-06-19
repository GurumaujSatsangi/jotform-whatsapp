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
    console.error('❌ CRITICAL ERROR: Supabase credentials missing from environment variables.');
} else {
    console.log('✅ Supabase credentials detected.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const technicianDirectory = {
  "TAPAN SAHA- Himgiri, M-9734779358": '919734779358',
  "AYON DAS - Himgiri, M-9674705548": '919674705548',
  "Test":'916289682035'
};

const upload = multer().none();

let sock;

// --- CUSTOM SUPABASE AUTH ADAPTER ---
async function useSupabaseAuthState(sessionId = 'session1') {
    const writeData = async (data, id) => {
        try {
            const jsonString = JSON.stringify(data, BufferJSON.replacer);
            const { error } = await supabase.from('wa_auth_state').upsert({ id: `${sessionId}-${id}`, data: jsonString });
            if (error) console.error(`❌ Supabase Write Error [${id}]:`, error.message);
        } catch (err) {
            console.error(`❌ Supabase Write Exception [${id}]:`, err.message);
        }
    };

    const readData = async (id) => {
        try {
            const { data, error } = await supabase.from('wa_auth_state').select('data').eq('id', `${sessionId}-${id}`).single();
            if (error && error.code !== 'PGRST116') { 
                // Ignore PGRST116 (No rows found), log everything else
                console.error(`❌ Supabase Read Error [${id}]:`, error.message);
            }
            if (data && data.data) {
                return JSON.parse(data.data, BufferJSON.reviver);
            }
            return null;
        } catch (err) {
            console.error(`❌ Supabase Read Exception [${id}]:`, err.message);
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            const { error } = await supabase.from('wa_auth_state').delete().eq('id', `${sessionId}-${id}`);
            if (error) console.error(`❌ Supabase Delete Error [${id}]:`, error.message);
        } catch (err) {
            console.error(`❌ Supabase Delete Exception [${id}]:`, err.message);
        }
    };

    console.log('🔄 Fetching existing WhatsApp credentials from Supabase...');
    const creds = (await readData('creds')) || initAuthCreds();
    console.log('✅ Credentials fetched/initialized successfully.');

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
  console.log('🚀 Initializing WhatsApp connection...');
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
      console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect);
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
    const selectedTechsRaw = rawData.assignedTo69;
    const jobDetails = rawData.detailsOf;
    const address = rawData.roomNo;
    const jobId = rawData.typeA;
    const crewSerialnumber = rawData.crewserialnumber;

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
        // I noticed you extracted crewSerialnumber but didn't put it in the message. You can add it here if needed!
        const message = `*New ARN Assigned: ${jobId}*\n\n*Technician:* ${cleanTechName}\n*Room:* ${address}\n*Issue:* ${jobDetails}`;
        
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
  console.log(`🌐 Webhook listener active on port ${PORT}`);
  // Catch top-level WhatsApp connection failures (like Supabase refusing to connect entirely)
  connectToWhatsApp().catch(err => {
      console.error("❌ FATAL STARTUP ERROR IN WHATSAPP CONNECTION:", err);
  });
});