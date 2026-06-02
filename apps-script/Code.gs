const CONFIG = {
  SHEET_ID: '1SMnemtkeuo-AvWtTJFb34iDjCzA0Ic5X2SxRRS_KGbw',
  SHEET_NAME: 'Responses',
};

const HEADERS = [
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
  'DeviceID',
  'Status',
  'Verdict',
  'QCType',
  'Inspector',
  'Slot',
  'StartTime',
  'EndTime',
  'Remarks',
  'RejectionReason',
  'ActionBy',
  'ActionAt',
  'UpdatedAt',
  'Version',
];

// ===================== ROUTES ===================== //

function doGet(e) {
  try {
    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    const rows = toObjects_(values);

    return json_({
      ok: true,
      sheet: CONFIG.SHEET_NAME,
      count: rows.length,
      rows,
    });

  } catch (error) {
    return json_({
      ok: false,
      error: error.message || String(error),
    });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const row = payload.row || payload;
    const action = String(payload.action || (row.DeviceID || row.deviceId ? 'update' : '')).toLowerCase();
    if (!action) throw new Error('Missing action');

    const sheet = getSheet_();
    ensureHeaders_(sheet, Object.keys(row));

    const deviceId = String(row.DeviceID || row.deviceId || '').trim();
    if (!deviceId) throw new Error('DeviceID is required');

    if (action === 'create' || action === 'update') {
      upsertRow_(sheet, deviceId, row);
      return json_({ ok: true, action, deviceId });
    }

    if (action === 'delete') {
      deleteRow_(sheet, deviceId);
      return json_({ ok: true, action, deviceId });
    }

    throw new Error(`Unsupported action: ${action}`);

  } catch (error) {
    return json_({
      ok: false,
      error: error.message || String(error),
    });
  }
}

function doOptions(e) {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

// ===================== CORE ===================== //

function getSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet =
    ss.getSheetByName(CONFIG.SHEET_NAME) ||
    ss.insertSheet(CONFIG.SHEET_NAME);

  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet, extraHeaders) {
  const desiredHeaders = mergeHeaders_(HEADERS, extraHeaders || []);
  const width = Math.max(sheet.getLastColumn(), desiredHeaders.length, 1);
  const range = sheet.getRange(1, 1, 1, width);
  const values = range.getValues()[0];

  const isEmpty = values.every(v => !v);
  if (isEmpty) {
    sheet.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    return;
  }

  const currentHeaders = values.map(v => String(v).trim());
  const missing = desiredHeaders.filter(h => h && !currentHeaders.includes(h));

  if (missing.length > 0) {
    sheet
      .getRange(1, 1, 1, currentHeaders.length + missing.length)
      .setValues([[...currentHeaders, ...missing]]);
  }
}

function getHeaderMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    if (h) map[String(h).trim()] = i;
  });
  return map;
}

function mergeHeaders_(baseHeaders, extraHeaders) {
  const out = baseHeaders.slice();
  (extraHeaders || []).forEach(h => {
    const key = String(h || '').trim();
    if (key && !out.includes(key)) out.push(key);
  });
  return out;
}

function toObjects_(values) {
  if (!values || values.length < 2) return [];

  const headers = values[0].map(h => String(h).trim());

  return values.slice(1)
    .filter(row => row.some(cell => String(cell).trim() !== ''))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = formatCellForJson_(row[i] ?? '', h);
      });
      return obj;
    });
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
  return value;
}

function upsertRow_(sheet, deviceId, row) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const deviceIndex = headers.indexOf('DeviceID');
  if (deviceIndex === -1) throw new Error('DeviceID header missing');

  const normalized = normalizeRow_(row);
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
  if (deviceIndex === -1) throw new Error('DeviceID header missing');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][deviceIndex]).trim() === deviceId) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function normalizeRow_(row) {
  const out = {};

  HEADERS.forEach(h => {
    out[h] = pickValue_(row, [
      h,
      h.toLowerCase(),
      h.replace(/([A-Z])/g, ' $1').trim(),
    ]);
  });

  Object.keys(row || {}).forEach(key => {
    const value = row[key];
    if (value !== undefined && value !== null) out[key] = value;
  });

  out.DeviceID = pickValue_(row, ['DeviceID', 'deviceId', 'Device ID', 'ID']) || out.DeviceID;
  out.deviceId = out.DeviceID;
  out.Status = pickValue_(row, ['Status', 'status']) || out.Status || '';
  out.Verdict = pickValue_(row, ['Verdict', 'verdict', 'result', 'Result']) || out.Verdict || verdictFromStatus_(out.Status);
  // If Status wasn't provided but Verdict is a final value, derive Status from Verdict
  if (!out.Status || String(out.Status).trim() === '') {
    const v = String(out.Verdict || '').toUpperCase();
    if (v.indexOf('PASS') !== -1) out.Status = 'Approved';
    else if (v.indexOf('FAIL') !== -1) out.Status = 'Rejected';
    else out.Status = 'Pending';
  }
  out.QCType = pickValue_(row, ['QCType', 'qcType', 'QC Type', 'inspectionType']) || out.QCType;
  out.inspectionType = out.QCType;
  out.Inspector = pickValue_(row, ['Inspector', 'inspector', 'inspectorId', 'inspectorName']) || out.Inspector;
  out.inspectorName = out.Inspector;
  out.Remarks = pickValue_(row, ['Remarks', 'remarks']) || out.Remarks;
  out.remarks = out.Remarks;
  out.RejectionReason = pickValue_(row, ['RejectionReason', 'rejectionReason']) || out.RejectionReason;
  out.rejectionReason = out.RejectionReason;
  out.ActionBy = pickValue_(row, ['ActionBy', 'actionBy', 'inspectorName']) || out.ActionBy;
  out.ActionAt = pickValue_(row, ['ActionAt', 'actionAt', 'submittedAt']) || out.ActionAt;
  out.Version = pickValue_(row, ['Version', 'version']) || out.Version;
  out.version = out.Version;
  out.UpdatedAt = new Date();

  return out;
}

function pickValue_(row, keys) {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = row && row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function verdictFromStatus_(status) {
  const upper = String(status || '').toUpperCase();
  if (upper.indexOf('APPROV') !== -1 || upper.indexOf('PASS') !== -1) return 'PASS';
  if (upper.indexOf('REJECT') !== -1 || upper.indexOf('FAIL') !== -1) return 'FAIL';
  return 'PENDING';
}

function parsePayload_(e) {
  if (e?.postData?.contents) {
    const parsed = JSON.parse(e.postData.contents);
    if (e?.parameter?.dev) parsed.dev = e.parameter.dev;
    return parsed;
  }
  return e?.parameter || {};
}

// ===================== RESPONSE ===================== //

function json_(data) {
  const output = ContentService
    .createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
