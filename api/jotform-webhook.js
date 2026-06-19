const axios = require('axios');

const technicianDirectory = {
  Gurumauj: '919875691340',
  Parul: '916289682035'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawRequest = req.body && req.body.rawRequest;

    if (!rawRequest) {
      return res.status(400).json({ error: 'Invalid payload: Missing rawRequest' });
    }

    const payload = typeof rawRequest === 'string' ? JSON.parse(rawRequest) : rawRequest;

    const technicianName = payload.q1_assignedTechnician;
    const jobDescription = payload.q2_jobDescription;
    const clientAddress = payload.q3_clientAddress;

    const technicianPhone = technicianDirectory[technicianName];

    if (!technicianPhone) {
      return res.status(400).json({ error: 'Technician mapping not found' });
    }

    const textbeeUrl = `https://api.textbee.site/api/v1/gateway/devices/${process.env.TEXTBEE_DEVICE_ID}/send-sms`;
    const message = [
      'New Job Assignment',
      `Technician: ${technicianName || 'N/A'}`,
      `Job: ${jobDescription || 'N/A'}`,
      `Address: ${clientAddress || 'N/A'}`
    ].join('\n');

    await axios.post(
      textbeeUrl,
      {
        recipients: [technicianPhone],
        message
      },
      {
        headers: {
          'x-api-key': process.env.TEXTBEE_API_KEY
        }
      }
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    const details = error.response && error.response.data ? error.response.data : error.message;
    return res.status(500).json({ error: 'Failed to process webhook', details });
  }
};
