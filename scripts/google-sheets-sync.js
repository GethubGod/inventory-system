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

  try {
    var deleted = deleteRemovedRows(ss, config);
    if (deleted > 0) log.push('🗑️ ' + currentName + ': ' + deleted + ' removed from DB');
  } catch (e) {
    log.push('⚠️ ' + currentName + ' cleanup: ' + e.message);
  }

  SpreadsheetApp.getUi().alert('Sync Complete', log.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================
// UPSERT: Push sheet rows to Supabase
// Auto-generates UUIDs for new rows (blank id column)
// ============================================================
function syncSheetUpsertOnly(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Sheet not found — skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'Empty — skipped';

  var headers = data[0].map(function(h) { return String(h).trim(); });
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

  if (rows.length === 0) return 'No valid rows — skipped';

  var batchSize = 50;
  var upserted = 0;

  var rowGroups = groupRowsByKeySignature(rows);

  for (var g = 0; g < rowGroups.length; g++) {
    var group = rowGroups[g];

    for (var i = 0; i < group.length; i += batchSize) {
      var batch = group.slice(i, i + batchSize);
      var response = supabaseUpsert(config.table, batch, config.conflictColumn);

      if (response.getResponseCode() >= 400) {
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
      log.push('❌ ' + config.table + ': ' + e.message);
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
