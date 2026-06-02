const CLIENT_ID = '1084174451436-63jqoe0v5pmf5ksjsv781mm1c4catjaf.apps.googleusercontent.com';
const SPREADSHEET_ID = '1SMnemtkeuo-AvWtTJFb34iDjCzA0Ic5X2SxRRS_KGbw';
const SHEET_NAME = 'Responses';
const ALLOWED_USERS_SHEET = 'AllowedUsers';
const FORM_HEADERS = [
  'submittedAt',
  'inspectionType',
  'deviceId',
  'inspectorName',
  'version',
  'date',
  'time',
  'remarks',
  'rejectionReason',
  'progress',
  'result',
  'pre_bluetooth',
  'pre_gps',
  'pre_lock',
  'pre_unlock',
  'pre_passcode',
  'pre_battery',
  'pre_shackleCondition',
  'pre_shackleBand',
  'pre_shackleCut',
  'pre_glassBroken',
  'pre_tampered',
  'post_bluetooth',
  'post_gps',
  'post_lock',
  'post_unlock',
  'post_passcode',
  'post_battery',
  'post_finalPackaging',
];

/** Helpers for CORS JSON responses */
function json_(obj) {
  const out = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  return out;
}

function doOptions(e) {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  try {
    const sheet = getTargetSheet();
    const range = sheet.getDataRange();
    const values = range.getValues();
    if (!values || values.length === 0) return json_({ ok: true, rows: [] });

    const headers = values[0].map(h => String(h || '').trim());
    const rows = values.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = formatCellForJson_(r[i], h); });
      return obj;
    });

    return json_({ ok: true, sheet: SHEET_NAME, count: rows.length, rows });
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    // accept token either as query param or inside post body
    const token = (e.parameter && e.parameter.token) || (e.postData && (() => {
      try { const p = JSON.parse(e.postData.contents); return p && p.token; } catch (e) { return null; }
    })());
    const devBypass = String((e && e.parameter && e.parameter.dev) || '').trim() === '1';

    let email = 'dev@local';
    if (!devBypass) {
      if (!token) return json_({ ok: false, error: 'NO_TOKEN' });

      const auth = verifyToken_(token);
      if (!auth.ok) return json_({ ok: false, error: auth.error });

      email = auth.email.toLowerCase();
      if (!isEmailAllowed_(email)) return json_({ ok: false, error: 'UNAUTHORIZED', email });
    }

    const payload = parsePayload(e);
    const sheet = getTargetSheet();

    // Support structured mutations from the app: { action: 'create'|'update'|'delete', row: {...} }
    const action = payload && payload.action ? String(payload.action).toLowerCase() : null;
    const rowPayload = payload && payload.row ? payload.row : null;

    if (action && rowPayload && (action === 'create' || action === 'update')) {
      ensureHeaders_(sheet, mergeHeaders_(FORM_HEADERS, Object.keys(rowPayload)));
      upsertRow_(sheet, String(rowPayload.DeviceID || rowPayload.deviceId || '').trim(), rowPayload);
      SpreadsheetApp.flush();
      return json_({ ok: true, action, email });
    }

    if (action === 'delete' && rowPayload) {
      deleteRow_(sheet, String(rowPayload.DeviceID || rowPayload.deviceId || '').trim());
      SpreadsheetApp.flush();
      return json_({ ok: true, action, email });
    }

    // Fallback: accept a flat payload mapping headers to values and append as a row
    const flat = payload;
    const row = buildRow(sheet, flat);
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return json_({ ok: true, email });
  } catch (error) {
    return json_({ ok: false, error: error.message || String(error) });
  }
}

function ensureHeaders_(sheet, headers) {
  headers = mergeHeaders_(FORM_HEADERS, headers || []);
  const width = Math.max(headers.length, sheet.getLastColumn(), 1);
  const range = sheet.getRange(1, 1, 1, width);
  const values = range.getValues()[0];

  const isEmpty = values.every(v => !v);
  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  const currentHeaders = values.map(v => String(v).trim());
  const missing = headers.filter(h => !currentHeaders.includes(h));

  if (missing.length > 0) {
    sheet
      .getRange(1, 1, 1, currentHeaders.length + missing.length)
      .setValues([[...currentHeaders, ...missing]]);
  }
}

