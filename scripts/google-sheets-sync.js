// ============================================================
// Babytuna Inventory — Google Sheets ↔ Supabase Sync
// ============================================================
//
// SETUP: Set these in Apps Script Project Settings > Script Properties
//   SUPABASE_URL  — e.g. https://xxxxx.supabase.co
//   SUPABASE_KEY  — your service_role key (NOT the anon key)
//
// Or hardcode them here for simplicity:
// const SUPABASE_URL = 'https://xxxxx.supabase.co';
// const SUPABASE_KEY = 'eyJ...';

// Sheet → Table mapping. Order matters: parents before children.
// REMOVED: storage_areas, area_items (auto-managed by the app based on item category)
// REMOVED: org_settings (security-sensitive, managed via app settings)
// REMOVED: reminder_system_settings (app config only)
const SYNC_CONFIG = [
  { sheet: 'locations',       table: 'locations',       conflictColumn: 'id' },
  { sheet: 'suppliers',       table: 'suppliers',       conflictColumn: 'id' },
  { sheet: 'inventory_items', table: 'inventory_items', conflictColumn: 'id' },
  {
    sheet: 'item_order_limits',
    table: 'item_order_limits',
    conflictColumn: 'id',
    optional: true,
    expectedHeaders: [
      'id', 'item_id', 'location_id', 'supplier_id', 'default_order_unit',
      'typical_min_quantity', 'typical_max_quantity', 'soft_max_quantity',
      'hard_max_quantity', 'manager_approval_quantity',
      'allow_employee_override', 'allow_manager_override',
      'max_single_order_quantity', 'max_daily_quantity', 'max_weekly_quantity',
      'historical_median_quantity', 'historical_p95_quantity',
      'historical_max_quantity', 'created_at', 'updated_at',
    ],
    requiredActiveFields: ['item_id'],
    meaningfulFields: [
      'default_order_unit', 'typical_min_quantity', 'typical_max_quantity',
      'soft_max_quantity', 'hard_max_quantity', 'manager_approval_quantity',
      'allow_employee_override', 'allow_manager_override',
      'max_single_order_quantity', 'max_daily_quantity', 'max_weekly_quantity',
      'historical_median_quantity', 'historical_p95_quantity',
      'historical_max_quantity',
    ],
    numericFields: [
      'typical_min_quantity', 'typical_max_quantity', 'soft_max_quantity',
      'hard_max_quantity', 'manager_approval_quantity',
      'max_single_order_quantity', 'max_daily_quantity', 'max_weekly_quantity',
      'historical_median_quantity', 'historical_p95_quantity',
      'historical_max_quantity',
    ],
    booleanFields: ['allow_employee_override', 'allow_manager_override'],
  },
  {
    sheet: 'item_allowed_units',
    table: 'item_allowed_units',
    conflictColumn: 'id',
    optional: true,
    expectedHeaders: [
      'id', 'item_id', 'unit', 'is_default', 'conversion_to_base_unit',
      'min_quantity', 'soft_max_quantity', 'hard_max_quantity',
      'created_at', 'updated_at',
    ],
    requiredActiveFields: ['item_id', 'unit'],
    meaningfulFields: ['unit', 'is_default', 'conversion_to_base_unit', 'min_quantity', 'soft_max_quantity', 'hard_max_quantity'],
    numericFields: ['conversion_to_base_unit', 'min_quantity', 'soft_max_quantity', 'hard_max_quantity'],
    booleanFields: ['is_default'],
  },
  {
    sheet: 'item_aliases',
    table: 'item_aliases',
    conflictColumn: 'id',
    optional: true,
    optionalTable: true,
    requiredActiveFields: ['item_id', 'alias'],
    meaningfulFields: ['item_id', 'alias'],
  },
  {
    sheet: 'quick_order_aliases',
    table: 'quick_order_aliases',
    conflictColumn: 'id',
    optional: true,
    optionalTable: true,
    requiredActiveFields: ['item_id', 'alias'],
    meaningfulFields: ['item_id', 'alias'],
  },
];

// Known category values — used for warnings only, NOT hard blocks.
// New categories are accepted freely since the DB uses plain text columns.
const KNOWN_VALUES = {
  inventory_items: {
    category: ['fish', 'protein', 'produce', 'dry', 'dairy_cold', 'frozen', 'sauces', 'packaging', 'alcohol'],
    supplier_category: ['fish_supplier', 'main_distributor', 'asian_market'],
  },
};

function normalizeTextCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizePositiveNumber(value, fallback) {
  var parsed = Number(value);
  if (!isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function deleteAutoManagedFields(row) {
  delete row.created_at;
  delete row.updated_at;
}

function getRowKeySignature(row) {
  return Object.keys(row).sort().join('|');
}

function groupRowsByKeySignature(rows) {
  var groups = {};
  var orderedSignatures = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var signature = getRowKeySignature(row);

    if (!groups[signature]) {
      groups[signature] = [];
      orderedSignatures.push(signature);
    }

    groups[signature].push(row);
  }

  var result = [];
  for (var j = 0; j < orderedSignatures.length; j++) {
    result.push(groups[orderedSignatures[j]]);
  }

  return result;
}

function validateOptionalHeaders(headers, config) {
  if (!config.optional || !config.expectedHeaders) return null;
  var normalized = headers.filter(function(header) { return header; });
  var expected = config.expectedHeaders;
  if (normalized.length !== expected.length) {
    return 'Optional sheet header mismatch, skipped';
  }
  for (var i = 0; i < expected.length; i++) {
    if (normalized[i] !== expected[i]) {
      return 'Optional sheet header mismatch, skipped';
    }
  }
  return null;
}

function normalizeOptionalSyncRow(row, config, rowNumber, warnings) {
  if (!rowHasMeaningfulOptionalData(row, config)) return null;

  var normalized = {};
  for (var key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    normalized[key] = row[key];
  }

  var numericFields = config.numericFields || [];
  for (var n = 0; n < numericFields.length; n++) {
    var numericField = numericFields[n];
    if (!Object.prototype.hasOwnProperty.call(normalized, numericField)) continue;
    var parsedNumber = normalizeOptionalNumber(normalized[numericField]);
    if (parsedNumber.invalid) {
      warnings.push('Row ' + rowNumber + ': invalid optional numeric value for "' + numericField + '" skipped');
      delete normalized[numericField];
    } else {
      normalized[numericField] = parsedNumber.value;
    }
  }

  var booleanFields = config.booleanFields || [];
  for (var b = 0; b < booleanFields.length; b++) {
    var booleanField = booleanFields[b];
    if (!Object.prototype.hasOwnProperty.call(normalized, booleanField)) continue;
    var parsedBoolean = normalizeOptionalBoolean(normalized[booleanField]);
    if (parsedBoolean.invalid) {
      warnings.push('Row ' + rowNumber + ': invalid optional boolean value for "' + booleanField + '" skipped');
      delete normalized[booleanField];
    } else if (parsedBoolean.value === null) {
      delete normalized[booleanField];
    } else {
      normalized[booleanField] = parsedBoolean.value;
    }
  }

  if (config.table === 'item_allowed_units' && normalizeTextCell(normalized.unit) === '') {
    warnings.push('Row ' + rowNumber + ': blank unit skipped');
    return null;
  }

  if ((config.table === 'item_aliases' || config.table === 'quick_order_aliases') &&
      normalizeTextCell(normalized.alias) === '') {
    warnings.push('Row ' + rowNumber + ': blank alias skipped');
    return null;
  }

  var required = config.requiredActiveFields || [];
  for (var r = 0; r < required.length; r++) {
    var field = required[r];
    if (normalizeTextCell(normalized[field]) === '') {
      warnings.push('Row ' + rowNumber + ': missing required optional field "' + field + '" skipped');
      return null;
    }
  }

  return normalized;
}

function rowHasMeaningfulOptionalData(row, config) {
  var fields = config.meaningfulFields || [];
  for (var i = 0; i < fields.length; i++) {
    var value = row[fields[i]];
    if (value !== null && value !== undefined && String(value).trim() !== '') return true;
  }
  return false;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return { value: null, invalid: false };
  if (typeof value === 'number') return isFinite(value) ? { value: value, invalid: false } : { value: null, invalid: true };
  var text = String(value).trim();
  if (!text) return { value: null, invalid: false };
  var parsed = Number(text);
  return isFinite(parsed) ? { value: parsed, invalid: false } : { value: null, invalid: true };
}

function normalizeOptionalBoolean(value) {
  if (value === null || value === undefined || value === '') return { value: null, invalid: false };
  if (value === true || value === false) return { value: value, invalid: false };
  var text = String(value).trim().toLowerCase();
  if (!text) return { value: null, invalid: false };
  if (text === 'true' || text === 'yes' || text === '1') return { value: true, invalid: false };
  if (text === 'false' || text === 'no' || text === '0') return { value: false, invalid: false };
  return { value: null, invalid: true };
}

function isOptionalTableUnavailable(response) {
  var status = response.getResponseCode();
  if (status === 404) return true;
  var body = response.getContentText ? response.getContentText() : '';
  return /Could not find the table|schema cache|42P01|PGRST205/i.test(body);
}

function isOptionalQuickOrderOrphanDeleteEnabled() {
  try {
    if (typeof PropertiesService === 'undefined') return false;
    var value = PropertiesService.getScriptProperties().getProperty('ENABLE_OPTIONAL_QUICK_ORDER_ORPHAN_DELETE');
    return String(value).toLowerCase() === 'true';
  } catch (e) {
    return false;
  }
}

// ============================================================
// MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Babytuna Sync')
    .addItem('Sync All to Supabase', 'syncAllToSupabase')
    .addItem('Sync Current Sheet Only', 'syncCurrentSheet')
    .addSeparator()
    .addItem('Pull from Supabase (read-only tables)', 'pullFromSupabase')
    .addToUi();
}

