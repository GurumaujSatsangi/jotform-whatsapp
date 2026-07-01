const express = require('express');
const multer = require('multer'); // Import multer

const app = express();

// Configure multer to parse multipart/form-data (text fields only)
const upload = multer();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Add the upload.none() middleware to the route
app.post('/webhook/jotform', upload.none(), (req, res) => {
    console.log('\n--- ===== NEW JOTFORM PAYLOAD RECEIVED ===== ---');
    
    // The payload will now be correctly parsed and visible
    console.log(JSON.stringify(req.body, null, 2));
    
    console.log('--- ======================================== --- \n');

    res.status(200).send('Payload successfully logged!');
});

// Render defaults to port 10000 as seen in your logs
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Debug server running on port ${PORT}`);
});