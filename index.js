const express = require('express');
const app = express();

// Jotform sends data as URL-encoded form data by default
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Logging Webhook Endpoint
app.post('/webhook/jotform', (req, res) => {
    console.log('\n--- ===== NEW JOTFORM PAYLOAD RECEIVED ===== ---');
    
    // Print the entire body object to see all fields (like 'q169_assigned_to')
    console.log(JSON.stringify(req.body, null, 2));
    
    console.log('--- ======================================== --- \n');

    // Always return a 200 success code to Jotform so it stops retrying
    res.status(200).send('Payload successfully logged!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Debug server running on port ${PORT}`);
    console.log(`Point your Jotform webhook to: http://<your-public-url>/webhook/jotform`);
});