// ============================================================
// MAIN SYNC: Upsert all, then delete orphans (children first)
// ============================================================
function syncAllToSupabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = [];

  for (var c = 0; c < SYNC_CONFIG.length; c++) {
    var config = SYNC_CONFIG[c];
    try {
      var result = syncSheetUpsertOnly(ss, config);
      log.push('✅ ' + config.sheet + ': ' + result);
    } catch (e) {
      log.push('❌ ' + config.sheet + ': ' + e.message);
    }
  }

  // Delete orphans in REVERSE order (children first)
  for (var i = SYNC_CONFIG.length - 1; i >= 0; i--) {
    var config = SYNC_CONFIG[i];
    if (config.optional && !isOptionalQuickOrderOrphanDeleteEnabled()) {
      log.push('ℹ️ ' + config.sheet + ': optional orphan deletion disabled');
      continue;
    }
    try {
      var deleted = deleteRemovedRows(ss, config);
      if (deleted > 0) log.push('🗑️ ' + config.sheet + ': ' + deleted + ' removed from DB');
    } catch (e) {
      log.push('⚠️ ' + config.sheet + ' cleanup: ' + e.message);
    }
  }

  var msg = log.join('\n');
  Logger.log(msg);
  SpreadsheetApp.getUi().alert('Sync Complete', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// SYNC CURRENT SHEET ONLY
// ============================================================
function syncCurrentSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var currentName = ss.getActiveSheet().getName();
  var config = null;

  for (var i = 0; i < SYNC_CONFIG.length; i++) {
    if (SYNC_CONFIG[i].sheet === currentName) {
      config = SYNC_CONFIG[i];
      break;
    }
  }

  if (!config) {
    SpreadsheetApp.getUi().alert(
      '"' + currentName + '" is not configured for sync.\n\n' +
      'Synced sheets: ' + SYNC_CONFIG.map(function(c) { return c.sheet; }).join(', ')
    );
    return;
  }

  var log = [];

  try {
    var result = syncSheetUpsertOnly(ss, config);
    log.push('✅ ' + currentName + ': ' + result);
  } catch (e) {
    log.push('❌ ' + currentName + ': ' + e.message);
  }

  if (config.optional && !isOptionalQuickOrderOrphanDeleteEnabled()) {
    log.push('ℹ️ ' + currentName + ': optional orphan deletion disabled');
  } else {
    try {
      var deleted = deleteRemovedRows(ss, config);
      if (deleted > 0) log.push('🗑️ ' + currentName + ': ' + deleted + ' removed from DB');
    } catch (e) {
      log.push('⚠️ ' + currentName + ' cleanup: ' + e.message);
    }
  }

  SpreadsheetApp.getUi().alert('Sync Complete', log.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// UPSERT: Push sheet rows to Supabase
// Auto-generates UUIDs for new rows (blank id column)
// ============================================================
function syncSheetUpsertOnly(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) {
    return config.optional
      ? 'Optional sheet missing, skipped'
      : 'Sheet not found — skipped';
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return config.optional
      ? 'No optional data found — app will use defaults'
      : 'Empty — skipped';
  }

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var optionalHeaderWarning = validateOptionalHeaders(headers, config);
  if (optionalHeaderWarning) return optionalHeaderWarning;
  var idColIdx = headers.indexOf('id');
  var rows = [];
  var newRowIndices = []; // track which spreadsheet rows got auto-generated IDs
  var newRowUuids = [];
  var validationWarnings = [];
  var blockingErrors = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    var hasData = false;

    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      var val = data[i][j];

      if (val !== '' && val !== null && val !== undefined) hasData = true;

      if (val === true) val = true;
      else if (val === false) val = false;
      else if (val === '') val = null;

      row[headers[j]] = val;
    }

    if (!hasData) continue;

    if (config.optional) {
      var normalizedOptional = normalizeOptionalSyncRow(row, config, i + 1, validationWarnings);
      if (!normalizedOptional) {
        validationWarnings.push('Row ' + (i + 1) + ': blank optional row skipped');
        continue;
      }
      row = normalizedOptional;
    }

    // Auto-generate UUID for new rows with blank id
    if (idColIdx !== -1 && (row['id'] === null || row['id'] === undefined || String(row['id']).trim() === '')) {
      var newUuid = Utilities.getUuid();
      row['id'] = newUuid;
      newRowIndices.push(i); // spreadsheet row index (0-based in data array, +1 for header)
      newRowUuids.push(newUuid);
    }

    var keyCol = config.conflictColumn;
    if (row[keyCol] === null || row[keyCol] === undefined) continue;

    deleteAutoManagedFields(row);

    if (Object.prototype.hasOwnProperty.call(row, 'active') &&
        (row.active === null || row.active === undefined)) {
      row.active = true;
    }

    if (config.table === 'inventory_items') {
      row.base_unit = normalizeTextCell(row.base_unit);
      row.pack_unit = normalizeTextCell(row.pack_unit);
      row.emoji = normalizeTextCell(row.emoji);
      row.pack_size = normalizePositiveNumber(row.pack_size, 1);

      if (!row.base_unit && !row.pack_unit) {
        blockingErrors.push(
          'Row ' + (i + 1) + ': at least one of "base_unit" or "pack_unit" is required'
        );
        continue;
      }
    }

    // Normalize text values and log warnings for unknown categories
    var tableKnownValues = KNOWN_VALUES[config.table];
    if (tableKnownValues) {
      var rowNum = i + 1;
      for (var col in tableKnownValues) {
        if (row[col] !== null && row[col] !== undefined) {
          var val = String(row[col]).trim().toLowerCase();
          row[col] = val;
          if (val.length > 0 && tableKnownValues[col].indexOf(val) === -1) {
            validationWarnings.push(
              'Row ' + rowNum + ': "' + col + '" has new value "' + val + '" ' +
              '(known values: ' + tableKnownValues[col].join(', ') + ')'
            );
          }
        }
      }
    }

    rows.push(row);
  }

  if (blockingErrors.length > 0) {
    throw new Error(blockingErrors.join('\n'));
  }

  if (validationWarnings.length > 0) {
    Logger.log('New category values detected:\n' + validationWarnings.join('\n'));
  }

  if (rows.length === 0) {
    return config.optional
      ? 'No optional data found — app will use defaults'
      : 'No valid rows — skipped';
  }

  var batchSize = 50;
  var upserted = 0;

  var rowGroups = groupRowsByKeySignature(rows);

  for (var g = 0; g < rowGroups.length; g++) {
    var group = rowGroups[g];

    for (var i = 0; i < group.length; i += batchSize) {
      var batch = group.slice(i, i + batchSize);
      var response = supabaseUpsert(config.table, batch, config.conflictColumn);

      if (response.getResponseCode() >= 400) {
        if (config.optional && isOptionalTableUnavailable(response)) {
          Logger.log('Optional table unavailable for ' + config.table + ', skipped: ' + response.getContentText());
          return 'Optional table unavailable, skipped';
        }
        throw new Error('HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
      }

      upserted += batch.length;
    }
  }

  // Write auto-generated UUIDs back to the sheet so future syncs update (not duplicate)
  if (newRowIndices.length > 0 && idColIdx !== -1) {
    for (var k = 0; k < newRowIndices.length; k++) {
      var sheetRow = newRowIndices[k] + 1; // +1 because getRange is 1-indexed
      sheet.getRange(sheetRow, idColIdx + 1).setValue(newRowUuids[k]);
    }
  }

  var msg = upserted + ' rows upserted';
  if (newRowIndices.length > 0) {
    msg += ' (' + newRowIndices.length + ' new)';
  }
  return msg;
}

