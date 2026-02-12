import { supabase } from '@/lib/supabase';

export interface SupplierLookupRow {
  id: string;
  name: string;
  supplierType: string | null;
  isDefault: boolean;
  active: boolean;
}

export interface SupplierLookupMaps {
  suppliers: SupplierLookupRow[];
  supplierById: Map<string, SupplierLookupRow>;
  supplierByNameNormalized: Map<string, SupplierLookupRow>;
}

export type SupplierIssueSource =
  | 'inventory_primary'
  | 'inventory_secondary'
  | 'order_override';

export interface SupplierResolutionIssue {
  source: SupplierIssueSource;
  value: string;
  inventoryItemId?: string | null;
  inventoryItemName?: string | null;
  orderItemId?: string | null;
}

export interface ResolvedOrderItemSupplier {
  primarySupplierId: string | null;
  primarySupplierName: string | null;
  secondarySupplierId: string | null;
  secondarySupplierName: string | null;
  effectiveSupplierId: string;
  effectiveSupplierName: string;
  isOverridden: boolean;
  unresolvedPrimaryName: string | null;
  unresolvedSecondaryName: string | null;
  unresolvedOverrideId: string | null;
}

export interface UnresolvedSupplierReport {
  primaryNames: string[];
  secondaryNames: string[];
  overrideIds: string[];
}

function toSupplierId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSupplierName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toNonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function findSupplierByIdOrName(
  lookup: SupplierLookupMaps,
  value: unknown
): SupplierLookupRow | null {
  const idCandidate = toSupplierId(value);
  if (!idCandidate) return null;

  const byId = lookup.supplierById.get(idCandidate);
  if (byId) return byId;

  return lookup.supplierByNameNormalized.get(normalizeSupplierName(idCandidate)) ?? null;
}

function findSupplierByText(
  lookup: SupplierLookupMaps,
  value: unknown
): SupplierLookupRow | null {
  const normalized = normalizeSupplierName(value);
  if (!normalized) return null;
  return lookup.supplierByNameNormalized.get(normalized) ?? null;
}

function buildUnresolvedSupplierId(rawName: string | null, inventoryItemId: string | null): string {
  const normalized = normalizeSupplierName(rawName || inventoryItemId || 'missing');
  return `unresolved:${normalized || 'missing'}`;
}

function issueValueOrNull(value: unknown): string | null {
  const parsed = toNonEmptyText(value);
  return parsed ? parsed : null;
}

function issueIdentity(orderItem?: Record<string, unknown> | null, inventoryItem?: Record<string, unknown> | null) {
  return {
    orderItemId: issueValueOrNull(orderItem?.id),
    inventoryItemId: issueValueOrNull(inventoryItem?.id),
    inventoryItemName: issueValueOrNull(inventoryItem?.name),
  };
}

function pushIssue(
  issues: SupplierResolutionIssue[] | undefined,
  source: SupplierIssueSource,
  value: string | null,
  orderItem?: Record<string, unknown> | null,
  inventoryItem?: Record<string, unknown> | null
) {
  if (!issues || !value) return;
  const identity = issueIdentity(orderItem, inventoryItem);
  issues.push({
    source,
    value,
    ...identity,
  });
}

export function summarizeSupplierIssues(issues: SupplierResolutionIssue[]): UnresolvedSupplierReport {
  const primaryNames = new Set<string>();
  const secondaryNames = new Set<string>();
  const overrideIds = new Set<string>();

  issues.forEach((issue) => {
    if (!issue.value) return;
    if (issue.source === 'inventory_primary') primaryNames.add(issue.value);
    if (issue.source === 'inventory_secondary') secondaryNames.add(issue.value);
    if (issue.source === 'order_override') overrideIds.add(issue.value);
  });

  return {
    primaryNames: Array.from(primaryNames.values()).sort((a, b) => a.localeCompare(b)),
    secondaryNames: Array.from(secondaryNames.values()).sort((a, b) => a.localeCompare(b)),
    overrideIds: Array.from(overrideIds.values()).sort((a, b) => a.localeCompare(b)),
  };
}

function normalizeSupplierRow(row: Record<string, unknown>): SupplierLookupRow | null {
  const id = toSupplierId(row.id);
  const name = toNonEmptyText(row.name);
  if (!id || !name) return null;

  const rawSupplierType =
    row.supplier_type ?? row.supplier_category ?? row.category ?? row.type;

  return {
    id,
    name,
    supplierType: typeof rawSupplierType === 'string' ? rawSupplierType : null,
    isDefault: row.is_default === true,
    active: row.active !== false,
  };
}

