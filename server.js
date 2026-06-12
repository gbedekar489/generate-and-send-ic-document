const express = require("express");
const axios = require("axios");
const sgMail = require("@sendgrid/mail");

const app = express();

app.use(express.json());

const SENDGRID_API_KEY = process.env.SEND_GRID_API_KEY;
const AEM_BEARER = 'Basic Z2VlYmVlOmFkbWlu'; 


// email-pdf endpoint here

const port = process.env.PORT || 10000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

async function fetchPdfBuffer(documentId, serviceParams = {}) {
  const url = `https://author-p133654-e1305513.adobeaemcloud.com/adobe/communications/${documentId}/pdf`;
  const optionsJson = JSON.stringify({
    prefill: {
      serviceName: 'IC_FDM',
      serviceParams: serviceParams || {}
    }
  });

  const form = new FormData();
  form.append('options', optionsJson, { contentType: 'application/json' });

  const resp = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: AEM_BEARER
    },
    responseType: 'arraybuffer',
    validateStatus: null
  });

  if (resp.status < 200 || resp.status >= 300) {
    let bodyPreview = '';
    try {
      bodyPreview = Buffer.from(resp.data || '', 'binary').toString('utf8').slice(0, 400);
    } catch (e) {
      bodyPreview = '<non-text response>';
    }
    const err = new Error('communications service error');
    err.status = resp.status;
    err.bodyPreview = bodyPreview;
    throw err;
  }

  return Buffer.from(resp.data);
}
app.post('/email-pdf', async (req, res) => {
  try {
    if (!SENDGRID_API_KEY || !SENDGRID_FROM) {
      return res.status(500).json({
        error: 'SendGrid not configured. Set SENDGRID_API_KEY and SENDGRID_FROM env vars.'
      });
    }

    const {
      documentId,
      userId,
      entityNS,
      entityID,
      to,
      subject,
      text,
      filename
    } = req.body;

    if (!documentId) {
      return res.status(400).json({ error: 'missing documentId' });
    }

    if (!to) {
      return res.status(400).json({ error: 'missing recipient email (to)' });
    }

    let serviceParams = {};

    if (entityNS && entityID) {
      serviceParams = { entityNS, entityID };
    } else if (userId) {
      serviceParams = { userId };
    } else {
      return res.status(400).json({
        error: 'missing required parameters (userId OR entityNS/entityID)'
      });
    }

    const aemAuth = AEM_BEARER || req.header('Authorization');
    if (!aemAuth) {
      return res.status(401).json({ error: 'missing AEM Authorization' });
    }

    const pdfBuffer = await fetchPdfBuffer(documentId, serviceParams);
    const pdfBase64 = pdfBuffer.toString('base64');

    const msg = {
      to,
      from: SENDGRID_FROM,
      subject: subject || 'Your PDF document',
      text: text || 'Please find attached.',
      attachments: [
        {
          content: pdfBase64,
          type: 'application/pdf',
          filename: filename || 'document.pdf',
          disposition: 'attachment'
        }
      ]
    };

    const result = await sgMail.send(msg);

    return res.json({
      status: 'sent',
      sendgridResponse: Array.isArray(result)
        ? result[0].statusCode
        : (result && result.statusCode)
    });
  } catch (error) {
    if (error.status) {
      console.error('AEM error', error.status, error.bodyPreview);
      return res.status(502).json({
        error: 'communications service error',
        status: error.status,
        bodyPreview: error.bodyPreview
      });
    }

    console.error('email-pdf error', error.response ? (error.response.body || error.response) : error.message || error);

    const errBody =
      error.response &&
      (error.response.body || error.response.data)
        ? error.response.body || error.response.data
        : undefined;

    return res.status(500).json({
      error: 'Failed to send email',
      details: errBody || error.message
    });
  }
});