// ============================================================
// DELETE ORPHANS: Remove DB rows not in the sheet
// ============================================================
function deleteRemovedRows(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 0;

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var keyCol = config.conflictColumn;
  var keyIdx = headers.indexOf(keyCol);
  if (keyIdx === -1) return 0;

  var sheetIds = [];
  for (var i = 1; i < data.length; i++) {
    var val = data[i][keyIdx];
    if (val !== '' && val !== null && val !== undefined) {
      sheetIds.push(String(val));
    }
  }

  if (sheetIds.length === 0) return 0;

  var url = SUPABASE_URL + '/rest/v1/' + config.table + '?select=' + keyCol;
  var getResp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    },
    muteHttpExceptions: true,
  });

  if (getResp.getResponseCode() >= 400) return 0;

  var dbRows = JSON.parse(getResp.getContentText());
  var toDelete = [];

  for (var i = 0; i < dbRows.length; i++) {
    var dbId = String(dbRows[i][keyCol]);
    if (sheetIds.indexOf(dbId) === -1) {
      toDelete.push(dbId);
    }
  }

  if (toDelete.length === 0) return 0;

  for (var i = 0; i < toDelete.length; i++) {
    var delUrl = SUPABASE_URL + '/rest/v1/' + config.table + '?' + keyCol + '=eq.' + toDelete[i];
    UrlFetchApp.fetch(delUrl, {
      method: 'delete',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      },
      muteHttpExceptions: true,
    });
  }

  return toDelete.length;
}