export async function loadSupplierLookup(): Promise<SupplierLookupMaps> {
  const loadSuppliers = async (columns: string) =>
    (supabase as any)
      .from('suppliers')
      .select(columns)
      .order('name', { ascending: true });

  let data: Record<string, unknown>[] | null = null;
  let error: any = null;

  ({ data, error } = await loadSuppliers('id,name,supplier_type,is_default,active'));

  if (error?.code === '42703') {
    ({ data, error } = await loadSuppliers('id,name,is_default,active'));
  }
  if (error?.code === '42703') {
    ({ data, error } = await loadSuppliers('id,name,active'));
  }
  if (error?.code === '42703') {
    ({ data, error } = await loadSuppliers('id,name'));
  }

  if (error) {
    throw error;
  }

  const suppliers = (Array.isArray(data) ? data : [])
    .map((row) => normalizeSupplierRow(row))
    .filter((row): row is SupplierLookupRow => Boolean(row));

  const supplierById = new Map<string, SupplierLookupRow>();
  const supplierByNameNormalized = new Map<string, SupplierLookupRow>();

  suppliers.forEach((supplier) => {
    supplierById.set(supplier.id, supplier);
    supplierById.set(supplier.id.toLowerCase(), supplier);

    const key = normalizeSupplierName(supplier.name);
    if (!key || supplierByNameNormalized.has(key)) return;
    supplierByNameNormalized.set(key, supplier);
  });

  return {
    suppliers,
    supplierById,
    supplierByNameNormalized,
  };
}

function resolvePrimarySupplier(
  inventoryItem: Record<string, unknown>,
  lookup: SupplierLookupMaps,
  issues?: SupplierResolutionIssue[]
): {
  supplierId: string | null;
  supplierName: string | null;
  unresolvedPrimaryName: string | null;
} {
  const idCandidates = [inventoryItem.supplier_id, inventoryItem.supplierId];
  for (const candidate of idCandidates) {
    const found = findSupplierByIdOrName(lookup, candidate);
    if (found) {
      return {
        supplierId: found.id,
        supplierName: found.name,
        unresolvedPrimaryName: null,
      };
    }
  }

  const textCandidates = [
    inventoryItem.default_supplier,
    inventoryItem.defaultSupplier,
    inventoryItem.supplier_name,
    inventoryItem.supplierName,
    inventoryItem.supplier,
    inventoryItem.vendor_name,
    inventoryItem.vendorName,
  ];

  for (const candidate of textCandidates) {
    const found = findSupplierByText(lookup, candidate);
    if (found) {
      return {
        supplierId: found.id,
        supplierName: found.name,
        unresolvedPrimaryName: null,
      };
    }

    const unresolvedName = toNonEmptyText(candidate);
    if (unresolvedName) {
      pushIssue(issues, 'inventory_primary', unresolvedName, null, inventoryItem);
      return {
        supplierId: null,
        supplierName: null,
        unresolvedPrimaryName: unresolvedName,
      };
    }
  }

  return {
    supplierId: null,
    supplierName: null,
    unresolvedPrimaryName: null,
  };
}

function resolveSecondarySupplier(
  inventoryItem: Record<string, unknown>,
  lookup: SupplierLookupMaps,
  issues?: SupplierResolutionIssue[]
): {
  supplierId: string | null;
  supplierName: string | null;
  unresolvedSecondaryName: string | null;
} {
  const idCandidates = [inventoryItem.secondary_supplier_id, inventoryItem.secondarySupplierId];
  for (const candidate of idCandidates) {
    const found = findSupplierByIdOrName(lookup, candidate);
    if (found) {
      return {
        supplierId: found.id,
        supplierName: found.name,
        unresolvedSecondaryName: null,
      };
    }
  }

  const textCandidates = [inventoryItem.secondary_supplier, inventoryItem.secondarySupplier];

  for (const candidate of textCandidates) {
    const found = findSupplierByText(lookup, candidate);
    if (found) {
      return {
        supplierId: found.id,
        supplierName: found.name,
        unresolvedSecondaryName: null,
      };
    }

    const unresolvedName = toNonEmptyText(candidate);
    if (unresolvedName) {
      pushIssue(issues, 'inventory_secondary', unresolvedName, null, inventoryItem);
      return {
        supplierId: null,
        supplierName: null,
        unresolvedSecondaryName: unresolvedName,
      };
    }
  }

  return {
    supplierId: null,
    supplierName: null,
    unresolvedSecondaryName: null,
  };
}

