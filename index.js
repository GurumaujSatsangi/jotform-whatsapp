const express = require('express');
const multer = require('multer');
const dotenv = require ('dotenv')
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer();

// 1. Initialize Supabase Client
// Replace these with your actual Supabase URL and Anon/Service Key
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/webhook/jotform', upload.none(), async (req, res) => {
    try {
        console.log('\n--- ===== PROCESSING NEW SUBMISSION ===== ---');

        // 2. Extract IDs directly from the parsed multipart body
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

        // 3. Look up the technician data in Supabase based on formId and technician name
        // Assuming your table is named 'technicians' and has columns: 'form_id', 'name', 'phone'
        const { data: technician, error } = await supabase
            .from('technicians')
            .select('phone') 
            .eq('form_id', formId)
            .eq('name', assignedTechName)
            .single(); // Expecting exactly one matching record

        if (error || !technician) {
            console.error(`Database Lookup Failed or Tech Not Found for Form ${formId}:`, error?.message);
            return res.status(200).send('Webhook received, but technician data not found in Supabase.');
        }

        console.log(`Successfully fetched technician details from Supabase!`);
        console.log(`Phone: ${technician.phone}`);

        // 4. NEXT STEP: Send the WhatsApp notification using technician.phone
        // (We will plug the whatsapp-web.js logic right here)
        
        console.log('--- ======================================== --- \n');
        res.status(200).send('Payload successfully processed and database queried.');

    } catch (error) {
        console.error('Error handling webhook workflow:', error);
        res.status(500).send('Internal Server Error');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server executing smoothly on port ${PORT}`));