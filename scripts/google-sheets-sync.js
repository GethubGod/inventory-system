// ============================================================
// Babytuna Inventory — Google Sheets ↔ Supabase Sync
// ============================================================
//
// SETUP: Set these in Apps Script Project Settings > Script Properties
//   SUPABASE_URL  — e.g. https://xxxxx.supabase.co
//   SUPABASE_KEY  — prefer a dedicated sync credential with table-scoped access;
//                   service_role works but grants full DB access — restrict spreadsheet editors.
//   ENABLE_ORPHAN_DELETE — set to "true" to delete DB rows missing from core sheets (default off)
//   ENABLE_OPTIONAL_QUICK_ORDER_ORPHAN_DELETE — set to "true" for optional Quick Order tabs
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
  {
    sheet: 'employee_quick_order_aliases',
    table: 'employee_quick_order_aliases',
    conflictColumn: 'employee_name_key,alias_key,location_key',
    optional: true,
    customSync: 'employeeQuickOrderAliases',
    disableOrphanDelete: true,
    meaningfulFields: ['employee_name', 'alias_text', 'item_name', 'location_name', 'active', 'notes'],
  },
  {
    sheet: 'inventory_reorder_rules',
    table: 'inventory_reorder_rules',
    conflictColumn: 'inventory_item_id,location_key,trigger_type,trigger_qty_key,trigger_qty_max_key,trigger_unit_key',
    optional: true,
    customSync: 'inventoryReorderRules',
    disableOrphanDelete: true,
    meaningfulFields: [
      'active', 'location_name', 'item_name', 'applies_to_mode', 'trigger_type',
      'trigger_qty', 'trigger_qty_max', 'trigger_unit', 'order_strategy',
      'order_qty', 'order_unit', 'priority', 'notes',
    ],
  },
  {
    sheet: 'inventory_status_terms',
    table: 'inventory_status_terms',
    conflictColumn: 'phrase_key',
    optional: true,
    customSync: 'inventoryStatusTerms',
    disableOrphanDelete: true,
    meaningfulFields: [
      'active', 'phrase', 'phrase_key', 'status', 'remaining_qty',
      'remaining_unit_behavior', 'recommendation_action', 'priority', 'notes',
    ],
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

function normalizeEmployeeAliasKey(value) {
  return normalizeTextCell(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInventoryStatusPhraseKey(value) {
  return normalizeTextCell(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCatalogLookupText(value) {
  return normalizeTextCell(value)
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B\u2032`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[()[\]{}\/,\-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
    .replace(/'+/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function isUuidText(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeTextCell(value));
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

function isScriptPropertyEnabled(key) {
  try {
    if (typeof PropertiesService === 'undefined') return false;
    var value = PropertiesService.getScriptProperties().getProperty(key);
    return String(value).toLowerCase() === 'true';
  } catch (e) {
    return false;
  }
}

function isOrphanDeleteEnabled() {
  return isScriptPropertyEnabled('ENABLE_ORPHAN_DELETE');
}

function isOptionalQuickOrderOrphanDeleteEnabled() {
  return isScriptPropertyEnabled('ENABLE_OPTIONAL_QUICK_ORDER_ORPHAN_DELETE');
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

  // Delete orphans in REVERSE order (children first) — disabled by default for safety
  for (var i = SYNC_CONFIG.length - 1; i >= 0; i--) {
    var config = SYNC_CONFIG[i];
    if (config.optional && !isOptionalQuickOrderOrphanDeleteEnabled()) {
      log.push('ℹ️ ' + config.sheet + ': optional orphan deletion disabled');
      continue;
    }
    if (!config.optional && !isOrphanDeleteEnabled()) {
      log.push('ℹ️ ' + config.sheet + ': core orphan deletion disabled (set ENABLE_ORPHAN_DELETE=true to enable)');
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
  } else if (!config.optional && !isOrphanDeleteEnabled()) {
    log.push('ℹ️ ' + currentName + ': core orphan deletion disabled (set ENABLE_ORPHAN_DELETE=true to enable)');
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
  if (config.customSync === 'employeeQuickOrderAliases') {
    return syncEmployeeQuickOrderAliases(ss, config);
  }
  if (config.customSync === 'inventoryReorderRules') {
    return syncInventoryReorderRules(ss, config);
  }
  if (config.customSync === 'inventoryStatusTerms') {
    return syncInventoryStatusTerms(ss, config);
  }

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

      if (Object.prototype.hasOwnProperty.call(row, 'hard_cap')) {
        var parsedHard = normalizeOptionalNumber(row.hard_cap);
        if (parsedHard.invalid) {
          validationWarnings.push('Row ' + (i + 1) + ': invalid hard_cap skipped');
          delete row.hard_cap;
        } else {
          row.hard_cap = parsedHard.value;
        }
      }
      if (Object.prototype.hasOwnProperty.call(row, 'soft_cap')) {
        var parsedSoft = normalizeOptionalNumber(row.soft_cap);
        if (parsedSoft.invalid) {
          validationWarnings.push('Row ' + (i + 1) + ': invalid soft_cap skipped');
          delete row.soft_cap;
        } else {
          row.soft_cap = parsedSoft.value;
        }
      }
      if (Object.prototype.hasOwnProperty.call(row, 'safety_stock')) {
        var parsedSafety = normalizeOptionalNumber(row.safety_stock);
        if (parsedSafety.invalid) {
          validationWarnings.push('Row ' + (i + 1) + ': invalid safety_stock skipped');
          delete row.safety_stock;
        } else {
          row.safety_stock = parsedSafety.value;
        }
      }
      if (Object.prototype.hasOwnProperty.call(row, 'target_stock')) {
        var parsedTarget = normalizeOptionalNumber(row.target_stock);
        if (parsedTarget.invalid) {
          validationWarnings.push('Row ' + (i + 1) + ': invalid target_stock skipped');
          delete row.target_stock;
        } else {
          row.target_stock = parsedTarget.value;
        }
      }
      if (Object.prototype.hasOwnProperty.call(row, 'default_order_unit')) {
        row.default_order_unit = normalizeTextCell(row.default_order_unit) || null;
      }

      if (Object.prototype.hasOwnProperty.call(row, 'aliases')) {
        if (row.aliases === null || row.aliases === undefined) {
          row.aliases = [];
        } else if (typeof row.aliases === 'string') {
          row.aliases = row.aliases
            .split(',')
            .map(function(val) { return val.trim(); })
            .filter(function(val) { return val.length > 0; });
        } else if (Array.isArray(row.aliases)) {
          row.aliases = row.aliases
            .map(function(val) { return String(val).trim(); })
            .filter(function(val) { return val.length > 0; });
        } else {
          row.aliases = [String(row.aliases).trim()];
        }
      }

      if (!row.base_unit) {
        blockingErrors.push(
          'Row ' + (i + 1) + ': "base_unit" is required'
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
// CUSTOM SYNC: Employee-specific Quick Order aliases
// ============================================================
function syncEmployeeQuickOrderAliases(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureEmployeeAliasStatusColumns(sheet, headers);
  var required = ['employee_name', 'alias_text', 'item_name'];
  for (var r = 0; r < required.length; r++) {
    if (headers.indexOf(required[r]) === -1) {
      return 'Missing required header "' + required[r] + '"';
    }
  }

  var refs = loadEmployeeAliasReferenceData();
  var rows = [];
  var duplicateBuckets = {};

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;

    var rowNumber = i + 1;
    var employeeName = normalizeTextCell(row.employee_name);
    var aliasText = normalizeTextCell(row.alias_text);
    var itemName = normalizeTextCell(row.item_name);
    var locationName = normalizeTextCell(row.location_name);
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value === null ? true : activeResult.value;
    var employeeNameKey = normalizeEmployeeAliasKey(employeeName);
    var aliasKey = normalizeEmployeeAliasKey(aliasText);
    var rowError = null;

    if (!employeeName) rowError = 'employee_name is required';
    else if (!aliasText) rowError = 'alias_text is required';
    else if (!itemName) rowError = 'item_name is required';
    else if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';

    var location = null;
    if (!rowError && locationName) {
      location = resolveEmployeeAliasLocation(locationName, refs.locations);
      if (!location) rowError = 'Could not resolve location_name "' + locationName + '"';
    }

    var item = null;
    if (!rowError) {
      item = resolveEmployeeAliasItem(itemName, refs);
      if (!item) rowError = 'Could not resolve item_name "' + itemName + '" to an inventory item';
    }

    var locationKey = location ? location.id : 'global';
    var duplicateKey = employeeNameKey + '|' + aliasKey + '|' + locationKey;
    rows.push({
      rowNumber: rowNumber,
      duplicateKey: duplicateKey,
      error: rowError,
      payload: rowError ? null : {
        employee_name: employeeName,
        employee_name_key: employeeNameKey,
        alias_text: aliasText,
        alias_key: aliasKey,
        inventory_item_id: item.id,
        location_id: location ? location.id : null,
        active: active,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
    if (!duplicateBuckets[duplicateKey]) duplicateBuckets[duplicateKey] = [];
    duplicateBuckets[duplicateKey].push(rowNumber);
  }

  for (var d = 0; d < rows.length; d++) {
    var duplicateRows = duplicateBuckets[rows[d].duplicateKey] || [];
    if (!rows[d].error && duplicateRows.length > 1) {
      rows[d].error = 'Duplicate alias for this employee + phrase + location in rows ' + duplicateRows.join(', ');
      rows[d].payload = null;
    }
  }

  var synced = 0;
  var failed = 0;
  for (var s = 0; s < rows.length; s++) {
    var entry = rows[s];
    if (entry.error || !entry.payload) {
      failed += 1;
      writeEmployeeAliasSyncStatus(sheet, entry.rowNumber, 'Error', entry.error || 'Unknown sync error', statusColumns);
      continue;
    }

    var response = supabaseUpsert(config.table, [entry.payload], config.conflictColumn);
    if (response.getResponseCode() >= 400) {
      failed += 1;
      writeEmployeeAliasSyncStatus(
        sheet,
        entry.rowNumber,
        'Error',
        employeeAliasSyncErrorMessage(response),
        statusColumns
      );
      continue;
    }

    synced += 1;
    writeEmployeeAliasSyncStatus(sheet, entry.rowNumber, 'Synced', '', statusColumns);
  }

  if (rows.length === 0) return 'No optional data found — app will use defaults';
  return synced + ' rows synced' + (failed > 0 ? ', ' + failed + ' failed' : '');
}

function rowFromHeaders(headers, values) {
  var row = {};
  for (var i = 0; i < headers.length; i++) {
    if (!headers[i]) continue;
    var value = values[i];
    if (value === true) value = true;
    else if (value === false) value = false;
    else if (value === '') value = null;
    row[headers[i]] = value;
  }
  return row;
}

function ensureEmployeeAliasStatusColumns(sheet, headers) {
  var statusIdx = headers.indexOf('sync_status');
  var errorIdx = headers.indexOf('sync_error');
  if (statusIdx === -1) {
    statusIdx = headers.length;
    headers.push('sync_status');
    if (sheet.getRange) sheet.getRange(1, statusIdx + 1).setValue('sync_status');
  }
  if (errorIdx === -1) {
    errorIdx = headers.length;
    headers.push('sync_error');
    if (sheet.getRange) sheet.getRange(1, errorIdx + 1).setValue('sync_error');
  }
  return { statusCol: statusIdx + 1, errorCol: errorIdx + 1 };
}

function writeEmployeeAliasSyncStatus(sheet, rowNumber, status, error, columns) {
  if (!sheet.getRange) return;
  sheet.getRange(rowNumber, columns.statusCol).setValue(status);
  sheet.getRange(rowNumber, columns.errorCol).setValue(error || '');
}

function employeeAliasSyncErrorMessage(response) {
  var body = response.getContentText ? response.getContentText() : '';
  if (/duplicate key|23505/i.test(body)) {
    return 'Duplicate alias for this employee + phrase + location';
  }
  return 'HTTP ' + response.getResponseCode() + ': ' + body;
}

function loadEmployeeAliasReferenceData() {
  var inventoryItems = supabaseSelectFields(
    'inventory_items',
    'id,name,aliases,active',
    false
  ).filter(function(item) { return item.active !== false; });
  var locations = supabaseSelectFields('locations', 'id,name,short_code,active', false)
    .filter(function(location) { return location.active !== false; });
  var aliasRows = []
    .concat(loadOptionalAliasRows('item_aliases'))
    .concat(loadOptionalAliasRows('quick_order_aliases'));
  return {
    inventoryItems: inventoryItems,
    locations: locations,
    aliasRows: aliasRows,
  };
}

function loadOptionalAliasRows(table) {
  return supabaseSelectFields(table, 'item_id,alias', true)
    .filter(function(row) { return normalizeTextCell(row.alias) && normalizeTextCell(row.item_id); });
}

function resolveEmployeeAliasLocation(locationName, locations) {
  var key = normalizeEmployeeAliasKey(locationName);
  for (var i = 0; i < locations.length; i++) {
    if (normalizeEmployeeAliasKey(locations[i].name) === key) return locations[i];
    if (normalizeEmployeeAliasKey(locations[i].short_code) === key) return locations[i];
  }
  return null;
}

function resolveEmployeeAliasItem(itemName, refs) {
  var raw = normalizeTextCell(itemName);
  if (isUuidText(raw)) {
    for (var i = 0; i < refs.inventoryItems.length; i++) {
      if (String(refs.inventoryItems[i].id).toLowerCase() === raw.toLowerCase()) {
        return refs.inventoryItems[i];
      }
    }
  }

  for (var e = 0; e < refs.inventoryItems.length; e++) {
    if (normalizeTextCell(refs.inventoryItems[e].name) === raw) return refs.inventoryItems[e];
  }

  var normalized = normalizeCatalogLookupText(raw);
  for (var n = 0; n < refs.inventoryItems.length; n++) {
    if (normalizeCatalogLookupText(refs.inventoryItems[n].name) === normalized) return refs.inventoryItems[n];
  }

  for (var a = 0; a < refs.inventoryItems.length; a++) {
    var aliases = Array.isArray(refs.inventoryItems[a].aliases) ? refs.inventoryItems[a].aliases : [];
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
      if (normalizeCatalogLookupText(aliases[aliasIndex]) === normalized) return refs.inventoryItems[a];
    }
  }

  for (var r = 0; r < refs.aliasRows.length; r++) {
    if (normalizeCatalogLookupText(refs.aliasRows[r].alias) !== normalized) continue;
    for (var itemIndex = 0; itemIndex < refs.inventoryItems.length; itemIndex++) {
      if (String(refs.inventoryItems[itemIndex].id) === String(refs.aliasRows[r].item_id)) {
        return refs.inventoryItems[itemIndex];
      }
    }
  }

  return null;
}

// ============================================================
// CUSTOM SYNC: Inventory reorder rules
// ============================================================
function syncInventoryReorderRules(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var requiredHeaders = ['active', 'item_name', 'applies_to_mode', 'trigger_type', 'order_strategy'];
  for (var h = 0; h < requiredHeaders.length; h++) {
    if (headers.indexOf(requiredHeaders[h]) === -1) return 'Missing required header "' + requiredHeaders[h] + '"';
  }

  var refs = loadInventoryRuleReferenceData();
  var rows = [];
  var duplicateBuckets = {};
  var allowedModes = ['inventory_only', 'order_only', 'both'];
  var allowedTriggers = ['below', 'at_or_below', 'equal', 'between', 'at_or_above', 'always'];
  var allowedStrategies = ['fixed_order_qty', 'no_order', 'use_existing_recommendation_engine'];

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;

    var rowNumber = i + 1;
    var rowError = null;
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value;
    var itemName = normalizeTextCell(row.item_name);
    var locationName = normalizeTextCell(row.location_name);
    var appliesToMode = normalizeTextCell(row.applies_to_mode || 'inventory_only').toLowerCase();
    var triggerType = normalizeTextCell(row.trigger_type).toLowerCase();
    var triggerQty = normalizeOptionalNumber(row.trigger_qty);
    var triggerQtyMax = normalizeOptionalNumber(row.trigger_qty_max);
    var triggerUnit = normalizeTextCell(row.trigger_unit) || null;
    var orderStrategy = normalizeTextCell(row.order_strategy).toLowerCase();
    var orderQty = normalizeOptionalNumber(row.order_qty);
    var orderUnit = normalizeTextCell(row.order_unit) || null;
    var priority = normalizeOptionalNumber(row.priority);

    if (activeResult.invalid || active === null) rowError = 'active is required and must be TRUE or FALSE';
    else if (!itemName) rowError = 'item_name is required';
    else if (allowedModes.indexOf(appliesToMode) === -1) rowError = 'Invalid applies_to_mode "' + appliesToMode + '"';
    else if (allowedTriggers.indexOf(triggerType) === -1) rowError = 'Invalid trigger_type "' + triggerType + '"';
    else if (allowedStrategies.indexOf(orderStrategy) === -1) rowError = 'Invalid order_strategy "' + orderStrategy + '"';
    else if (triggerQty.invalid) rowError = 'trigger_qty must be numeric';
    else if (triggerQtyMax.invalid) rowError = 'trigger_qty_max must be numeric';
    else if (orderQty.invalid) rowError = 'order_qty must be numeric';
    else if (priority.invalid) rowError = 'priority must be numeric';
    else if (triggerType !== 'always' && (triggerQty.value === null || !triggerUnit)) rowError = 'trigger_qty and trigger_unit are required unless trigger_type is always';
    else if (triggerType === 'between' && triggerQtyMax.value === null) rowError = 'trigger_qty_max is required when trigger_type is between';
    else if (triggerType === 'between' && triggerQty.value !== null && triggerQtyMax.value !== null && triggerQty.value > triggerQtyMax.value) rowError = 'trigger_qty must be less than or equal to trigger_qty_max';
    else if (orderStrategy === 'fixed_order_qty' && (orderQty.value === null || !orderUnit)) rowError = 'fixed_order_qty requires order_qty and order_unit';

    var location = null;
    if (!rowError && locationName) {
      location = resolveEmployeeAliasLocation(locationName, refs.locations);
      if (!location) rowError = 'Could not resolve location_name "' + locationName + '"';
    }

    var item = null;
    if (!rowError) {
      item = resolveEmployeeAliasItem(itemName, refs);
      if (!item) rowError = 'Could not resolve item_name "' + itemName + '" to an inventory item';
    }

    var locationKey = location ? location.id : 'global';
    var duplicateKey = [
      item ? item.id : itemName,
      locationKey,
      triggerType,
      triggerQty.value === null ? 'none' : String(triggerQty.value),
      triggerQtyMax.value === null ? 'none' : String(triggerQtyMax.value),
      triggerUnit ? triggerUnit.toLowerCase() : 'none',
    ].join('|');
    rows.push({
      rowNumber: rowNumber,
      duplicateKey: duplicateKey,
      error: rowError,
      payload: rowError ? null : {
        active: active,
        location_id: location ? location.id : null,
        inventory_item_id: item.id,
        applies_to_mode: appliesToMode,
        trigger_type: triggerType,
        trigger_qty: triggerQty.value,
        trigger_qty_max: triggerQtyMax.value,
        trigger_unit: triggerUnit,
        order_strategy: orderStrategy,
        order_qty: orderQty.value,
        order_unit: orderUnit,
        priority: priority.value === null ? 100 : priority.value,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
    if (!duplicateBuckets[duplicateKey]) duplicateBuckets[duplicateKey] = [];
    duplicateBuckets[duplicateKey].push(rowNumber);
  }

  for (var d = 0; d < rows.length; d++) {
    var duplicateRows = duplicateBuckets[rows[d].duplicateKey] || [];
    if (!rows[d].error && duplicateRows.length > 1) {
      rows[d].error = 'Duplicate reorder rule key in rows ' + duplicateRows.join(', ');
      rows[d].payload = null;
    }
  }

  return syncCustomRows(sheet, config, rows, statusColumns, inventoryRuleSyncErrorMessage);
}

// ============================================================
// CUSTOM SYNC: Inventory status terms
// ============================================================
function syncInventoryStatusTerms(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var requiredHeaders = ['active', 'phrase', 'status', 'recommendation_action'];
  for (var h = 0; h < requiredHeaders.length; h++) {
    if (headers.indexOf(requiredHeaders[h]) === -1) return 'Missing required header "' + requiredHeaders[h] + '"';
  }

  var allowedStatuses = ['enough', 'zero', 'partial', 'low', 'unknown'];
  var allowedUnitBehaviors = ['none', 'detected_unit', 'item_default_unit'];
  var allowedActions = ['no_order', 'check_reorder_rule', 'ask_quantity', 'use_existing_recommendation_engine'];
  var rows = [];
  var duplicateBuckets = {};

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;

    var rowNumber = i + 1;
    var rowError = null;
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value;
    var phrase = normalizeTextCell(row.phrase);
    var phraseKey = normalizeInventoryStatusPhraseKey(row.phrase_key || phrase);
    var status = normalizeTextCell(row.status).toLowerCase();
    var remainingQty = normalizeOptionalNumber(row.remaining_qty);
    var remainingUnitBehavior = normalizeTextCell(row.remaining_unit_behavior || 'none').toLowerCase();
    var recommendationAction = normalizeTextCell(row.recommendation_action).toLowerCase();
    var priority = normalizeOptionalNumber(row.priority);

    if (activeResult.invalid || active === null) rowError = 'active is required and must be TRUE or FALSE';
    else if (!phrase) rowError = 'phrase is required';
    else if (!phraseKey) rowError = 'phrase_key could not be generated';
    else if (allowedStatuses.indexOf(status) === -1) rowError = 'Invalid status "' + status + '"';
    else if (remainingQty.invalid) rowError = 'remaining_qty must be numeric';
    else if (allowedUnitBehaviors.indexOf(remainingUnitBehavior) === -1) rowError = 'Invalid remaining_unit_behavior "' + remainingUnitBehavior + '"';
    else if (allowedActions.indexOf(recommendationAction) === -1) rowError = 'Invalid recommendation_action "' + recommendationAction + '"';
    else if (priority.invalid) rowError = 'priority must be numeric';

    rows.push({
      rowNumber: rowNumber,
      duplicateKey: phraseKey,
      error: rowError,
      payload: rowError ? null : {
        active: active,
        phrase: phrase,
        phrase_key: phraseKey,
        status: status,
        remaining_qty: remainingQty.value,
        remaining_unit_behavior: remainingUnitBehavior,
        recommendation_action: recommendationAction,
        priority: priority.value === null ? 100 : priority.value,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
    if (!duplicateBuckets[phraseKey]) duplicateBuckets[phraseKey] = [];
    duplicateBuckets[phraseKey].push(rowNumber);
  }

  for (var d = 0; d < rows.length; d++) {
    var duplicateRows = duplicateBuckets[rows[d].duplicateKey] || [];
    if (!rows[d].error && duplicateRows.length > 1) {
      rows[d].error = 'Duplicate phrase_key in rows ' + duplicateRows.join(', ');
      rows[d].payload = null;
    }
  }

  return syncCustomRows(sheet, config, rows, statusColumns, inventoryStatusTermSyncErrorMessage);
}

function loadInventoryRuleReferenceData() {
  return loadEmployeeAliasReferenceData();
}

function ensureSyncStatusColumns(sheet, headers) {
  return ensureEmployeeAliasStatusColumns(sheet, headers);
}

function writeSyncStatus(sheet, rowNumber, status, error, columns) {
  writeEmployeeAliasSyncStatus(sheet, rowNumber, status, error, columns);
}

function syncCustomRows(sheet, config, rows, statusColumns, errorFormatter) {
  var synced = 0;
  var failed = 0;
  for (var s = 0; s < rows.length; s++) {
    var entry = rows[s];
    if (entry.error || !entry.payload) {
      failed += 1;
      writeSyncStatus(sheet, entry.rowNumber, 'Error', entry.error || 'Unknown sync error', statusColumns);
      continue;
    }

    var response = supabaseUpsert(config.table, [entry.payload], config.conflictColumn);
    if (response.getResponseCode() >= 400) {
      failed += 1;
      writeSyncStatus(sheet, entry.rowNumber, 'Error', errorFormatter(response), statusColumns);
      continue;
    }

    synced += 1;
    writeSyncStatus(sheet, entry.rowNumber, 'Synced', '', statusColumns);
  }

  if (rows.length === 0) return 'No optional data found — app will use defaults';
  return synced + ' rows synced' + (failed > 0 ? ', ' + failed + ' failed' : '');
}

function inventoryRuleSyncErrorMessage(response) {
  var body = response.getContentText ? response.getContentText() : '';
  if (/duplicate key|23505/i.test(body)) return 'Duplicate active reorder rule key';
  return 'HTTP ' + response.getResponseCode() + ': ' + body;
}

function inventoryStatusTermSyncErrorMessage(response) {
  var body = response.getContentText ? response.getContentText() : '';
  if (/duplicate key|23505/i.test(body)) return 'Duplicate phrase_key';
  return 'HTTP ' + response.getResponseCode() + ': ' + body;
}

// ============================================================
// DELETE ORPHANS: Remove DB rows not in the sheet
// ============================================================
function deleteRemovedRows(ss, config) {
  if (config.disableOrphanDelete) return 0;

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

function supabaseSelectFields(table, select, optional) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?select=' + encodeURIComponent(select) + '&limit=5000';

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 400) {
    if (optional && isOptionalTableUnavailable(response)) return [];
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
    isOrphanDeleteEnabled: isOrphanDeleteEnabled,
    isOptionalQuickOrderOrphanDeleteEnabled: isOptionalQuickOrderOrphanDeleteEnabled,
    syncSheetUpsertOnly: syncSheetUpsertOnly,
    syncEmployeeQuickOrderAliases: syncEmployeeQuickOrderAliases,
    syncInventoryReorderRules: syncInventoryReorderRules,
    syncInventoryStatusTerms: syncInventoryStatusTerms,
    normalizeEmployeeAliasKey: normalizeEmployeeAliasKey,
    normalizeInventoryStatusPhraseKey: normalizeInventoryStatusPhraseKey,
    normalizeCatalogLookupText: normalizeCatalogLookupText,
    resolveEmployeeAliasItem: resolveEmployeeAliasItem,
    resolveEmployeeAliasLocation: resolveEmployeeAliasLocation,
  };
}