export function resolveOrderItemSupplier(params: {
  inventoryItem: Record<string, unknown>;
  orderItem?: Record<string, unknown> | null;
  lookup: SupplierLookupMaps;
  issues?: SupplierResolutionIssue[];
}): ResolvedOrderItemSupplier {
  const { inventoryItem, orderItem, lookup, issues } = params;

  const primary = resolvePrimarySupplier(inventoryItem, lookup, issues);
  const secondary = resolveSecondarySupplier(inventoryItem, lookup, issues);

  const overrideId = toSupplierId(orderItem?.supplier_override_id);
  const overrideSupplier = overrideId ? findSupplierByIdOrName(lookup, overrideId) : null;

  const unresolvedOverrideId = overrideId && !overrideSupplier ? overrideId : null;
  if (unresolvedOverrideId) {
    pushIssue(issues, 'order_override', unresolvedOverrideId, orderItem, inventoryItem);
  }

  const fallbackUnresolvedName =
    primary.unresolvedPrimaryName ||
    toNonEmptyText(inventoryItem.default_supplier) ||
    null;

  const unresolvedSupplierId = buildUnresolvedSupplierId(
    fallbackUnresolvedName,
    toNonEmptyText(inventoryItem.id)
  );

  const primarySupplierId = primary.supplierId;
  const primarySupplierName = primary.supplierName;

  const effectiveSupplierId = overrideSupplier?.id || primarySupplierId || unresolvedSupplierId;
  const effectiveSupplierName =
    overrideSupplier?.name ||
    primarySupplierName ||
    (fallbackUnresolvedName
      ? `UNRESOLVED SUPPLIER (${fallbackUnresolvedName})`
      : 'UNRESOLVED SUPPLIER');

  return {
    primarySupplierId,
    primarySupplierName,
    secondarySupplierId: secondary.supplierId,
    secondarySupplierName: secondary.supplierName,
    effectiveSupplierId,
    effectiveSupplierName,
    isOverridden: Boolean(overrideSupplier && primarySupplierId && overrideSupplier.id !== primarySupplierId),
    unresolvedPrimaryName: primary.unresolvedPrimaryName,
    unresolvedSecondaryName: secondary.unresolvedSecondaryName,
    unresolvedOverrideId,
  };
}

export async function collectInventorySupplierIssues(
  lookup: SupplierLookupMaps
): Promise<SupplierResolutionIssue[]> {
  const issues: SupplierResolutionIssue[] = [];

  const run = async (columns: string) =>
    (supabase as any)
      .from('inventory_items')
      .select(columns)
      .eq('active', true)
      .limit(5000);

  let data: Record<string, unknown>[] | null = null;
  let error: any = null;

  ({ data, error } = await run('id,name,supplier_id,default_supplier,secondary_supplier,secondary_supplier_id,active'));
  if (error?.code === '42703') {
    ({ data, error } = await run('id,name,supplier_id,default_supplier,secondary_supplier,active'));
  }
  if (error?.code === '42703') {
    ({ data, error } = await run('id,name,supplier_id,default_supplier,active'));
  }
  if (error) {
    return issues;
  }

  (Array.isArray(data) ? data : []).forEach((row) => {
    resolveOrderItemSupplier({
      inventoryItem: row,
      orderItem: null,
      lookup,
      issues,
    });
  });

  return issues;
}

export function logUnresolvedSupplierReport(
  report: UnresolvedSupplierReport,
  options?: { prefix?: string }
) {
  if (!__DEV__) return;
  const prefix = options?.prefix || '[Fulfillment]';

  const hasAny =
    report.primaryNames.length > 0 ||
    report.secondaryNames.length > 0 ||
    report.overrideIds.length > 0;

  if (!hasAny) {
    console.log(`${prefix} No unresolved supplier mappings detected.`);
    return;
  }

  console.warn(
    `${prefix} UNRESOLVED SUPPLIER mappings detected`,
    JSON.stringify(report, null, 2)
  );
}
