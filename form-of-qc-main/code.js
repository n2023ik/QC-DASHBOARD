import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const {
  PORT = '3001',
  GOOGLE_SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_TAB_NAME = 'Responses',
} = process.env;

function getAuthConfig() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
  }

  return {
    client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

async function getSheet() {
  if (!GOOGLE_SHEET_ID) {
    throw new Error('Missing GOOGLE_SHEET_ID');
  }

  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
  await doc.useServiceAccountAuth(getAuthConfig());
  await doc.loadInfo();

  let sheet = doc.sheetsByTitle[GOOGLE_SHEET_TAB_NAME];
  return { doc, sheet };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/submit', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, message: 'Request body must be an object.' });
    }

    const { doc, sheet } = await getSheet();
    const headers = Object.keys(payload);

    let targetSheet = sheet;
    if (!targetSheet) {
      targetSheet = await doc.addSheet({ title: GOOGLE_SHEET_TAB_NAME, headerValues: headers });
    } else {
      try {
        await targetSheet.loadHeaderRow();
      } catch {
        await targetSheet.setHeaderRow(headers);
      }

      if (!targetSheet.headerValues?.length) {
        await targetSheet.setHeaderRow(headers);
      }
    }

    await targetSheet.addRow(payload);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to save row to Google Sheets.',
    });
  }
});

app.listen(Number(PORT), () => {
  console.log(`Google Sheets API listening on http://localhost:${PORT}`);
});