function mergeHeaders_(baseHeaders, extraHeaders) {
  const out = baseHeaders.slice();
  (extraHeaders || []).forEach(h => {
    const key = String(h || '').trim();
    if (key && !out.includes(key)) out.push(key);
  });
  return out;
}

function getHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    if (h) map[String(h).trim()] = i;
  });
  return map;
}

function upsertRow_(sheet, deviceId, row) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const deviceIndex = headers.indexOf('DeviceID');
  if (deviceIndex === -1) {
    // ensure DeviceID header exists
    if (!headers.includes('DeviceID')) {
      sheet.getRange(1, 1, 1, headers.length + 1).setValues([[...headers, 'DeviceID']]);
    }
  }

  const normalized = {};
  Object.keys(row).forEach(k => normalized[k] = row[k]);
  normalized.deviceId = normalized.deviceId || normalized.DeviceID || deviceId;
  normalized.inspectionType = normalized.inspectionType || normalized.QCType || '';
  normalized.inspectorName = normalized.inspectorName || normalized.Inspector || normalized.ActionBy || '';
  normalized.version = normalized.version || normalized.Version || '';
  normalized.remarks = normalized.remarks || normalized.Remarks || '';
  normalized.rejectionReason = normalized.rejectionReason || normalized.RejectionReason || '';
  normalized.result = normalized.result || normalized.Verdict || '';
  let rowNumber = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][deviceIndex]).trim() === deviceId) {
      rowNumber = i + 1;
      break;
    }
  }

  if (rowNumber === -1) {
    rowNumber = sheet.getLastRow() + 1;
  }

  const output = headers.map(h => normalized[h] ?? '');
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([output]);
}

function deleteRow_(sheet, deviceId) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const deviceIndex = headers.indexOf('DeviceID');
  if (deviceIndex === -1) return;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][deviceIndex]).trim() === deviceId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function parsePayload(e) {
  if (e?.postData?.contents) {
    try {
      const parsed = JSON.parse(e.postData.contents);
      if (e?.parameter?.dev) parsed.dev = e.parameter.dev;
      return parsed;
    } catch (err) {
      throw new Error('Invalid JSON payload');
    }
  }
  // if sent as form params
  return e.parameter || {};
}

function getTargetSheet() {
  if (!SPREADSHEET_ID) throw new Error('Missing SPREADSHEET_ID');
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function buildRow(sheet, payload) {
  const headers = mergeHeaders_(FORM_HEADERS, Object.keys(payload));
  const hasHeaders = sheet.getLastRow() > 0 && sheet.getLastColumn() > 0;
  if (!hasHeaders) {
    sheet.appendRow(headers);
    return headers.map(h => payload[h] ?? '');
  }

  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
  return existingHeaders.map(h => (h && h in payload ? payload[h] : ''));
}

function formatCellForJson_(value, header) {
  if (value instanceof Date) {
    const key = String(header || '').toLowerCase();
    if (key === 'date') {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    if (key === 'time') {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
    }
    return value.toISOString();
  }
  return value ?? '';
}

// ================= AUTH HELPERS =================
function verifyToken_(token) {
  try {
    const tokenUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token);
    const resp = UrlFetchApp.fetch(tokenUrl, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { ok: false, error: 'INVALID_TOKEN' };
    const payload = JSON.parse(resp.getContentText());
    if (payload.aud !== CLIENT_ID) return { ok: false, error: 'INVALID_AUDIENCE' };
    if (!payload.email_verified) return { ok: false, error: 'EMAIL_NOT_VERIFIED' };
    return { ok: true, email: String(payload.email || '').toLowerCase() };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function getAllowedEmails_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ALLOWED_USERS_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  return values.map(v => String(v).trim().toLowerCase()).filter(Boolean);
}

function isEmailAllowed_(email) {
  const allowed = getAllowedEmails_();
  return allowed.includes(String(email).trim().toLowerCase());
}