// ============================================================
// SUPABASE API: Upsert
// ============================================================
function supabaseUpsert(table, rows, conflictColumn) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + conflictColumn;

  return UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'resolution=merge-duplicates',
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
}

// ============================================================
// PULL: Read runtime data FROM Supabase into Sheets
// ============================================================
function pullFromSupabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var pullTables = [
    { table: 'orders',      sheet: '_orders (read-only)' },
    { table: 'order_items', sheet: '_order_items (read-only)' },
    { table: 'current_stock_snapshots', sheet: '_current_stock_snapshots', optional: true },
  ];

  var log = [];

  for (var t = 0; t < pullTables.length; t++) {
    var config = pullTables[t];
    try {
      var data = supabaseSelect(config.table);
      if (data.length === 0) {
        log.push('ℹ️ ' + config.table + ': No data');
        continue;
      }

      var sheet = ss.getSheetByName(config.sheet);
      if (!sheet) {
        sheet = ss.insertSheet(config.sheet);
      }
      sheet.clear();

      var headers = Object.keys(data[0]);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

      var rows = data.map(function(row) {
        return headers.map(function(h) { return row[h] !== null && row[h] !== undefined ? row[h] : ''; });
      });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

      log.push('✅ ' + config.table + ': ' + rows.length + ' rows pulled');
    } catch (e) {
      log.push((config.optional ? '⚠️ ' : '❌ ') + config.table + ': ' + e.message);
    }
  }

  SpreadsheetApp.getUi().alert('Pull Complete', log.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// SUPABASE API: Select
// ============================================================
function supabaseSelect(table) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?select=*&order=created_at.desc&limit=500';

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 400) {
    throw new Error('HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
  }

  return JSON.parse(response.getContentText());
}

if (typeof module !== 'undefined') {
  module.exports = {
    SYNC_CONFIG: SYNC_CONFIG,
    validateOptionalHeaders: validateOptionalHeaders,
    normalizeOptionalSyncRow: normalizeOptionalSyncRow,
    normalizeOptionalNumber: normalizeOptionalNumber,
    normalizeOptionalBoolean: normalizeOptionalBoolean,
    rowHasMeaningfulOptionalData: rowHasMeaningfulOptionalData,
    isOptionalTableUnavailable: isOptionalTableUnavailable,
    isOptionalQuickOrderOrphanDeleteEnabled: isOptionalQuickOrderOrphanDeleteEnabled,
    syncSheetUpsertOnly: syncSheetUpsertOnly,
  };
}
