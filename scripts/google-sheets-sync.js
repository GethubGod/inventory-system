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
  {
    sheet: 'settings',
    table: 'app_config',
    conflictColumn: 'key',
    optional: true,
    customSync: 'parserSettings',
    disableOrphanDelete: true,
    meaningfulFields: ['setting_key', 'value', 'notes'],
  },
  { sheet: 'locations', table: 'locations', conflictColumn: 'id' },
  { sheet: 'suppliers', table: 'suppliers', conflictColumn: 'id' },
  {
    sheet: 'items',
    table: 'qo_items',
    conflictColumn: 'item_key,location_key',
    optional: true,
    customSync: 'qoItems',
    disableOrphanDelete: true,
    expectedHeaders: ['name', 'category', 'aliases', 'supplier', 'order_unit', 'target_stock', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
    meaningfulFields: ['name', 'category', 'aliases', 'supplier', 'order_unit', 'target_stock', 'location_scope', 'active', 'notes'],
  },
  {
    sheet: 'inventory_items',
    table: 'inventory_items',
    conflictColumn: 'id',
    optional: true,
    customSync: 'cleanItems',
  },
  {
    sheet: 'reorder_rules',
    table: 'qo_reorder_rules',
    conflictColumn: 'item_name_key,location_key,trigger_unit_key,trigger_at_or_below',
    optional: true,
    customSync: 'qoReorderRules',
    disableOrphanDelete: true,
    expectedHeaders: ['item_name', 'trigger_at_or_below', 'trigger_unit', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
    meaningfulFields: ['item_name', 'trigger_at_or_below', 'trigger_unit', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes'],
  },
  {
    sheet: 'personalization',
    table: 'qo_personalization',
    conflictColumn: 'employee_name_key,rule_type,phrase_key,item_name_key,personal_unit_key,location_key',
    optional: true,
    customSync: 'qoPersonalization',
    disableOrphanDelete: true,
    expectedHeaders: ['employee_name', 'rule_type', 'phrase', 'item_name', 'personal_unit', 'personal_unit_equals', 'trigger_at_or_below', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes', 'sync_status', 'sync_error'],
    meaningfulFields: ['employee_name', 'rule_type', 'phrase', 'item_name', 'personal_unit', 'personal_unit_equals', 'trigger_at_or_below', 'order_qty', 'order_unit', 'location_scope', 'active', 'notes'],
  },
  {
    sheet: 'keywords',
    table: 'qo_keywords',
    conflictColumn: 'phrase_key,meaning_type',
    optional: true,
    customSync: 'qoKeywords',
    disableOrphanDelete: true,
    expectedHeaders: ['phrase', 'meaning_type', 'equals_unit', 'status', 'remaining_qty', 'action', 'active', 'notes', 'sync_status', 'sync_error'],
    meaningfulFields: ['phrase', 'meaning_type', 'equals_unit', 'status', 'remaining_qty', 'action', 'active', 'notes'],
  },
  {
    sheet: 'holiday_overrides',
    table: 'qo_holiday_overrides',
    conflictColumn: 'holiday_name,start_date,end_date,item_name,location_scope',
    optional: true,
    customSync: 'qoHolidayOverrides',
    disableOrphanDelete: true,
    expectedHeaders: ['holiday_name', 'start_date', 'end_date', 'item_name', 'location_scope', 'target_multiplier', 'active', 'notes', 'sync_status', 'sync_error'],
    meaningfulFields: ['holiday_name', 'start_date', 'end_date', 'item_name', 'location_scope', 'target_multiplier', 'active', 'notes'],
  },
  {
    sheet: 'documentation',
    table: null,
    conflictColumn: null,
    optional: true,
    skip: true,
  },
];

const DEPRECATED_QUICK_ORDER_TABS = [
  'aliases',
  'unit_rules',
  'status_terms',
  'employee_quick_order_aliases',
  'inventory_reorder_rules',
  'inventory_status_terms',
  'unit_synonyms',
  'item_allowed_units',
  'item_order_limits',
  'Employee order',
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

function normalizeCatalogLooseLookupText(value) {
  return normalizeTextCell(value)
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B\u2032`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[\/,\-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
    .replace(/'+/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(function(token) {
      return token.length > 3 && token.slice(-1) === 's' ? token.slice(0, -1) : token;
    })
    .join(' ');
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
    if (shouldSkipLegacySheet(ss, config)) {
      log.push('ℹ️ ' + config.sheet + ': skipped because clean replacement tab is present');
      continue;
    }
    try {
      var result = syncSheetUpsertOnly(ss, config);
      log.push('✅ ' + config.sheet + ': ' + result);
      appendSyncLog(ss, config.sheet, result, null);
    } catch (e) {
      log.push('❌ ' + config.sheet + ': ' + e.message);
      appendSyncLog(ss, config.sheet, 'failed', e.message);
    }
  }

  // Delete orphans in REVERSE order (children first) — disabled by default for safety
  for (var i = SYNC_CONFIG.length - 1; i >= 0; i--) {
    var config = SYNC_CONFIG[i];
    if (shouldSkipLegacySheet(ss, config)) continue;
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

function appendSyncLog(ss, tabName, resultText, errorSummary) {
  try {
    var sheet = ss.getSheetByName('sync_log');
    if (!sheet) return;
    var headers = ['synced_at', 'tab_name', 'rows_read', 'rows_synced', 'rows_failed', 'status', 'error_summary'];
    var existing = sheet.getDataRange().getValues();
    if (existing.length === 0 || String(existing[0][0] || '').trim() !== 'synced_at') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    var rowsSynced = extractFirstNumber(resultText);
    var failedMatch = String(resultText || '').match(/,\s*(\d+)\s+failed/i);
    var rowsFailed = failedMatch ? Number(failedMatch[1]) : (errorSummary ? 1 : 0);
    sheet.appendRow([
      new Date(),
      tabName,
      rowsSynced + rowsFailed,
      rowsSynced,
      rowsFailed,
      errorSummary ? 'error' : 'synced',
      errorSummary || '',
    ]);
  } catch (e) {
    Logger.log('sync_log append failed: ' + e.message);
  }
}

function extractFirstNumber(value) {
  var match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function shouldSkipLegacySheet(ss, config) {
  return config.sheet === 'inventory_items' && Boolean(ss.getSheetByName('items'));
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
  if (config.skip) {
    return 'Skipped by design';
  }
  for (var dep = 0; dep < DEPRECATED_QUICK_ORDER_TABS.length; dep++) {
    if (ss.getSheetByName && ss.getSheetByName(DEPRECATED_QUICK_ORDER_TABS[dep])) {
      Logger.log("DEPRECATED tab '" + DEPRECATED_QUICK_ORDER_TABS[dep] + "' detected — no longer synced. Remove from workbook.");
    }
  }
  if (config.customSync === 'parserSettings') {
    return syncParserSettings(ss, config);
  }
  if (config.customSync === 'cleanItems') {
    return syncCleanItems(ss, config);
  }
  if (config.customSync === 'quickOrderAliasRules') {
    return syncQuickOrderAliasRules(ss, config);
  }
  if (config.customSync === 'quickOrderUnitRules') {
    return syncQuickOrderUnitRules(ss, config);
  }
  if (config.customSync === 'quickOrderReorderRules') {
    return syncQuickOrderReorderRules(ss, config);
  }
  if (config.customSync === 'quickOrderStatusTerms') {
    return syncQuickOrderStatusTerms(ss, config);
  }
  if (config.customSync === 'employeeQuickOrderAliases') {
    return syncEmployeeQuickOrderAliases(ss, config);
  }
  if (config.customSync === 'inventoryReorderRules') {
    return syncInventoryReorderRules(ss, config);
  }
  if (config.customSync === 'inventoryStatusTerms') {
    return syncInventoryStatusTerms(ss, config);
  }
  if (config.customSync === 'itemAllowedUnits') {
    return syncItemAllowedUnits(ss, config);
  }
  if (config.customSync === 'qoItems') {
    return syncQoItems(ss, config);
  }
  if (config.customSync === 'qoReorderRules') {
    return syncQoReorderRules(ss, config);
  }
  if (config.customSync === 'qoPersonalization') {
    return syncQoPersonalization(ss, config);
  }
  if (config.customSync === 'qoKeywords') {
    return syncQoKeywords(ss, config);
  }
  if (config.customSync === 'qoHolidayOverrides') {
    return syncQoHolidayOverrides(ss, config);
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
  var inventoryItemLocations = null;
  var inventoryItemSuppliers = null;

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
      if (Object.prototype.hasOwnProperty.call(row, 'location_name')) {
        if (!inventoryItemLocations) {
          inventoryItemLocations = supabaseSelectFields('locations', 'id,name,short_code,active', false)
            .filter(function(location) { return location.active !== false; });
        }
        var locationResult = resolveOptionalLocationName(row.location_name, inventoryItemLocations);
        if (!locationResult.ok) {
          blockingErrors.push(
            'Row ' + (i + 1) + ': Could not resolve location_name "' + normalizeTextCell(row.location_name) + '". Use an exact locations.name/short_code, "All Locations", or leave blank.'
          );
          continue;
        }
        row.location_id = locationResult.location ? locationResult.location.id : null;
        delete row.location_name;
      }

      if (Object.prototype.hasOwnProperty.call(row, 'default_supplier')) {
        if (!inventoryItemSuppliers) {
          inventoryItemSuppliers = supabaseSelectFields('suppliers', 'id,name,supplier_key,supplier_type,active', false)
            .filter(function(supplier) { return supplier.active !== false; });
        }
        var primarySupplier = normalizeTextCell(row.default_supplier)
          ? resolveSupplierName(row.default_supplier, inventoryItemSuppliers)
          : null;
        if (normalizeTextCell(row.default_supplier) && !primarySupplier) {
          blockingErrors.push('Row ' + (i + 1) + ': Could not resolve default_supplier "' + normalizeTextCell(row.default_supplier) + '".');
          continue;
        }
        row.supplier_id = primarySupplier ? primarySupplier.id : null;
        delete row.default_supplier;
      }

      if (Object.prototype.hasOwnProperty.call(row, 'secondary_supplier')) {
        if (!inventoryItemSuppliers) {
          inventoryItemSuppliers = supabaseSelectFields('suppliers', 'id,name,supplier_key,supplier_type,active', false)
            .filter(function(supplier) { return supplier.active !== false; });
        }
        var secondarySupplier = normalizeTextCell(row.secondary_supplier)
          ? resolveSupplierName(row.secondary_supplier, inventoryItemSuppliers)
          : null;
        if (normalizeTextCell(row.secondary_supplier) && !secondarySupplier) {
          blockingErrors.push('Row ' + (i + 1) + ': Could not resolve secondary_supplier "' + normalizeTextCell(row.secondary_supplier) + '".');
          continue;
        }
        row.secondary_supplier_id = secondarySupplier ? secondarySupplier.id : null;
        delete row.secondary_supplier;
      }

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

    if (config.table === 'suppliers') {
      if (Object.prototype.hasOwnProperty.call(row, 'supplier_category')) {
        row.supplier_type = normalizeTextCell(row.supplier_category) || null;
        delete row.supplier_category;
      }
      if (Object.prototype.hasOwnProperty.call(row, 'supplier_key')) {
        row.supplier_key = normalizeTextCell(row.supplier_key) || normalizeCatalogLookupText(row.name);
      }
      if (Object.prototype.hasOwnProperty.call(row, 'email')) {
        row.email = normalizeTextCell(row.email) || null;
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
// CUSTOM SYNC: Quick Order parser V2 settings and clean tabs
// ============================================================
function syncParserSettings(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  if (headers.indexOf('setting_key') === -1 || headers.indexOf('value') === -1) {
    return 'Missing required header "setting_key" or "value"';
  }

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;
    var rowNumber = i + 1;
    var key = normalizeTextCell(row.setting_key);
    rows.push({
      rowNumber: rowNumber,
      duplicateKey: key,
      error: key ? null : 'setting_key is required',
      payload: key ? {
        key: key,
        value: parseSheetSettingValue(row.value),
        description: normalizeTextCell(row.notes) || null,
      } : null,
    });
  }

  return syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate setting_key'), statusColumns, defaultSyncErrorMessage);
}

function parseSheetSettingValue(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'number' && isFinite(value)) return value;
  var text = normalizeTextCell(value);
  if (!text) return '';
  var lower = text.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((text.charAt(0) === '{' && text.charAt(text.length - 1) === '}') ||
      (text.charAt(0) === '[' && text.charAt(text.length - 1) === ']')) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }
  return text;
}

function syncCleanItems(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var requiredHeaders = ['name', 'base_unit'];
  for (var h = 0; h < requiredHeaders.length; h++) {
    if (headers.indexOf(requiredHeaders[h]) === -1) return 'Missing required header "' + requiredHeaders[h] + '"';
  }

  var refs = loadCleanItemReferenceData();
  var idColIdx = headers.indexOf('id');
  var rows = [];
  var newRowIndices = [];
  var newRowUuids = [];

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, { meaningfulFields: ['item_key', 'name', 'category', 'supplier_category', 'default_supplier', 'location_name', 'base_unit', 'pack_unit', 'notes'] })) continue;

    var rowNumber = i + 1;
    var rowError = null;
    var id = normalizeTextCell(row.id);
    var itemName = normalizeTextCell(row.name);
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value === null ? true : activeResult.value;
    var packSize = normalizeOptionalNumber(row.pack_size);

    if (!itemName) rowError = 'name is required';
    else if (!normalizeTextCell(row.base_unit)) rowError = 'base_unit is required';
    else if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';
    else if (packSize.invalid) rowError = 'pack_size must be numeric';

    var location = null;
    if (!rowError && normalizeTextCell(row.location_name)) {
      var locationResult = resolveOptionalLocationName(row.location_name, refs.locations);
      if (!locationResult.ok) rowError = 'Could not resolve location_name "' + normalizeTextCell(row.location_name) + '"';
      else location = locationResult.location;
    }

    var primarySupplier = null;
    if (!rowError && normalizeTextCell(row.default_supplier)) {
      primarySupplier = resolveSupplierName(row.default_supplier, refs.suppliers);
      if (!primarySupplier) rowError = 'Could not resolve default_supplier "' + normalizeTextCell(row.default_supplier) + '"';
    }

    var secondarySupplier = null;
    if (!rowError && normalizeTextCell(row.secondary_supplier)) {
      secondarySupplier = resolveSupplierName(row.secondary_supplier, refs.suppliers);
      if (!secondarySupplier) rowError = 'Could not resolve secondary_supplier "' + normalizeTextCell(row.secondary_supplier) + '"';
    }

    if (idColIdx !== -1 && !id && !rowError) {
      id = Utilities.getUuid();
      newRowIndices.push(i);
      newRowUuids.push(id);
    }

    rows.push({
      rowNumber: rowNumber,
      duplicateKey: normalizeCatalogLookupText(itemName),
      error: rowError,
      payload: rowError ? null : removeNullValues({
        id: id || null,
        item_key: normalizeTextCell(row.item_key) || normalizeCatalogLookupText(itemName),
        name: itemName,
        category: normalizeTextCell(row.category).toLowerCase() || null,
        supplier_category: normalizeTextCell(row.supplier_category).toLowerCase() || null,
        supplier_id: primarySupplier ? primarySupplier.id : null,
        secondary_supplier_id: secondarySupplier ? secondarySupplier.id : null,
        location_id: location ? location.id : null,
        base_unit: normalizeTextCell(row.base_unit),
        pack_unit: normalizeTextCell(row.pack_unit),
        pack_size: packSize.value === null ? 1 : packSize.value,
        active: active,
        notes: normalizeTextCell(row.notes) || null,
      }),
    });
  }

  var result = syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate item name'), statusColumns, defaultSyncErrorMessage);
  writeGeneratedIds(sheet, idColIdx, newRowIndices, newRowUuids);
  return result;
}

function validateExactHeaders(headers, expectedHeaders) {
  if (!expectedHeaders) return null;
  if (headers.length !== expectedHeaders.length) {
    return 'Headers must match exactly: ' + expectedHeaders.join(', ');
  }
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (headers[i] !== expectedHeaders[i]) {
      return 'Headers must match exactly: ' + expectedHeaders.join(', ');
    }
  }
  return null;
}

function syncQoItems(ss, config) {
  return syncQoRows(ss, config, function(row, refs) {
    var name = normalizeTextCell(row.name);
    var supplierName = normalizeTextCell(row.supplier);
    var orderUnit = normalizeTextCell(row.order_unit);
    var targetStock = normalizeOptionalNumber(row.target_stock);
    var activeResult = normalizeOptionalBoolean(row.active);
    var locationResult = resolveOptionalLocationName(row.location_scope, refs.locations);
    var supplier = supplierName ? resolveSupplierName(supplierName, refs.suppliers) : null;
    var inventoryResult = name ? resolveQoInventoryItem(name, refs.inventoryItems) : { ok: false, reason: 'not_found' };
    var error = null;
    if (!name) error = 'name is required';
    else if (!supplierName) error = 'supplier is required';
    else if (!supplier) error = 'Could not resolve supplier "' + supplierName + '"';
    else if (!orderUnit) error = 'order_unit is required';
    else if (targetStock.invalid) error = 'target_stock must be numeric';
    else if (activeResult.invalid) error = 'active must be TRUE or FALSE';
    else if (!locationResult.ok) error = 'Could not resolve location_scope "' + normalizeTextCell(row.location_scope) + '"';
    else if (!inventoryResult.ok) error = formatQoCatalogResolutionError(name, inventoryResult);
    return {
      duplicateKey: normalizeCatalogLookupText(name) + '|' + (locationResult.location ? locationResult.location.id : normalizeEmployeeAliasKey(row.location_scope) || 'global'),
      error: error,
      payload: error ? null : {
        name: name,
        category: normalizeTextCell(row.category) || null,
        aliases: normalizeTextCell(row.aliases) || null,
        supplier: supplierName,
        supplier_id: supplier.id,
        order_unit: orderUnit,
        target_stock: targetStock.value,
        location_scope: normalizeTextCell(row.location_scope) || null,
        location_id: locationResult.location ? locationResult.location.id : null,
        active: activeResult.value === null ? true : activeResult.value,
        notes: normalizeTextCell(row.notes) || null,
        sync_status: 'Synced',
        sync_error: null,
        inventory_item_id: inventoryResult.ok ? inventoryResult.item.id : null,
      },
    };
  });
}

function syncQoReorderRules(ss, config) {
  return syncQoRows(ss, config, function(row, refs) {
    var itemName = normalizeTextCell(row.item_name);
    var trigger = normalizeOptionalNumber(row.trigger_at_or_below);
    var orderQty = normalizeOptionalNumber(row.order_qty);
    var activeResult = normalizeOptionalBoolean(row.active);
    var locationResult = resolveOptionalLocationName(row.location_scope, refs.locations);
    var itemResult = itemName ? resolveQoItem(itemName, refs.qoItems) : { ok: false, reason: 'not_found' };
    var error = null;
    if (!itemName) error = 'item_name is required';
    else if (!itemResult.ok) error = formatQoCatalogResolutionError(itemName, itemResult);
    else if (trigger.invalid || trigger.value === null) error = 'trigger_at_or_below must be numeric';
    else if (!normalizeTextCell(row.trigger_unit)) error = 'trigger_unit is required';
    else if (orderQty.invalid || orderQty.value === null) error = 'order_qty must be numeric';
    else if (activeResult.invalid) error = 'active must be TRUE or FALSE';
    else if (!locationResult.ok) error = 'Could not resolve location_scope "' + normalizeTextCell(row.location_scope) + '"';
    return {
      duplicateKey: [normalizeCatalogLookupText(itemName), locationResult.location ? locationResult.location.id : 'global', normalizeEmployeeAliasKey(row.trigger_unit), trigger.value].join('|'),
      error: error,
      payload: error ? null : {
        item_name: itemResult.item.name,
        qo_item_id: itemResult.item.id,
        trigger_at_or_below: trigger.value,
        trigger_unit: normalizeTextCell(row.trigger_unit),
        order_qty: orderQty.value,
        order_unit: normalizeTextCell(row.order_unit) || normalizeTextCell(row.trigger_unit),
        location_scope: normalizeTextCell(row.location_scope) || null,
        location_id: locationResult.location ? locationResult.location.id : null,
        active: activeResult.value === null ? true : activeResult.value,
        notes: normalizeTextCell(row.notes) || null,
        sync_status: 'Synced',
        sync_error: null,
      },
    };
  });
}

function syncQoPersonalization(ss, config) {
  return syncQoRows(ss, config, function(row, refs) {
    var employeeName = normalizeTextCell(row.employee_name);
    var ruleType = normalizeTextCell(row.rule_type).toLowerCase();
    var itemName = normalizeTextCell(row.item_name);
    var itemResult = itemName ? resolveQoItem(itemName, refs.qoItems) : { ok: false, reason: 'not_found' };
    var activeResult = normalizeOptionalBoolean(row.active);
    var trigger = normalizeOptionalNumber(row.trigger_at_or_below);
    var orderQty = normalizeOptionalNumber(row.order_qty);
    var locationResult = resolveOptionalLocationName(row.location_scope, refs.locations);
    var hasItemConfig = Boolean(normalizeTextCell(row.personal_unit) || normalizeTextCell(row.personal_unit_equals) || trigger.value !== null || orderQty.value !== null || normalizeTextCell(row.order_unit));
    var error = null;
    if (!employeeName) error = 'employee_name is required';
    else if (ruleType !== 'alias' && ruleType !== 'item_config') error = 'rule_type must be alias or item_config';
    else if (!itemName) error = 'item_name is required';
    else if (!itemResult.ok) error = formatQoCatalogResolutionError(itemName, itemResult);
    else if (ruleType === 'alias' && !normalizeTextCell(row.phrase)) error = 'phrase is required for alias rows';
    else if (ruleType === 'alias' && hasItemConfig) error = 'alias rows cannot populate item_config fields';
    else if (ruleType === 'item_config' && trigger.invalid) error = 'trigger_at_or_below must be numeric';
    else if (ruleType === 'item_config' && orderQty.invalid) error = 'order_qty must be numeric';
    else if (activeResult.invalid) error = 'active must be TRUE or FALSE';
    else if (!locationResult.ok) error = 'Could not resolve location_scope "' + normalizeTextCell(row.location_scope) + '"';
    return {
      duplicateKey: [normalizeEmployeeAliasKey(employeeName), ruleType, normalizeEmployeeAliasKey(row.phrase) || 'none', itemResult.ok ? itemResult.item.id : itemName, normalizeEmployeeAliasKey(row.personal_unit) || 'none', locationResult.location ? locationResult.location.id : 'global'].join('|'),
      error: error,
      payload: error ? null : {
        employee_name: employeeName,
        rule_type: ruleType,
        phrase: normalizeTextCell(row.phrase) || null,
        item_name: itemResult.item.name,
        qo_item_id: itemResult.item.id,
        personal_unit: normalizeTextCell(row.personal_unit) || null,
        personal_unit_equals: normalizeTextCell(row.personal_unit_equals) || null,
        trigger_at_or_below: trigger.value,
        order_qty: orderQty.value,
        order_unit: normalizeTextCell(row.order_unit) || null,
        location_scope: normalizeTextCell(row.location_scope) || null,
        location_id: locationResult.location ? locationResult.location.id : null,
        active: activeResult.value === null ? true : activeResult.value,
        notes: normalizeTextCell(row.notes) || null,
        sync_status: 'Synced',
        sync_error: null,
      },
    };
  });
}

function syncQoKeywords(ss, config) {
  return syncQoRows(ss, config, function(row) {
    var phrase = normalizeTextCell(row.phrase);
    var meaningType = normalizeTextCell(row.meaning_type).toLowerCase();
    var status = normalizeTextCell(row.status).toLowerCase();
    var action = normalizeTextCell(row.action).toLowerCase();
    var remainingQty = normalizeOptionalNumber(row.remaining_qty);
    var activeResult = normalizeOptionalBoolean(row.active);
    var error = null;
    if (!phrase) error = 'phrase is required';
    else if (['status_term', 'unit_alias', 'ignore'].indexOf(meaningType) === -1) error = 'Invalid meaning_type';
    else if (meaningType === 'unit_alias' && !normalizeTextCell(row.equals_unit)) error = 'unit_alias requires equals_unit';
    else if (meaningType === 'unit_alias' && (status || action || remainingQty.value !== null)) error = 'unit_alias rows cannot populate status fields';
    else if (meaningType === 'status_term' && ['enough', 'zero', 'partial', 'low'].indexOf(status) === -1) error = 'Invalid status';
    else if (meaningType === 'status_term' && ['no_order', 'check_reorder_rule'].indexOf(action) === -1) error = 'Invalid action';
    else if (meaningType === 'ignore' && (normalizeTextCell(row.equals_unit) || status || remainingQty.value !== null)) error = 'ignore rows cannot populate unit/status fields';
    else if (remainingQty.invalid) error = 'remaining_qty must be numeric';
    else if (activeResult.invalid) error = 'active must be TRUE or FALSE';
    return {
      duplicateKey: normalizeEmployeeAliasKey(phrase) + '|' + meaningType,
      error: error,
      payload: error ? null : {
        phrase: phrase,
        meaning_type: meaningType,
        equals_unit: normalizeTextCell(row.equals_unit) || null,
        status: status || null,
        remaining_qty: remainingQty.value,
        action: meaningType === 'ignore' ? 'strip_and_continue' : action || null,
        active: activeResult.value === null ? true : activeResult.value,
        notes: normalizeTextCell(row.notes) || null,
        sync_status: 'Synced',
        sync_error: null,
      },
    };
  });
}

function syncQoHolidayOverrides(ss, config) {
  return syncQoRows(ss, config, function(row) {
    var multiplier = normalizeOptionalNumber(row.target_multiplier);
    var activeResult = normalizeOptionalBoolean(row.active);
    var error = null;
    if (!normalizeTextCell(row.holiday_name)) error = 'holiday_name is required';
    else if (!normalizeTextCell(row.start_date)) error = 'start_date is required';
    else if (!normalizeTextCell(row.end_date)) error = 'end_date is required';
    else if (!normalizeTextCell(row.item_name)) error = 'item_name is required';
    else if (multiplier.invalid) error = 'target_multiplier must be numeric';
    else if (activeResult.invalid) error = 'active must be TRUE or FALSE';
    return {
      duplicateKey: [row.holiday_name, row.start_date, row.end_date, row.item_name, row.location_scope || 'global'].join('|'),
      error: error,
      payload: error ? null : {
        holiday_name: normalizeTextCell(row.holiday_name),
        start_date: normalizeTextCell(row.start_date),
        end_date: normalizeTextCell(row.end_date),
        item_name: normalizeTextCell(row.item_name),
        location_scope: normalizeTextCell(row.location_scope) || null,
        target_multiplier: multiplier.value === null ? 1 : multiplier.value,
        active: activeResult.value === null ? true : activeResult.value,
        notes: normalizeTextCell(row.notes) || null,
        sync_status: 'Synced',
        sync_error: null,
      },
    };
  });
}

function syncQoRows(ss, config, mapper) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var headerError = validateExactHeaders(headers, config.expectedHeaders);
  if (headerError) return headerError;
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var refs = loadQoReferenceData();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;
    var mapped = mapper(row, refs);
    mapped.rowNumber = i + 1;
    rows.push(mapped);
  }
  return syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate row'), statusColumns, defaultSyncErrorMessage);
}

function loadQoReferenceData() {
  return {
    inventoryItems: supabaseSelectFields('inventory_items', 'id,name,aliases,active', false)
      .filter(function(item) { return item.active !== false; }),
    qoItems: supabaseSelectFields('qo_items', 'id,name,aliases,inventory_item_id,active', true)
      .filter(function(item) { return item.active !== false; }),
    locations: supabaseSelectFields('locations', 'id,name,short_code,active', false)
      .filter(function(location) { return location.active !== false; }),
    suppliers: supabaseSelectFields('suppliers', 'id,name,supplier_key,supplier_type,active', false)
      .filter(function(supplier) { return supplier.active !== false; }),
  };
}

function splitQoItemAliases(aliases) {
  if (aliases === null || aliases === undefined) return [];
  var text = normalizeTextCell(aliases);
  if (!text) return [];
  return text.split(',').map(function(alias) { return alias.trim(); }).filter(Boolean);
}

function resolveQoInventoryItem(name, items) {
  var key = normalizeCatalogLookupText(name);
  if (!key) return { ok: false, reason: 'not_found' };

  for (var i = 0; i < items.length; i++) {
    if (normalizeCatalogLookupText(items[i].name) === key) {
      return { ok: true, item: items[i], via_alias: false };
    }
  }

  var aliasMatches = [];
  for (var j = 0; j < items.length; j++) {
    var aliases = Array.isArray(items[j].aliases) ? items[j].aliases : [];
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
      if (!aliases[aliasIndex]) continue;
      if (normalizeCatalogLookupText(aliases[aliasIndex]) === key) {
        aliasMatches.push(items[j]);
        break;
      }
    }
  }

  if (aliasMatches.length === 1) return { ok: true, item: aliasMatches[0], via_alias: true };
  if (aliasMatches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_alias',
      candidates: aliasMatches.map(function(match) { return match.name; }),
    };
  }
  return { ok: false, reason: 'not_found' };
}

function resolveQoItem(name, items) {
  var key = normalizeCatalogLookupText(name);
  if (!key) return { ok: false, reason: 'not_found' };

  for (var i = 0; i < items.length; i++) {
    if (normalizeCatalogLookupText(items[i].name) === key) {
      return { ok: true, item: items[i], via_alias: false };
    }
  }

  var aliasMatches = [];
  for (var j = 0; j < items.length; j++) {
    var aliases = splitQoItemAliases(items[j].aliases);
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
      if (normalizeCatalogLookupText(aliases[aliasIndex]) === key) {
        aliasMatches.push(items[j]);
        break;
      }
    }
  }

  if (aliasMatches.length === 1) return { ok: true, item: aliasMatches[0], via_alias: true };
  if (aliasMatches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_alias',
      candidates: aliasMatches.map(function(match) { return match.name; }),
    };
  }
  return { ok: false, reason: 'not_found' };
}

function formatQoCatalogResolutionError(inputName, result) {
  if (result.reason === 'ambiguous_alias') {
    return 'Alias "' + inputName + '" matches multiple items: ' + result.candidates.join(', ') + '. Disambiguate on the sheet.';
  }
  return 'Could not resolve "' + inputName + '" to any item or alias.';
}

function syncQuickOrderAliasRules(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var requiredHeaders = ['alias_text', 'item_name'];
  for (var h = 0; h < requiredHeaders.length; h++) {
    if (headers.indexOf(requiredHeaders[h]) === -1) return 'Missing required header "' + requiredHeaders[h] + '"';
  }

  var refs = loadEmployeeAliasReferenceData();
  var rows = [];
  var allowedScopes = ['global', 'employee'];
  var allowedModes = ['order', 'inventory', 'both'];

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;
    var rowNumber = i + 1;
    var rowError = null;
    var aliasText = normalizeTextCell(row.alias_text);
    var itemName = normalizeTextCell(row.item_name);
    var employeeName = normalizeTextCell(row.employee_name);
    var scopeType = normalizeTextCell(row.scope_type || (employeeName ? 'employee' : 'global')).toLowerCase();
    var modeScope = normalizeTextCell(row.mode_scope || (scopeType === 'employee' ? 'inventory' : 'both')).toLowerCase();
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value === null ? true : activeResult.value;

    if (!aliasText) rowError = 'alias_text is required';
    else if (!itemName) rowError = 'item_name is required';
    else if (allowedScopes.indexOf(scopeType) === -1) rowError = 'Invalid scope_type "' + scopeType + '"';
    else if (scopeType === 'employee' && !employeeName) rowError = 'employee_name is required when scope_type is employee';
    else if (allowedModes.indexOf(modeScope) === -1) rowError = 'Invalid mode_scope "' + modeScope + '"';
    else if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';

    var location = null;
    if (!rowError && normalizeTextCell(row.location_name)) {
      var locationResult = resolveOptionalLocationName(row.location_name, refs.locations);
      if (!locationResult.ok) rowError = 'Could not resolve location_name "' + normalizeTextCell(row.location_name) + '"';
      else location = locationResult.location;
    }

    var item = null;
    if (!rowError) {
      item = resolveEmployeeAliasItem(itemName, refs);
      if (!item) rowError = 'Could not resolve item_name "' + itemName + '" to an inventory item';
    }

    rows.push({
      rowNumber: rowNumber,
      duplicateKey: [normalizeEmployeeAliasKey(aliasText), scopeType, normalizeEmployeeAliasKey(employeeName) || 'global', modeScope, location ? location.id : 'global'].join('|'),
      error: rowError,
      payload: rowError ? null : {
        alias_text: aliasText,
        item_id: item.id,
        scope_type: scopeType,
        employee_name: scopeType === 'employee' ? employeeName : null,
        mode_scope: modeScope,
        location_id: location ? location.id : null,
        active: active,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
  }

  return syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate alias rule'), statusColumns, defaultSyncErrorMessage);
}

function syncQuickOrderUnitRules(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  if (headers.indexOf('to_unit') === -1) return 'Missing required header "to_unit"';

  var refs = loadEmployeeAliasReferenceData();
  var rows = [];
  var allowedScopes = ['global', 'employee'];
  var allowedModes = ['order', 'inventory', 'both'];

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;
    var rowNumber = i + 1;
    var rowError = null;
    var itemName = normalizeTextCell(row.item_name);
    var fromUnit = normalizeTextCell(row.from_unit);
    var toUnit = normalizeTextCell(row.to_unit).toLowerCase();
    var employeeName = normalizeTextCell(row.employee_name);
    var scopeType = normalizeTextCell(row.scope_type || (employeeName ? 'employee' : 'global')).toLowerCase();
    var modeScope = normalizeTextCell(row.mode_scope || 'both').toLowerCase();
    var multiplier = normalizeOptionalNumber(row.multiplier);
    var defaultResult = normalizeOptionalBoolean(row.is_default_when_missing);
    var isDefault = defaultResult.value === null ? false : defaultResult.value;
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value === null ? true : activeResult.value;

    if (!toUnit) rowError = 'to_unit is required';
    else if (!itemName && isDefault) rowError = 'item_name is required for missing-unit defaults';
    else if (!itemName && !fromUnit) rowError = 'from_unit is required for global unit synonyms';
    else if (allowedScopes.indexOf(scopeType) === -1) rowError = 'Invalid scope_type "' + scopeType + '"';
    else if (scopeType === 'employee' && !employeeName) rowError = 'employee_name is required when scope_type is employee';
    else if (allowedModes.indexOf(modeScope) === -1) rowError = 'Invalid mode_scope "' + modeScope + '"';
    else if (multiplier.invalid) rowError = 'multiplier must be numeric';
    else if (multiplier.value !== null && multiplier.value <= 0) rowError = 'multiplier must be greater than 0';
    else if (defaultResult.invalid) rowError = 'is_default_when_missing must be TRUE or FALSE';
    else if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';

    var location = null;
    if (!rowError && normalizeTextCell(row.location_name)) {
      var locationResult = resolveOptionalLocationName(row.location_name, refs.locations);
      if (!locationResult.ok) rowError = 'Could not resolve location_name "' + normalizeTextCell(row.location_name) + '"';
      else location = locationResult.location;
    }

    var item = null;
    if (!rowError && itemName) {
      item = resolveEmployeeAliasItem(itemName, refs);
      if (!item) rowError = 'Could not resolve item_name "' + itemName + '" to an inventory item';
    }

    rows.push({
      rowNumber: rowNumber,
      duplicateKey: [item ? item.id : 'global', normalizeEmployeeAliasKey(fromUnit) || 'missing', scopeType, normalizeEmployeeAliasKey(employeeName) || 'global', modeScope, location ? location.id : 'global', String(isDefault)].join('|'),
      error: rowError,
      payload: rowError ? null : {
        item_id: item ? item.id : null,
        from_unit: fromUnit || null,
        to_unit: toUnit,
        multiplier: multiplier.value === null ? 1 : multiplier.value,
        scope_type: scopeType,
        employee_name: scopeType === 'employee' ? employeeName : null,
        mode_scope: modeScope,
        location_id: location ? location.id : null,
        is_default_when_missing: isDefault,
        active: active,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
  }

  return syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate unit rule'), statusColumns, defaultSyncErrorMessage);
}

function syncQuickOrderReorderRules(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var requiredHeaders = ['item_name', 'trigger_type', 'action_type'];
  for (var h = 0; h < requiredHeaders.length; h++) {
    if (headers.indexOf(requiredHeaders[h]) === -1) return 'Missing required header "' + requiredHeaders[h] + '"';
  }

  var refs = loadEmployeeAliasReferenceData();
  var rows = [];
  var allowedScopes = ['global', 'employee'];
  var allowedModes = ['order', 'inventory', 'both'];
  var allowedTriggers = ['below', 'at_or_below', 'between', 'equal', 'status'];
  var allowedActions = ['fixed_order_qty', 'top_up_to_target', 'no_order', 'ask'];

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;
    var rowNumber = i + 1;
    var rowError = null;
    var itemName = normalizeTextCell(row.item_name);
    var employeeName = normalizeTextCell(row.employee_name);
    var scopeType = normalizeTextCell(row.scope_type || (employeeName ? 'employee' : 'global')).toLowerCase();
    var modeScope = normalizeTextCell(row.mode_scope || 'inventory').toLowerCase();
    var countedUnit = normalizeTextCell(row.counted_unit).toLowerCase();
    var triggerType = normalizeTextCell(row.trigger_type).toLowerCase();
    var triggerMin = normalizeOptionalNumber(row.trigger_qty_min);
    var triggerMax = normalizeOptionalNumber(row.trigger_qty_max);
    var actionType = normalizeTextCell(row.action_type).toLowerCase();
    var orderQty = normalizeOptionalNumber(row.order_qty);
    var orderUnit = normalizeTextCell(row.order_unit).toLowerCase();
    var targetQty = normalizeOptionalNumber(row.target_qty);
    var targetUnit = normalizeTextCell(row.target_unit).toLowerCase();
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value === null ? true : activeResult.value;

    if (!itemName) rowError = 'item_name is required';
    else if (allowedScopes.indexOf(scopeType) === -1) rowError = 'Invalid scope_type "' + scopeType + '"';
    else if (scopeType === 'employee' && !employeeName) rowError = 'employee_name is required when scope_type is employee';
    else if (allowedModes.indexOf(modeScope) === -1) rowError = 'Invalid mode_scope "' + modeScope + '"';
    else if (allowedTriggers.indexOf(triggerType) === -1) rowError = 'Invalid trigger_type "' + triggerType + '"';
    else if (allowedActions.indexOf(actionType) === -1) rowError = 'Invalid action_type "' + actionType + '"';
    else if (triggerMin.invalid) rowError = 'trigger_qty_min must be numeric';
    else if (triggerMax.invalid) rowError = 'trigger_qty_max must be numeric';
    else if (orderQty.invalid) rowError = 'order_qty must be numeric';
    else if (targetQty.invalid) rowError = 'target_qty must be numeric';
    else if (triggerType !== 'status' && triggerMin.value === null) rowError = 'trigger_qty_min is required unless trigger_type is status';
    else if (triggerType === 'between' && triggerMax.value === null) rowError = 'trigger_qty_max is required when trigger_type is between';
    else if (triggerType === 'between' && triggerMin.value !== null && triggerMax.value !== null && triggerMin.value > triggerMax.value) rowError = 'trigger_qty_min must be less than or equal to trigger_qty_max';
    else if (actionType === 'fixed_order_qty' && (orderQty.value === null || !orderUnit)) rowError = 'fixed_order_qty requires order_qty and order_unit';
    else if (actionType === 'top_up_to_target' && (targetQty.value === null || !targetUnit)) rowError = 'top_up_to_target requires target_qty and target_unit';
    else if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';

    var location = null;
    if (!rowError && normalizeTextCell(row.location_name)) {
      var locationResult = resolveOptionalLocationName(row.location_name, refs.locations);
      if (!locationResult.ok) rowError = 'Could not resolve location_name "' + normalizeTextCell(row.location_name) + '"';
      else location = locationResult.location;
    }

    var item = null;
    if (!rowError) {
      item = resolveEmployeeAliasItem(itemName, refs);
      if (!item) rowError = 'Could not resolve item_name "' + itemName + '" to an inventory item';
    }

    rows.push({
      rowNumber: rowNumber,
      duplicateKey: [item ? item.id : itemName, scopeType, normalizeEmployeeAliasKey(employeeName) || 'global', modeScope, location ? location.id : 'global', countedUnit || 'any', triggerType, triggerMin.value === null ? 'none' : String(triggerMin.value), triggerMax.value === null ? 'none' : String(triggerMax.value)].join('|'),
      error: rowError,
      payload: rowError ? null : {
        item_id: item.id,
        scope_type: scopeType,
        employee_name: scopeType === 'employee' ? employeeName : null,
        mode_scope: modeScope,
        location_id: location ? location.id : null,
        counted_unit: countedUnit || null,
        trigger_type: triggerType,
        trigger_qty_min: triggerMin.value,
        trigger_qty_max: triggerMax.value,
        action_type: actionType,
        order_qty: orderQty.value,
        order_unit: orderUnit || null,
        target_qty: targetQty.value,
        target_unit: targetUnit || null,
        active: active,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
  }

  return syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate reorder rule'), statusColumns, defaultSyncErrorMessage);
}

function syncQuickOrderStatusTerms(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  if (headers.indexOf('phrase') === -1 || headers.indexOf('status') === -1 || headers.indexOf('recommendation_action') === -1) {
    return 'Missing required header "phrase", "status", or "recommendation_action"';
  }

  var rows = [];
  var allowedStatuses = ['enough', 'out', 'low', 'unknown'];
  var allowedActions = ['no_order', 'order_needed', 'calculate_order', 'ask'];
  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;
    var rowNumber = i + 1;
    var phrase = normalizeTextCell(row.phrase);
    var phraseKey = normalizeInventoryStatusPhraseKey(phrase);
    var status = normalizeTextCell(row.status).toLowerCase();
    var action = normalizeTextCell(row.recommendation_action).toLowerCase();
    var activeResult = normalizeOptionalBoolean(row.active);
    var active = activeResult.value === null ? true : activeResult.value;
    var rowError = null;

    if (!phrase) rowError = 'phrase is required';
    else if (!phraseKey) rowError = 'phrase could not be normalized';
    else if (allowedStatuses.indexOf(status) === -1) rowError = 'Invalid status "' + status + '"';
    else if (allowedActions.indexOf(action) === -1) rowError = 'Invalid recommendation_action "' + action + '"';
    else if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';

    rows.push({
      rowNumber: rowNumber,
      duplicateKey: phraseKey,
      error: rowError,
      payload: rowError ? null : {
        phrase: phrase,
        status: status,
        recommendation_action: action,
        active: active,
        notes: normalizeTextCell(row.notes) || null,
        source: 'google_sheet',
      },
    });
  }

  return syncCustomRows(sheet, config, markDuplicateRows(rows, 'Duplicate phrase'), statusColumns, defaultSyncErrorMessage);
}

// ============================================================
// CUSTOM SYNC: Item allowed units (employee-specific rules)
// ============================================================
function syncItemAllowedUnits(ss, config) {
  var sheet = ss.getSheetByName(config.sheet);
  if (!sheet) return 'Optional sheet missing, skipped';

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 'No optional data found — app will use defaults';

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var statusColumns = ensureEmployeeAliasStatusColumns(sheet, headers);
  var required = ['item_name', 'unit'];
  for (var r = 0; r < required.length; r++) {
    if (headers.indexOf(required[r]) === -1) {
      return 'Missing required header "' + required[r] + '"';
    }
  }

  var refs = loadEmployeeAliasReferenceData();
  var rows = [];
  var idColIdx = headers.indexOf('id');
  var newRowIndices = [];
  var newRowUuids = [];

  for (var i = 1; i < data.length; i++) {
    var row = rowFromHeaders(headers, data[i]);
    if (!rowHasMeaningfulOptionalData(row, config)) continue;

    var rowNumber = i + 1;
    var id = normalizeTextCell(row.id);
    var itemName = normalizeTextCell(row.item_name);
    var unit = normalizeTextCell(row.unit);
    var minQtyResult = normalizeOptionalNumber(row.min_quantity);
    var maxQtyResult = normalizeOptionalNumber(row.max_quantity);
    var orderQtyResult = normalizeOptionalNumber(row.order_quantity);
    var orderUnit = normalizeTextCell(row.order_unit);
    var employeeNames = normalizeTextCell(row.employee_names);
    var rowError = null;

    if (!itemName) rowError = 'item_name is required';
    else if (!unit) rowError = 'unit is required';
    else if (minQtyResult.invalid) rowError = 'min_quantity must be a number';
    else if (maxQtyResult.invalid) rowError = 'max_quantity must be a number';
    else if (orderQtyResult.invalid) rowError = 'order_quantity must be a number';

    var item = null;
    if (!rowError) {
      item = resolveEmployeeAliasItem(itemName, refs);
      if (!item) rowError = 'Could not resolve item_name "' + itemName + '" to an inventory item';
    }

    if (idColIdx !== -1 && !id && !rowError) {
      id = Utilities.getUuid();
      newRowIndices.push(i);
      newRowUuids.push(id);
    }

    rows.push({
      rowNumber: rowNumber,
      error: rowError,
      payload: rowError ? null : {
        id: id || null,
        item_id: item.id,
        unit: unit,
        is_default: false,
        conversion_to_base_unit: 1,
        min_quantity: minQtyResult.value,
        max_quantity: maxQtyResult.value,
        order_quantity: orderQtyResult.value,
        order_unit: orderUnit || null,
        employee_names: employeeNames || null,
      },
    });
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

    var payload = {};
    for (var key in entry.payload) {
      if (entry.payload[key] !== null) payload[key] = entry.payload[key];
    }

    var response = supabaseUpsert(config.table, [payload], config.conflictColumn);
    if (response.getResponseCode() >= 400) {
      failed += 1;
      writeEmployeeAliasSyncStatus(
        sheet,
        entry.rowNumber,
        'Error',
        'HTTP ' + response.getResponseCode() + ': ' + response.getContentText(),
        statusColumns
      );
      continue;
    }

    synced += 1;
    writeEmployeeAliasSyncStatus(sheet, entry.rowNumber, 'Synced', '', statusColumns);
  }

  // Write back auto-generated UUIDs
  if (newRowIndices.length > 0 && idColIdx !== -1) {
    for (var k = 0; k < newRowIndices.length; k++) {
      var sheetRow = newRowIndices[k] + 1;
      sheet.getRange(sheetRow, idColIdx + 1).setValue(newRowUuids[k]);
    }
  }

  if (rows.length === 0) return 'No optional data found — app will use defaults';
  return synced + ' rows synced' + (failed > 0 ? ', ' + failed + ' failed' : '');
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

function normalizeInventoryReorderRuleHeaders(headers) {
  var normalized = headers.slice();
  var hasAppliesToMode = normalized.indexOf('applies_to_mode') !== -1;
  var hasTriggerType = normalized.indexOf('trigger_type') !== -1;
  var triggerQtyIdx = normalized.indexOf('trigger_qty');
  var orderStrategyIndices = [];

  for (var i = 0; i < normalized.length; i++) {
    if (normalized[i] === 'order_strategy') orderStrategyIndices.push(i);
  }

  // Legacy sheet layout:
  // item_name | trigger_type(inventory_only) | order_strategy(below) | ...
  // The second and third columns are really applies_to_mode + trigger_type.
  if (!hasAppliesToMode && hasTriggerType) {
    normalized[normalized.indexOf('trigger_type')] = 'applies_to_mode';
    hasAppliesToMode = true;
    hasTriggerType = normalized.indexOf('trigger_type') !== -1;
  }

  if (!hasTriggerType && orderStrategyIndices.length > 1) {
    var triggerTypeIdx = -1;
    for (var o = 0; o < orderStrategyIndices.length; o++) {
      if (triggerQtyIdx === -1 || orderStrategyIndices[o] < triggerQtyIdx) {
        triggerTypeIdx = orderStrategyIndices[o];
        break;
      }
    }
    if (triggerTypeIdx !== -1) normalized[triggerTypeIdx] = 'trigger_type';
  }

  return normalized;
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

function loadCleanItemReferenceData() {
  return {
    locations: supabaseSelectFields('locations', 'id,name,short_code,active', false)
      .filter(function(location) { return location.active !== false; }),
    suppliers: supabaseSelectFields('suppliers', 'id,name,supplier_key,supplier_type,active', false)
      .filter(function(supplier) { return supplier.active !== false; }),
  };
}

function resolveSupplierName(value, suppliers) {
  var raw = normalizeTextCell(value);
  if (isUuidText(raw)) {
    for (var i = 0; i < suppliers.length; i++) {
      if (String(suppliers[i].id).toLowerCase() === raw.toLowerCase()) return suppliers[i];
    }
  }
  var key = normalizeCatalogLookupText(raw);
  for (var n = 0; n < suppliers.length; n++) {
    if (normalizeCatalogLookupText(suppliers[n].name) === key) return suppliers[n];
    if (normalizeCatalogLookupText(suppliers[n].supplier_key) === key) return suppliers[n];
    if (normalizeCatalogLookupText(suppliers[n].supplier_type) === key) return suppliers[n];
  }
  return null;
}

function removeNullValues(row) {
  var result = {};
  for (var key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    if (row[key] !== undefined) result[key] = row[key];
  }
  return result;
}

function writeGeneratedIds(sheet, idColIdx, newRowIndices, newRowUuids) {
  if (newRowIndices.length === 0 || idColIdx === -1 || !sheet.getRange) return;
  for (var k = 0; k < newRowIndices.length; k++) {
    var sheetRow = newRowIndices[k] + 1;
    sheet.getRange(sheetRow, idColIdx + 1).setValue(newRowUuids[k]);
  }
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

function resolveOptionalLocationName(locationName, locations) {
  var raw = normalizeTextCell(locationName);
  if (!raw) return { ok: true, location: null };
  var key = normalizeEmployeeAliasKey(raw);
  if (
    key === 'all locations' ||
    key === 'all location' ||
    key === 'all' ||
    key === 'global' ||
    key === 'both'
  ) {
    return { ok: true, location: null };
  }
  var location = resolveEmployeeAliasLocation(raw, locations);
  return location
    ? { ok: true, location: location }
    : { ok: false, location: null };
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

  var looseNormalized = normalizeCatalogLooseLookupText(raw);
  var looseMatch = null;
  for (var l = 0; l < refs.inventoryItems.length; l++) {
    if (normalizeCatalogLooseLookupText(refs.inventoryItems[l].name) !== looseNormalized) continue;
    if (looseMatch) return null;
    looseMatch = refs.inventoryItems[l];
  }
  if (looseMatch) return looseMatch;

  for (var a = 0; a < refs.inventoryItems.length; a++) {
    var aliases = Array.isArray(refs.inventoryItems[a].aliases) ? refs.inventoryItems[a].aliases : [];
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
      if (normalizeCatalogLookupText(aliases[aliasIndex]) === normalized) return refs.inventoryItems[a];
      if (normalizeCatalogLooseLookupText(aliases[aliasIndex]) === looseNormalized) return refs.inventoryItems[a];
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

  var headers = normalizeInventoryReorderRuleHeaders(data[0].map(function(h) { return String(h).trim(); }));
  var statusColumns = ensureSyncStatusColumns(sheet, headers);
  var requiredHeaders = ['item_name', 'applies_to_mode', 'trigger_type', 'order_strategy'];
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
    var active = activeResult.value === null ? true : activeResult.value;
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

    if (activeResult.invalid) rowError = 'active must be TRUE or FALSE';
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

function markDuplicateRows(rows, messagePrefix) {
  var duplicateBuckets = {};
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].duplicateKey) continue;
    if (!duplicateBuckets[rows[i].duplicateKey]) duplicateBuckets[rows[i].duplicateKey] = [];
    duplicateBuckets[rows[i].duplicateKey].push(rows[i].rowNumber);
  }
  for (var j = 0; j < rows.length; j++) {
    var bucket = duplicateBuckets[rows[j].duplicateKey] || [];
    if (!rows[j].error && bucket.length > 1) {
      rows[j].error = messagePrefix + ' in rows ' + bucket.join(', ');
      rows[j].payload = null;
    }
  }
  return rows;
}

function defaultSyncErrorMessage(response) {
  var body = response.getContentText ? response.getContentText() : '';
  if (/duplicate key|23505/i.test(body)) return 'Duplicate row key';
  return 'HTTP ' + response.getResponseCode() + ': ' + body;
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
    syncParserSettings: syncParserSettings,
    syncCleanItems: syncCleanItems,
    syncQuickOrderAliasRules: syncQuickOrderAliasRules,
    syncQuickOrderUnitRules: syncQuickOrderUnitRules,
    syncQuickOrderReorderRules: syncQuickOrderReorderRules,
    syncQuickOrderStatusTerms: syncQuickOrderStatusTerms,
    syncQoItems: syncQoItems,
    syncQoReorderRules: syncQoReorderRules,
    syncQoPersonalization: syncQoPersonalization,
    syncQoKeywords: syncQoKeywords,
    syncQoHolidayOverrides: syncQoHolidayOverrides,
    syncInventoryReorderRules: syncInventoryReorderRules,
    syncInventoryStatusTerms: syncInventoryStatusTerms,
    normalizeEmployeeAliasKey: normalizeEmployeeAliasKey,
    normalizeInventoryStatusPhraseKey: normalizeInventoryStatusPhraseKey,
    normalizeCatalogLookupText: normalizeCatalogLookupText,
    resolveEmployeeAliasItem: resolveEmployeeAliasItem,
    resolveEmployeeAliasLocation: resolveEmployeeAliasLocation,
    resolveSupplierName: resolveSupplierName,
    resolveQoItem: resolveQoItem,
    resolveQoInventoryItem: resolveQoInventoryItem,
    formatQoCatalogResolutionError: formatQoCatalogResolutionError,
  };
}
