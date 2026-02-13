import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SUPPLIER_CATEGORY_LABELS, colors } from '@/constants';
import { useAuthStore, useOrderStore, useSettingsStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { FulfillmentConfirmItemRow, ItemActionSheet } from '@/components';
import { OrderLaterScheduleModal } from '@/components/OrderLaterScheduleModal';
import { QuantityExportSelector } from '@/components/QuantityExportSelector';
import type { ItemActionSheetSection } from '@/components';
import { buildSupplierConfirmationData } from '@/services/fulfillmentDataSource';
import { loadSupplierLookup } from '@/services/supplierResolver';
import {
  UnitConversionLookup,
  applyUnitConversion,
  loadUnitConversionLookup,
  resolveUnitConversionMultiplier,
} from '@/services/unitConversion';

interface ConfirmationDetail {
  locationId?: string;
  locationName: string;
  orderedBy: string;
  quantity: number;
  shortCode?: string;
}

interface ConfirmationContributor {
  userId: string | null;
  name: string;
  quantity: number;
}

interface ConfirmationNote {
  id: string;
  author: string;
  text: string;
  locationName: string;
  shortCode: string;
}

type LocationGroup = 'sushi' | 'poki';

const LOCATION_GROUP_LABELS: Record<LocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki',
};

interface ConfirmationItem {
  id: string;
  inventoryItemId: string;
  name: string;
  category: string;
  locationGroup: LocationGroup;
  quantity: number;
  unitType: 'base' | 'pack';
  unitLabel: string;
  sumOfContributorQuantities: number;
  sourceOrderItemIds: string[];
  sourceOrderIds: string[];
  sourceDraftItemIds: string[];
  contributors: ConfirmationContributor[];
  notes: ConfirmationNote[];
  details: ConfirmationDetail[];
  secondarySupplierName: string | null;
  secondarySupplierId: string | null;
}

interface RemainingConfirmationItem {
  orderItemId: string;
  orderId: string;
  inventoryItemId: string;
  name: string;
  category: string;
  locationGroup: LocationGroup;
  locationId: string;
  locationName: string;
  shortCode: string;
  unitType: 'base' | 'pack';
  unitLabel: string;
  reportedRemaining: number;
  decidedQuantity: number | null;
  note: string | null;
  orderedBy: string;
  secondarySupplierName: string | null;
  secondarySupplierId: string | null;
}

type RegularListEntry =
  | {
      key: string;
      type: 'group-header';
      group: LocationGroup;
    }
  | {
      key: string;
      type: 'regular-item';
      item: ConfirmationItem;
    };

function parseParamArray<T>(value: string | string[] | undefined): T[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
}

function normalizeLocationGroup(group: unknown): LocationGroup {
  return group === 'poki' ? 'poki' : 'sushi';
}

function toNumberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return null;
  return parsed;
}

function toNonNegativeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? `${value}` : `${value}`.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function encodeHistorySignaturePart(value: string | null | undefined): string {
  return encodeURIComponent(value ?? '');
}

function decodeHistorySignaturePart(value: string | undefined): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function assertNoReportedInExportText(message: string) {
  if (__DEV__ && /\breported\b/i.test(message)) {
    throw new Error('Exported fulfillment message cannot contain "reported".');
  }
}

interface InventoryUnitInfo {
  id: string;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
}

interface ItemExportSettings {
  exportUnitType: 'base' | 'pack';
}

interface UnitLabelAvailability {
  baseLabel: string | null;
  packLabel: string | null;
  hasBase: boolean;
  hasPack: boolean;
}

interface UnitSelectorProps {
  baseUnitLabel: string;
  packUnitLabel: string;
  canSwitchUnit: boolean;
}

function normalizeUnitLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unitLabelsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeUnitLabel(left)?.toLowerCase();
  const normalizedRight = normalizeUnitLabel(right)?.toLowerCase();
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

function resolveUnitSelectorProps({
  unitInfo,
  availability,
  currentUnitType,
  currentUnitLabel,
}: {
  unitInfo: InventoryUnitInfo | undefined;
  availability: UnitLabelAvailability | undefined;
  currentUnitType: 'base' | 'pack';
  currentUnitLabel: string;
}): UnitSelectorProps {
  const currentLabel = normalizeUnitLabel(currentUnitLabel) ?? (currentUnitType === 'pack' ? 'pack' : 'unit');
  const infoBaseLabel = normalizeUnitLabel(unitInfo?.base_unit);
  const infoPackLabel = normalizeUnitLabel(unitInfo?.pack_unit);

  let baseUnitLabel = infoBaseLabel ?? availability?.baseLabel ?? (currentUnitType === 'base' ? currentLabel : 'base');
  let packUnitLabel = infoPackLabel ?? availability?.packLabel ?? (currentUnitType === 'pack' ? currentLabel : 'pack');

  const hasAlternateUnitType = Boolean(availability?.hasBase && availability?.hasPack);
  const hasDistinctUnitLabelsFromInventory =
    Boolean(infoBaseLabel && infoPackLabel) && !unitLabelsMatch(infoBaseLabel, infoPackLabel);
  const knownOppositeLabel =
    currentUnitType === 'base'
      ? infoPackLabel ?? availability?.packLabel ?? null
      : infoBaseLabel ?? availability?.baseLabel ?? null;
  const hasDistinctKnownOppositeLabel =
    Boolean(knownOppositeLabel) && !unitLabelsMatch(knownOppositeLabel, currentLabel);

  // If both unit types are known but labels collapsed to one value, keep toggle enabled with a safe generic fallback.
  if (hasAlternateUnitType && unitLabelsMatch(baseUnitLabel, packUnitLabel)) {
    if (currentUnitType === 'base') {
      packUnitLabel = availability?.packLabel ?? infoPackLabel ?? 'pack';
    } else {
      baseUnitLabel = availability?.baseLabel ?? infoBaseLabel ?? 'base';
    }
  }

  const canSwitchUnit =
    hasAlternateUnitType || hasDistinctUnitLabelsFromInventory || hasDistinctKnownOppositeLabel;

  return { baseUnitLabel, packUnitLabel, canSwitchUnit };
}

interface RemainingContributorSummary {
  name: string;
  reportedTotal: number;
  rowCount: number;
}

interface RemainingItemRowProps {
  item: RemainingConfirmationItem;
  suggested: number | null;
  isSaving: boolean;
  unitSelectorProps: UnitSelectorProps;
  exportUnitType: 'base' | 'pack';
  contributorBreakdown: RemainingContributorSummary[];
  onUnitChange: (unit: 'base' | 'pack') => void;
  onQuantityChange: (item: RemainingConfirmationItem, value: number | null) => void;
  onOverflowPress: (item: RemainingConfirmationItem) => void;
}

const RemainingItemRow = React.memo(function RemainingItemRow({
  item,
  suggested,
  isSaving,
  unitSelectorProps,
  exportUnitType,
  contributorBreakdown,
  onUnitChange,
  onQuantityChange,
  onOverflowPress,
}: RemainingItemRowProps) {
  const [showDetails, setShowDetails] = useState(false);
  const hasContributorBreakdown = contributorBreakdown.length > 1;

  return (
    <FulfillmentConfirmItemRow
      title={item.name}
      headerActions={(
        <>
          <TouchableOpacity
            onPress={() => onOverflowPress(item)}
            className="p-1.5 mr-1"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={colors.gray[500]} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowDetails((prev) => !prev)}
            className="p-1.5"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={showDetails ? 'information-circle' : 'information-circle-outline'}
              size={18}
              color={showDetails ? colors.primary[500] : colors.gray[500]}
            />
          </TouchableOpacity>
        </>
      )}
      chips={[
        {
          id: `${item.orderItemId}-reported`,
          label: `Reported: ${formatQuantity(item.reportedRemaining)} ${item.unitLabel}`,
          tone: 'gray',
        },
      ]}
      trailingChip={
        suggested != null ? (
          <TouchableOpacity
            onPress={() => onQuantityChange(item, suggested)}
            className="px-2.5 py-1.5 rounded-full bg-amber-100 border border-amber-200"
          >
            <Text className="text-[11px] font-semibold text-amber-800">
              Suggested: {formatQuantity(suggested)}
            </Text>
          </TouchableOpacity>
        ) : undefined
      }
      quantityValue={item.decidedQuantity == null ? '' : `${item.decidedQuantity}`}
      onQuantityChangeText={(text) => {
        const sanitized = text.replace(/[^0-9.]/g, '');
        if (sanitized.length === 0) {
          onQuantityChange(item, null);
          return;
        }
        const parsed = Number(sanitized);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        onQuantityChange(item, parsed);
      }}
      onDecrement={() => {
        const current = item.decidedQuantity ?? 0;
        onQuantityChange(item, Math.max(0, current - 1));
      }}
      onIncrement={() => {
        const current = item.decidedQuantity ?? 0;
        onQuantityChange(item, current + 1);
      }}
      quantityPlaceholder="Set qty"
      unitSelector={(
        <QuantityExportSelector
          exportUnitType={exportUnitType}
          baseUnitLabel={unitSelectorProps.baseUnitLabel}
          packUnitLabel={unitSelectorProps.packUnitLabel}
          canSwitchUnit={unitSelectorProps.canSwitchUnit}
          onUnitChange={onUnitChange}
        />
      )}
      detailsVisible={showDetails}
      details={(
        <View className="rounded-xl border border-gray-200 bg-white px-3 py-3">
          <View className={hasContributorBreakdown || item.note ? 'mb-3' : 'mb-0'}>
            <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Ordered By</Text>
            <Text className="text-sm text-gray-800 mt-1">
              {hasContributorBreakdown ? `${contributorBreakdown.length} people` : item.orderedBy}
            </Text>
          </View>

          {hasContributorBreakdown && (
            <View className={item.note ? 'mb-3' : 'mb-0'}>
              {contributorBreakdown.map((entry, index) => (
                <View
                  key={`${item.orderItemId}-contributor-${entry.name}`}
                  className={`flex-row items-center justify-between py-1.5 ${
                    index < contributorBreakdown.length - 1 ? 'border-b border-gray-100' : ''
                  }`}
                >
                  <Text className="text-sm text-gray-700">{entry.name}</Text>
                  <Text className="text-xs font-medium text-gray-600">
                    {formatQuantity(entry.reportedTotal)} {item.unitLabel}
                    {entry.rowCount > 1 ? ` • ${entry.rowCount} entries` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View className={item.note ? 'mb-3' : 'mb-0'}>
            <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Location</Text>
            <Text className="text-sm text-gray-800 mt-1">
              {item.locationName} ({item.shortCode})
            </Text>
            <Text className="text-xs text-gray-500 mt-1">
              Reported amount: {formatQuantity(item.reportedRemaining)} {item.unitLabel}
            </Text>
          </View>

          {item.note ? (
            <View>
              <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Notes</Text>
              <Text className="text-sm text-blue-800 mt-1">{item.note}</Text>
            </View>
          ) : null}
        </View>
      )}
      footer={isSaving ? <Text className="text-[11px] text-gray-500">Saving...</Text> : undefined}
      disableControls={isSaving}
    />
  );
});

export default function FulfillmentConfirmationScreen() {
  const params = useLocalSearchParams<{
    items?: string;
    supplier?: string;
    supplierLabel?: string;
    from?: string;
    remaining?: string;
  }>();
  const { user, locations } = useAuthStore();
  const { exportFormat } = useSettingsStore();
  const {
    createOrderLaterItem,
    fetchPendingFulfillmentOrders,
    finalizeSupplierOrder,
    getSupplierDraftItems,
    getLastOrderedQuantities,
    markOrderItemsStatus,
    removeSupplierDraftItems,
    setSupplierOverride,
    updateSupplierDraftItemQuantity,
  } = useOrderStore();

  const initialItems = useMemo(() => {
    return parseParamArray<ConfirmationItem>(params.items)
      .map((item, index) => {
        const normalizedContributors = Array.isArray(item.contributors)
          ? item.contributors
              .map((contributor) => ({
                userId: typeof contributor.userId === 'string' ? contributor.userId : null,
                name:
                  typeof contributor.name === 'string' && contributor.name.trim().length > 0
                    ? contributor.name.trim()
                    : 'Unknown',
                quantity: toNonNegativeNumber(contributor.quantity, 0),
              }))
              .filter((contributor) => contributor.quantity > 0)
          : [];
        const contributorTotal = normalizedContributors.reduce((sum, contributor) => sum + contributor.quantity, 0);

        const normalizedDetails = Array.isArray(item.details)
          ? item.details
              .map((detail) => ({
                locationId: typeof detail.locationId === 'string' ? detail.locationId : undefined,
                locationName:
                  typeof detail.locationName === 'string' && detail.locationName.trim().length > 0
                    ? detail.locationName.trim()
                    : 'Unknown',
                orderedBy:
                  typeof detail.orderedBy === 'string' && detail.orderedBy.trim().length > 0
                    ? detail.orderedBy.trim()
                    : 'Unknown',
                quantity: toNonNegativeNumber(detail.quantity, 0),
                shortCode:
                  typeof detail.shortCode === 'string' && detail.shortCode.trim().length > 0
                    ? detail.shortCode.trim()
                    : undefined,
              }))
              .filter((detail) => detail.quantity > 0)
          : [];

        const normalizedNotes = Array.isArray(item.notes)
          ? item.notes
              .map((note, noteIndex) => {
                const text = typeof note.text === 'string' ? note.text.trim() : '';
                if (text.length === 0) return null;
                return {
                  id:
                    typeof note.id === 'string' && note.id.trim().length > 0
                      ? note.id
                      : `${item.id || item.inventoryItemId || index}-note-${noteIndex}`,
                  author:
                    typeof note.author === 'string' && note.author.trim().length > 0
                      ? note.author.trim()
                      : 'Unknown',
                  text,
                  locationName:
                    typeof note.locationName === 'string' && note.locationName.trim().length > 0
                      ? note.locationName.trim()
                      : 'Unknown',
                  shortCode:
                    typeof note.shortCode === 'string' && note.shortCode.trim().length > 0
                      ? note.shortCode.trim()
                      : '??',
                } satisfies ConfirmationNote;
              })
              .filter((note): note is ConfirmationNote => Boolean(note))
          : [];

        const safeUnitType: 'base' | 'pack' = item.unitType === 'base' ? 'base' : 'pack';
        const safeId =
          typeof item.id === 'string' && item.id.length > 0
            ? item.id
            : `${normalizeLocationGroup(item.locationGroup)}-${item.inventoryItemId || item.name || index}`;

        return {
          ...item,
          id: safeId,
          inventoryItemId:
            typeof item.inventoryItemId === 'string' && item.inventoryItemId.length > 0
              ? item.inventoryItemId
              : safeId,
          locationGroup: normalizeLocationGroup(item.locationGroup),
          quantity: toNonNegativeNumber(item.quantity, 0),
          unitType: safeUnitType,
          unitLabel:
            typeof item.unitLabel === 'string' && item.unitLabel.trim().length > 0
              ? item.unitLabel.trim()
              : safeUnitType === 'pack'
                ? 'pack'
                : 'unit',
          sumOfContributorQuantities:
            toNonNegativeNumber(item.sumOfContributorQuantities, contributorTotal) || contributorTotal,
          sourceOrderItemIds: Array.isArray(item.sourceOrderItemIds)
            ? item.sourceOrderItemIds.filter(
                (id): id is string => typeof id === 'string' && id.trim().length > 0
              )
            : [],
          sourceOrderIds: Array.isArray(item.sourceOrderIds)
            ? item.sourceOrderIds.filter(
                (id): id is string => typeof id === 'string' && id.trim().length > 0
              )
            : [],
          sourceDraftItemIds: Array.isArray(item.sourceDraftItemIds)
            ? item.sourceDraftItemIds.filter(
                (id): id is string => typeof id === 'string' && id.trim().length > 0
              )
            : [],
          contributors: normalizedContributors,
          notes: normalizedNotes,
          details: normalizedDetails,
        } satisfies ConfirmationItem;
      })
      .sort((a, b) => {
        if (a.locationGroup !== b.locationGroup) return a.locationGroup.localeCompare(b.locationGroup);
        return a.name.localeCompare(b.name);
      });
  }, [params.items]);

  const initialRemainingItems = useMemo(() => {
    return parseParamArray<RemainingConfirmationItem>(params.remaining).map((item) => ({
      ...item,
      locationGroup: normalizeLocationGroup(item.locationGroup),
      reportedRemaining: Math.max(0, Number(item.reportedRemaining || 0)),
      decidedQuantity: toNumberOrNull(item.decidedQuantity),
      note: typeof item.note === 'string' && item.note.trim().length > 0 ? item.note.trim() : null,
    }));
  }, [params.remaining]);

  const [items, setItems] = useState<ConfirmationItem[]>(initialItems);
  const [remainingItems, setRemainingItems] = useState<RemainingConfirmationItem[]>(initialRemainingItems);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [savingRemainingIds, setSavingRemainingIds] = useState<Set<string>>(new Set());
  const [lastOrderedByRemainingId, setLastOrderedByRemainingId] = useState<
    Record<string, { quantity: number; orderedAt: string }>
  >({});
  const [loadingLastOrdered, setLoadingLastOrdered] = useState(false);
  const [historyUnavailableOffline, setHistoryUnavailableOffline] = useState(false);
  const [showRetryActions, setShowRetryActions] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [orderLaterTarget, setOrderLaterTarget] = useState<
    | { kind: 'regular'; id: string }
    | { kind: 'remaining'; id: string }
    | null
  >(null);
  const [overflowTarget, setOverflowTarget] = useState<
    | { kind: 'regular'; id: string }
    | { kind: 'remaining'; id: string }
    | null
  >(null);
  const [noteEditorTarget, setNoteEditorTarget] = useState<
    | { kind: 'regular'; id: string }
    | { kind: 'remaining'; id: string }
    | null
  >(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [unitInfoMap, setUnitInfoMap] = useState<Record<string, InventoryUnitInfo>>({});
  const [unitConversionLookup, setUnitConversionLookup] = useState<UnitConversionLookup>({});
  const [exportSettings, setExportSettings] = useState<Record<string, ItemExportSettings>>({});

  const getExportSettings = useCallback(
    (itemId: string, defaultUnitType: 'base' | 'pack'): ItemExportSettings =>
      exportSettings[itemId] ?? { exportUnitType: defaultUnitType },
    [exportSettings]
  );

  const updateExportSettings = useCallback(
    (itemId: string, patch: Partial<ItemExportSettings>) => {
      setExportSettings((prev) => ({
        ...prev,
        [itemId]: {
          ...(prev[itemId] ?? { exportUnitType: 'base' }),
          ...patch,
        },
      }));
    },
    []
  );

  const supplierParam = Array.isArray(params.supplier) ? params.supplier[0] : params.supplier;
  const supplierLabelParam = Array.isArray(params.supplierLabel)
    ? params.supplierLabel[0]
    : params.supplierLabel;
  const supplierId = useMemo(() => {
    if (typeof supplierParam !== 'string') return null;
    const trimmed = supplierParam.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [supplierParam]);
  const supplierLabel = useMemo(() => {
    if (typeof supplierLabelParam === 'string' && supplierLabelParam.trim().length > 0) {
      return supplierLabelParam.trim();
    }
    if (!supplierId) return 'Supplier';
    return SUPPLIER_CATEGORY_LABELS[supplierId as keyof typeof SUPPLIER_CATEGORY_LABELS] || supplierId;
  }, [supplierId, supplierLabelParam]);
  const managerLocationIds = useMemo(
    () =>
      locations
        .map((location) => (typeof location.id === 'string' ? location.id.trim() : ''))
        .filter((id) => id.length > 0),
    [locations]
  );

  // Reset local state when the supplier param changes (prevents stale flash from previous supplier)
  useEffect(() => {
    setItems(initialItems);
    setRemainingItems(initialRemainingItems);
    setExpandedItems(new Set());
    setSavingRemainingIds(new Set());
    setShowRetryActions(false);
    setIsFinalizing(false);
    setOrderLaterTarget(null);
    setOverflowTarget(null);
    setNoteEditorTarget(null);
    setNoteDraft('');
    setExportSettings({});
  }, [supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Batch-load inventory item unit info for unit switching
  useEffect(() => {
    const ids = [
      ...new Set([
        ...items.map((i) => i.inventoryItemId),
        ...remainingItems.map((i) => i.inventoryItemId),
      ]),
    ].filter((id) => id && id.length > 0);
    if (ids.length === 0) return;

    let active = true;
    (supabase as any)
      .from('inventory_items')
      .select('id, base_unit, pack_unit, pack_size')
      .in('id', ids)
      .then(({ data }: { data: InventoryUnitInfo[] | null }) => {
        if (!active || !data) return;
        const map: Record<string, InventoryUnitInfo> = {};
        data.forEach((row) => {
          map[row.id] = row;
        });
        setUnitInfoMap(map);
      });

    return () => {
      active = false;
    };
  }, [items, remainingItems]);

  useEffect(() => {
    const ids = [
      ...new Set([
        ...items.map((item) => item.inventoryItemId),
        ...remainingItems.map((item) => item.inventoryItemId),
      ]),
    ].filter((id) => typeof id === 'string' && id.trim().length > 0);

    if (ids.length === 0) {
      setUnitConversionLookup({});
      return;
    }

    let active = true;
    (async () => {
      try {
        const lookup = await loadUnitConversionLookup(ids);
        if (!active) return;
        setUnitConversionLookup(lookup);
      } catch (error) {
        if (__DEV__) {
          console.warn('[Fulfillment:Confirm] Unable to load unit conversions.', error);
        }
        if (active) {
          setUnitConversionLookup({});
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [items, remainingItems]);

  const refreshFromSupplierSource = useCallback(async () => {
    if (!supplierId) return;

    try {
      await fetchPendingFulfillmentOrders(managerLocationIds);
      const supplierLookup = await loadSupplierLookup();
      const stateOrders = (useOrderStore.getState().orders || []) as any;
      const supplierDraftItems = getSupplierDraftItems(supplierId) as any;
      const rebuilt = buildSupplierConfirmationData({
        supplierId,
        orders: stateOrders,
        supplierLookup,
        supplierDraftItems,
      });

      setItems(rebuilt.regularItems as any);
      setRemainingItems(rebuilt.remainingItems as any);
    } catch (error) {
      if (__DEV__) {
        console.warn('[Fulfillment:Confirm] Unable to refresh supplier payload from source.', error);
      }
    }
  }, [fetchPendingFulfillmentOrders, getSupplierDraftItems, managerLocationIds, supplierId]);

  useFocusEffect(
    useCallback(() => {
      void refreshFromSupplierSource();
    }, [refreshFromSupplierSource])
  );

  const handleBackPress = useCallback(() => {
    router.replace('/(manager)/fulfillment');
  }, []);

  const syncOrderStoreDecision = useCallback(
    (orderItemId: string, decidedQuantity: number, decidedBy: string, decidedAt: string) => {
      useOrderStore.setState((state: any) => {
        const patchOrder = (orderLike: any) => {
          if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;

          let changed = false;
          const nextItems = orderLike.order_items.map((orderItem: any) => {
            if (orderItem?.id !== orderItemId) return orderItem;
            changed = true;
            return {
              ...orderItem,
              quantity: decidedQuantity,
              decided_quantity: decidedQuantity,
              decided_by: decidedBy,
              decided_at: decidedAt,
            };
          });

          return changed ? { ...orderLike, order_items: nextItems } : orderLike;
        };

        return {
          orders: Array.isArray(state.orders) ? state.orders.map((order: any) => patchOrder(order)) : state.orders,
          currentOrder: patchOrder(state.currentOrder),
        };
      });
    },
    []
  );

  const persistRemainingDecision = useCallback(
    async (orderItemId: string, quantity: number, options?: { silent?: boolean }) => {
      if (!user?.id) {
        if (!options?.silent) {
          Alert.alert('Sign In Required', 'Please sign in again to save remaining item decisions.');
        }
        return false;
      }

      const decidedAt = new Date().toISOString();
      setSavingRemainingIds((prev) => {
        const next = new Set(prev);
        next.add(orderItemId);
        return next;
      });

      try {
        const { error } = await (supabase as any)
          .from('order_items')
          .update({
            quantity,
            decided_quantity: quantity,
            decided_by: user.id,
            decided_at: decidedAt,
          })
          .eq('id', orderItemId);

        if (error) throw error;

        syncOrderStoreDecision(orderItemId, quantity, user.id, decidedAt);
        return true;
      } catch (error: any) {
        if (!options?.silent) {
          Alert.alert('Unable to Save Decision', error?.message || 'Please try again.');
        }
        return false;
      } finally {
        setSavingRemainingIds((prev) => {
          const next = new Set(prev);
          next.delete(orderItemId);
          return next;
        });
      }
    },
    [syncOrderStoreDecision, user?.id]
  );

  const remainingHistorySignature = useMemo(() => {
    return remainingItems
      .map((item) =>
        [
          encodeHistorySignaturePart(item.orderItemId),
          encodeHistorySignaturePart(item.inventoryItemId),
          encodeHistorySignaturePart(item.unitLabel.toLowerCase()),
          encodeHistorySignaturePart(item.locationId),
          encodeHistorySignaturePart(item.locationGroup),
        ].join('|')
      )
      .sort()
      .join('||');
  }, [remainingItems]);

  const remainingHistoryLookupItems = useMemo(
    () =>
      remainingHistorySignature
        .split('||')
        .map((entry) => {
          if (!entry) return null;
          const [rawKey, rawItemId, rawUnit, rawLocationId, rawLocationGroup] = entry.split('|');
          const key = decodeHistorySignaturePart(rawKey);
          const itemId = decodeHistorySignaturePart(rawItemId);
          const unit = decodeHistorySignaturePart(rawUnit);
          const locationId = decodeHistorySignaturePart(rawLocationId);
          const locationGroup = decodeHistorySignaturePart(rawLocationGroup);
          if (!key || !itemId || !unit) return null;
          return {
            key,
            itemId,
            unit,
            locationId: locationId || null,
            locationGroup:
              locationGroup === 'sushi' || locationGroup === 'poki' ? locationGroup : null,
          };
        })
        .filter(
          (
            item
          ): item is {
            key: string;
            itemId: string;
            unit: string;
            locationId: string | null;
            locationGroup: 'sushi' | 'poki' | null;
          } => Boolean(item)
        ),
    [remainingHistorySignature]
  );

  useEffect(() => {
    let isActive = true;

    const loadLastOrdered = async () => {
      if (!supplierId || remainingHistoryLookupItems.length === 0) {
        if (isActive) {
          setLastOrderedByRemainingId({});
          setHistoryUnavailableOffline(false);
          setLoadingLastOrdered(false);
        }
        return;
      }

      setLoadingLastOrdered(true);
      try {
        const result = await getLastOrderedQuantities({
          supplierId,
          managerId: user?.id ?? null,
          items: remainingHistoryLookupItems,
        });

        if (isActive) {
          const nextValues: Record<string, { quantity: number; orderedAt: string }> = {};
          Object.entries(result.values).forEach(([key, value]) => {
            nextValues[key] = {
              quantity: value.quantity,
              orderedAt: value.orderedAt,
            };
          });
          setLastOrderedByRemainingId(nextValues);
          setHistoryUnavailableOffline(result.historyUnavailableOffline);
          setLoadingLastOrdered(false);
        }
      } catch {
        if (isActive) {
          setLastOrderedByRemainingId({});
          setHistoryUnavailableOffline(true);
          setLoadingLastOrdered(false);
        }
      }
    };

    void loadLastOrdered();

    return () => {
      isActive = false;
    };
  }, [
    getLastOrderedQuantities,
    remainingHistoryLookupItems,
    remainingHistorySignature,
    supplierId,
    user?.id,
  ]);

  const getSuggestion = useCallback(
    (item: RemainingConfirmationItem) => {
      const lastOrdered = lastOrderedByRemainingId[item.orderItemId];
      if (!lastOrdered || !Number.isFinite(lastOrdered.quantity) || lastOrdered.quantity <= 0) return null;
      return Math.max(0, lastOrdered.quantity);
    },
    [lastOrderedByRemainingId]
  );

  const suggestionCount = useMemo(() => {
    return remainingItems.filter((item) => getSuggestion(item) !== null).length;
  }, [getSuggestion, remainingItems]);

  const unresolvedRemainingItemIds = useMemo(() => {
    return remainingItems
      .filter(
        (item) =>
          item.decidedQuantity == null ||
          !Number.isFinite(item.decidedQuantity) ||
          item.decidedQuantity <= 0
      )
      .map((item) => item.orderItemId);
  }, [remainingItems]);

  const hasMissingRemaining = unresolvedRemainingItemIds.length > 0;
  const hasAnyItems = items.length > 0 || remainingItems.length > 0;
  const actionsDisabled =
    !hasAnyItems || hasMissingRemaining || savingRemainingIds.size > 0 || isFinalizing;

  const groupedItems = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        const group = normalizeLocationGroup(item.locationGroup);
        acc[group].push(item);
        return acc;
      },
      { sushi: [] as ConfirmationItem[], poki: [] as ConfirmationItem[] }
    );
  }, [items]);

  const groupedRegularItems = useMemo(() => {
    const groupOrder: LocationGroup[] = ['sushi', 'poki'];
    const output: Record<LocationGroup, ConfirmationItem[]> = {
      sushi: [...(groupedItems.sushi || [])],
      poki: [...(groupedItems.poki || [])],
    };

    groupOrder.forEach((group) => {
      output[group].sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        const byInventoryId = a.inventoryItemId.localeCompare(b.inventoryItemId);
        if (byInventoryId !== 0) return byInventoryId;
        if (a.unitType !== b.unitType) return a.unitType.localeCompare(b.unitType);
        return a.unitLabel.localeCompare(b.unitLabel);
      });
    });

    return output;
  }, [groupedItems]);

  const unitLabelAvailabilityByInventoryItemId = useMemo(() => {
    const output: Record<string, UnitLabelAvailability> = {};
    const register = (inventoryItemId: string, unitType: 'base' | 'pack', unitLabel: string) => {
      const id = typeof inventoryItemId === 'string' ? inventoryItemId.trim() : '';
      if (!id) return;

      if (!output[id]) {
        output[id] = {
          baseLabel: null,
          packLabel: null,
          hasBase: false,
          hasPack: false,
        };
      }

      const normalizedLabel = normalizeUnitLabel(unitLabel);
      if (unitType === 'base') {
        output[id].hasBase = true;
        if (normalizedLabel && !output[id].baseLabel) {
          output[id].baseLabel = normalizedLabel;
        }
        return;
      }

      output[id].hasPack = true;
      if (normalizedLabel && !output[id].packLabel) {
        output[id].packLabel = normalizedLabel;
      }
    };

    items.forEach((item) => register(item.inventoryItemId, item.unitType, item.unitLabel));
    remainingItems.forEach((item) => register(item.inventoryItemId, item.unitType, item.unitLabel));
    return output;
  }, [items, remainingItems]);

  const getUnitSelectorPropsByInventoryItemId = useCallback(
    (inventoryItemId: string, unitType: 'base' | 'pack', unitLabel: string): UnitSelectorProps =>
      resolveUnitSelectorProps({
        unitInfo: unitInfoMap[inventoryItemId],
        availability: unitLabelAvailabilityByInventoryItemId[inventoryItemId],
        currentUnitType: unitType,
        currentUnitLabel: unitLabel,
      }),
    [unitInfoMap, unitLabelAvailabilityByInventoryItemId]
  );

  const groupedRemainingItems = useMemo(() => {
    return remainingItems.reduce(
      (acc, item) => {
        const group = normalizeLocationGroup(item.locationGroup);
        acc[group].push(item);
        return acc;
      },
      { sushi: [] as RemainingConfirmationItem[], poki: [] as RemainingConfirmationItem[] }
    );
  }, [remainingItems]);

  const regularListEntries = useMemo<RegularListEntry[]>(() => {
    const entries: RegularListEntry[] = [];
    (['sushi', 'poki'] as LocationGroup[]).forEach((group) => {
      const rows = groupedRegularItems[group];
      if (!rows || rows.length === 0) return;
      entries.push({
        key: `group-header-${group}`,
        type: 'group-header',
        group,
      });
      rows.forEach((item) => {
        entries.push({
          key: `regular-${item.id}`,
          type: 'regular-item',
          item,
        });
      });
    });
    return entries;
  }, [groupedRegularItems]);

  const regularItemCount = groupedRegularItems.sushi.length + groupedRegularItems.poki.length;

  const remainingContributorBreakdownByOrderItemId = useMemo(() => {
    const groupedByItem = new Map<string, RemainingConfirmationItem[]>();
    remainingItems.forEach((item) => {
      const key = `${item.locationGroup}|${item.inventoryItemId}|${item.unitType}`;
      const rows = groupedByItem.get(key);
      if (rows) {
        rows.push(item);
      } else {
        groupedByItem.set(key, [item]);
      }
    });

    const next: Record<string, RemainingContributorSummary[]> = {};
    groupedByItem.forEach((rows) => {
      const summaryByName = new Map<string, RemainingContributorSummary>();
      rows.forEach((row) => {
        const rawName = typeof row.orderedBy === 'string' ? row.orderedBy : '';
        const name = rawName.trim().length > 0 ? rawName.trim() : 'Unknown';
        const existing = summaryByName.get(name);
        if (existing) {
          existing.reportedTotal += row.reportedRemaining;
          existing.rowCount += 1;
        } else {
          summaryByName.set(name, {
            name,
            reportedTotal: row.reportedRemaining,
            rowCount: 1,
          });
        }
      });

      const breakdown = Array.from(summaryByName.values()).sort((a, b) => {
        if (b.reportedTotal !== a.reportedTotal) return b.reportedTotal - a.reportedTotal;
        return a.name.localeCompare(b.name);
      });

      rows.forEach((row) => {
        next[row.orderItemId] = breakdown;
      });
    });

    return next;
  }, [remainingItems]);

  const formattedItems = useMemo(() => {
    const groupOrder: LocationGroup[] = ['sushi', 'poki'];
    const output = groupOrder
      .map((group) => {
        const lines: string[] = [];
        const regularItems = groupedItems[group] || [];
        const remainingRows = groupedRemainingItems[group] || [];

        regularItems.forEach((item) => {
          const settings = getExportSettings(item.id, item.unitType);
          const targetUnit = settings.exportUnitType;
          const unitSelectorProps = getUnitSelectorPropsByInventoryItemId(
            item.inventoryItemId,
            item.unitType,
            item.unitLabel
          );
          const displayQty = item.quantity;
          const displayLabel =
            targetUnit === 'pack'
              ? unitSelectorProps.packUnitLabel
              : unitSelectorProps.baseUnitLabel;
          lines.push(`- ${item.name}: ${formatQuantity(displayQty)} ${displayLabel}`);
        });

        remainingRows.forEach((item) => {
          const settings = getExportSettings(item.orderItemId, item.unitType);
          const targetUnit = settings.exportUnitType;
          const unitSelectorProps = getUnitSelectorPropsByInventoryItemId(
            item.inventoryItemId,
            item.unitType,
            item.unitLabel
          );
          const sourceQty = item.decidedQuantity;
          const isValid =
            sourceQty != null && Number.isFinite(sourceQty) && sourceQty > 0;
          const displayQty = isValid
            ? formatQuantity(sourceQty!)
            : '[set qty]';
          const displayLabel =
            targetUnit === 'pack'
              ? unitSelectorProps.packUnitLabel
              : unitSelectorProps.baseUnitLabel;
          lines.push(`- ${item.name}: ${displayQty} ${displayLabel}`);
        });

        if (lines.length === 0) return null;
        return `--- ${LOCATION_GROUP_LABELS[group].toUpperCase()} ---\n${lines.join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');

    return output.length > 0 ? output : 'No items to order.';
  }, [groupedItems, groupedRemainingItems, getExportSettings, getUnitSelectorPropsByInventoryItemId]);

  const messageText = useMemo(() => {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const variables: Record<string, string> = {
      supplier: supplierLabel,
      date: today,
      items: formattedItems,
    };

    const filled = Object.entries(variables).reduce((text, [key, value]) => {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return text.replace(pattern, value);
    }, exportFormat.template);

    const normalizedMessage = filled.replace(/\\n/g, '\n');
    assertNoReportedInExportText(normalizedMessage);
    return normalizedMessage;
  }, [exportFormat.template, formattedItems, supplierLabel]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const persistRegularRemoval = useCallback(
    async (orderItemIds: string[], status: 'order_later' | 'cancelled' = 'cancelled') => {
      if (orderItemIds.length === 0) return true;
      const success = await markOrderItemsStatus(orderItemIds, status);
      if (!success) {
        Alert.alert('Unable to Update Item', 'Please try again.');
        return false;
      }
      return true;
    },
    [markOrderItemsStatus]
  );

  const persistRemainingRemoval = useCallback(
    async (orderItemId: string, status: 'order_later' | 'cancelled' = 'cancelled') => {
      if (!orderItemId) return true;
      const success = await markOrderItemsStatus([orderItemId], status);
      if (!success) {
        Alert.alert('Unable to Move Item', 'Please try again.');
        return false;
      }
      return true;
    },
    [markOrderItemsStatus]
  );

  const handleMoveToSecondarySupplier = useCallback(
    (item: ConfirmationItem) => {
      if (!item.secondarySupplierId || !item.secondarySupplierName) return;
      const targetName = item.secondarySupplierName;
      const targetId = item.secondarySupplierId;

      Alert.alert(
        `Move to ${targetName}?`,
        `${item.name} will move back to ${targetName} on fulfillment.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move',
            onPress: () => {
              void (async () => {
                const moved = await setSupplierOverride(item.sourceOrderItemIds, targetId);
                if (!moved) {
                  Alert.alert('Unable to Move Item', 'Please try again.');
                  return;
                }

                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                setItems((prev) => prev.filter((row) => row.id !== item.id));
              })();
            },
          },
        ]
      );
    },
    [setSupplierOverride]
  );

  const handleMoveRemainingToSecondarySupplier = useCallback(
    (item: RemainingConfirmationItem) => {
      if (!item.secondarySupplierId || !item.secondarySupplierName) return;
      const targetName = item.secondarySupplierName;
      const targetId = item.secondarySupplierId;

      Alert.alert(
        `Move to ${targetName}?`,
        `${item.name} will move back to ${targetName} on fulfillment.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move',
            onPress: () => {
              void (async () => {
                const moved = await setSupplierOverride([item.orderItemId], targetId);
                if (!moved) {
                  Alert.alert('Unable to Move Item', 'Please try again.');
                  return;
                }

                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                setRemainingItems((prev) =>
                  prev.filter((row) => row.orderItemId !== item.orderItemId)
                );
              })();
            },
          },
        ]
      );
    },
    [setSupplierOverride]
  );

  const handleDelete = useCallback(
    (item: ConfirmationItem) => {
      Alert.alert('Remove Item', `Remove ${item.name} from this supplier order?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const removed = await persistRegularRemoval(item.sourceOrderItemIds);
              if (!removed) return;

              if (item.sourceDraftItemIds.length > 0) {
                removeSupplierDraftItems(item.sourceDraftItemIds);
              }

              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }

              setItems((prev) => prev.filter((row) => row.id !== item.id));
              setExpandedItems((prev) => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
              });
            })();
          },
        },
      ]);
    },
    [persistRegularRemoval, removeSupplierDraftItems]
  );

  const handleDeleteRemaining = useCallback(
    (item: RemainingConfirmationItem) => {
      Alert.alert('Remove Item', `Remove ${item.name} from this supplier order?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const removed = await persistRemainingRemoval(item.orderItemId);
              if (!removed) return;

              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              setRemainingItems((prev) =>
                prev.filter((row) => row.orderItemId !== item.orderItemId)
              );
            })();
          },
        },
      ]);
    },
    [persistRemainingRemoval]
  );

  const orderLaterRegularItem = useMemo(() => {
    if (!orderLaterTarget || orderLaterTarget.kind !== 'regular') return null;
    return items.find((row) => row.id === orderLaterTarget.id) ?? null;
  }, [items, orderLaterTarget]);

  const orderLaterRemainingItem = useMemo(() => {
    if (!orderLaterTarget || orderLaterTarget.kind !== 'remaining') return null;
    return remainingItems.find((row) => row.orderItemId === orderLaterTarget.id) ?? null;
  }, [orderLaterTarget, remainingItems]);

  const overflowRegularItem = useMemo(() => {
    if (!overflowTarget || overflowTarget.kind !== 'regular') return null;
    return items.find((row) => row.id === overflowTarget.id) ?? null;
  }, [items, overflowTarget]);

  const overflowRemainingItem = useMemo(() => {
    if (!overflowTarget || overflowTarget.kind !== 'remaining') return null;
    return remainingItems.find((row) => row.orderItemId === overflowTarget.id) ?? null;
  }, [overflowTarget, remainingItems]);

  const noteRegularItem = useMemo(() => {
    if (!noteEditorTarget || noteEditorTarget.kind !== 'regular') return null;
    return items.find((row) => row.id === noteEditorTarget.id) ?? null;
  }, [items, noteEditorTarget]);

  const noteRemainingItem = useMemo(() => {
    if (!noteEditorTarget || noteEditorTarget.kind !== 'remaining') return null;
    return remainingItems.find((row) => row.orderItemId === noteEditorTarget.id) ?? null;
  }, [noteEditorTarget, remainingItems]);

  const closeNoteEditor = useCallback(() => {
    setNoteEditorTarget(null);
    setNoteDraft('');
  }, []);

  const handleOpenRegularNoteEditor = useCallback((item: ConfirmationItem) => {
    setOverflowTarget(null);
    setNoteEditorTarget({ kind: 'regular', id: item.id });
    setNoteDraft(item.notes.map((note) => note.text.trim()).filter((note) => note.length > 0).join(' • '));
  }, []);

  const handleOpenRemainingNoteEditor = useCallback((item: RemainingConfirmationItem) => {
    setOverflowTarget(null);
    setNoteEditorTarget({ kind: 'remaining', id: item.orderItemId });
    setNoteDraft(item.note ?? '');
  }, []);

  const handleSaveNote = useCallback(async () => {
    const regularTarget = noteRegularItem;
    const remainingTarget = noteRemainingItem;
    if (!regularTarget && !remainingTarget) return;

    const normalized = noteDraft.trim();
    setIsSavingNote(true);
    try {
      if (regularTarget && regularTarget.sourceOrderItemIds.length > 0) {
        const { error } = await (supabase as any)
          .from('order_items')
          .update({ note: normalized.length > 0 ? normalized : null })
          .in('id', regularTarget.sourceOrderItemIds);
        if (error) throw error;
      }

      if (remainingTarget) {
        const { error } = await (supabase as any)
          .from('order_items')
          .update({ note: normalized.length > 0 ? normalized : null })
          .eq('id', remainingTarget.orderItemId);
        if (error) throw error;
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      closeNoteEditor();
      await refreshFromSupplierSource();
    } catch (error: any) {
      Alert.alert('Unable to Save Note', error?.message || 'Please try again.');
    } finally {
      setIsSavingNote(false);
    }
  }, [
    closeNoteEditor,
    noteDraft,
    noteRegularItem,
    noteRemainingItem,
    refreshFromSupplierSource,
  ]);

  const showRemainingBreakdown = useCallback(
    (item: RemainingConfirmationItem) => {
      const rows = remainingContributorBreakdownByOrderItemId[item.orderItemId] ?? [];
      if (rows.length <= 1) {
        Alert.alert('Breakdown', 'Only one employee contributed to this line.');
        return;
      }

      const message = rows
        .map((entry) => {
          const unit = item.unitLabel;
          const entryCount = entry.rowCount > 1 ? ` • ${entry.rowCount} entries` : '';
          return `${entry.name}: ${formatQuantity(entry.reportedTotal)} ${unit}${entryCount}`;
        })
        .join('\n');
      Alert.alert('Per-Employee Breakdown', message);
    },
    [remainingContributorBreakdownByOrderItemId]
  );

  const getRegularUnitSiblings = useCallback(
    (item: ConfirmationItem) =>
      items.filter(
        (row) =>
          row.id !== item.id &&
          row.inventoryItemId === item.inventoryItemId &&
          row.locationGroup === item.locationGroup
      ),
    [items]
  );

  const getRegularConversionMultiplier = useCallback(
    (source: ConfirmationItem, target: ConfirmationItem) => {
      const unitInfo = unitInfoMap[source.inventoryItemId];
      return resolveUnitConversionMultiplier({
        inventoryItemId: source.inventoryItemId,
        fromUnitLabel: source.unitLabel,
        toUnitLabel: target.unitLabel,
        fromUnitType: source.unitType,
        toUnitType: target.unitType,
        packSize: unitInfo?.pack_size ?? null,
        lookup: unitConversionLookup,
      });
    },
    [unitConversionLookup, unitInfoMap]
  );

  const combineRegularItemIntoTarget = useCallback(
    (sourceItemId: string, targetItemId: string) => {
      setItems((prev) => {
        const source = prev.find((row) => row.id === sourceItemId);
        const target = prev.find((row) => row.id === targetItemId);
        if (!source || !target) return prev;

        const conversionMultiplier = getRegularConversionMultiplier(source, target);
        if (!conversionMultiplier) return prev;

        const convertedQuantity = applyUnitConversion(source.quantity, conversionMultiplier);
        const convertedContributorTotal = applyUnitConversion(
          source.sumOfContributorQuantities,
          conversionMultiplier
        );

        if (!Number.isFinite(convertedQuantity) || convertedQuantity <= 0) return prev;

        const contributorMap = new Map<string, ConfirmationContributor>();
        target.contributors.forEach((entry) => {
          contributorMap.set(`${entry.userId || entry.name}:${entry.name}`, { ...entry });
        });
        source.contributors.forEach((entry) => {
          const converted = applyUnitConversion(entry.quantity, conversionMultiplier);
          if (!Number.isFinite(converted) || converted <= 0) return;

          const contributorKey = `${entry.userId || entry.name}:${entry.name}`;
          const existing = contributorMap.get(contributorKey);
          if (existing) {
            existing.quantity += converted;
          } else {
            contributorMap.set(contributorKey, {
              ...entry,
              quantity: converted,
            });
          }
        });

        const detailMap = new Map<string, ConfirmationDetail>();
        target.details.forEach((entry) => {
          detailMap.set(`${entry.locationId || entry.locationName}:${entry.orderedBy}`, { ...entry });
        });
        source.details.forEach((entry) => {
          const converted = applyUnitConversion(entry.quantity, conversionMultiplier);
          if (!Number.isFinite(converted) || converted <= 0) return;

          const key = `${entry.locationId || entry.locationName}:${entry.orderedBy}`;
          const existing = detailMap.get(key);
          if (existing) {
            existing.quantity += converted;
          } else {
            detailMap.set(key, {
              ...entry,
              quantity: converted,
            });
          }
        });

        const notes = [...target.notes];
        source.notes.forEach((note) => {
          if (!notes.some((existing) => existing.id === note.id || existing.text === note.text)) {
            notes.push({ ...note });
          }
        });

        const mergedTarget: ConfirmationItem = {
          ...target,
          quantity: target.quantity + convertedQuantity,
          sumOfContributorQuantities:
            target.sumOfContributorQuantities + convertedContributorTotal,
          sourceOrderItemIds: Array.from(
            new Set([...target.sourceOrderItemIds, ...source.sourceOrderItemIds])
          ),
          sourceOrderIds: Array.from(new Set([...target.sourceOrderIds, ...source.sourceOrderIds])),
          sourceDraftItemIds: Array.from(
            new Set([...target.sourceDraftItemIds, ...source.sourceDraftItemIds])
          ),
          contributors: Array.from(contributorMap.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
          ),
          details: Array.from(detailMap.values()).sort((a, b) =>
            a.locationName.localeCompare(b.locationName)
          ),
          notes: notes.sort((a, b) => a.text.localeCompare(b.text)),
        };

        return prev
          .filter((row) => row.id !== source.id)
          .map((row) => (row.id === target.id ? mergedTarget : row));
      });

      setExpandedItems((prev) => {
        const next = new Set(prev);
        next.delete(sourceItemId);
        next.add(targetItemId);
        return next;
      });
    },
    [getRegularConversionMultiplier]
  );

  const handleResolveUnitCombine = useCallback(
    (item: ConfirmationItem) => {
      const siblings = getRegularUnitSiblings(item).filter(
        (row) => row.unitType !== item.unitType
      );

      if (siblings.length === 0) {
        Alert.alert(
          'No Unit Conflict',
          'This line has no alternate unit line to combine with.'
        );
        return;
      }

      const convertibleTargets = siblings.filter((target) => {
        const multiplier = getRegularConversionMultiplier(item, target);
        return Number.isFinite(multiplier) && (multiplier as number) > 0;
      });

      if (convertibleTargets.length === 0) {
        Alert.alert(
          'No Conversion Available',
          'No conversion rule is defined for this item yet. It will stay as separate lines.'
        );
        return;
      }

      const options = convertibleTargets.map((target) => ({
        text: `Convert into ${target.unitLabel}`,
        onPress: () => combineRegularItemIntoTarget(item.id, target.id),
      }));

      Alert.alert(
        'Resolve Units',
        `Choose how to resolve ${item.name}.`,
        [
          {
            text: 'Send as separate lines',
            style: 'cancel',
            onPress: () => {},
          },
          ...options,
        ]
      );
    },
    [combineRegularItemIntoTarget, getRegularConversionMultiplier, getRegularUnitSiblings]
  );

  const overflowActionSections = useMemo<ItemActionSheetSection[]>(() => {
    if (!overflowRegularItem && !overflowRemainingItem) return [];

    if (overflowRegularItem) {
      const sections: ItemActionSheetSection[] = [];
      sections.push({
        id: 'regular-logistics',
        title: 'Logistics',
        items: [
          {
            id: 'regular-order-later',
            label: 'Move to Order Later',
            icon: 'time-outline',
            onPress: () => {
              setOverflowTarget(null);
              setOrderLaterTarget({ kind: 'regular', id: overflowRegularItem.id });
            },
          },
          ...(overflowRegularItem.contributors.length > 1
            ? [
                {
                  id: 'regular-breakdown',
                  label: 'View breakdown',
                  icon: 'list-outline' as const,
                  onPress: () => {
                    setOverflowTarget(null);
                    setExpandedItems((prev) => {
                      const next = new Set(prev);
                      next.add(overflowRegularItem.id);
                      return next;
                    });
                  },
                },
              ]
            : []),
          ...(getRegularUnitSiblings(overflowRegularItem).some(
            (row) =>
              row.unitType !== overflowRegularItem.unitType &&
              Number.isFinite(getRegularConversionMultiplier(overflowRegularItem, row)) &&
              (getRegularConversionMultiplier(overflowRegularItem, row) as number) > 0
          )
            ? [
                {
                  id: 'regular-resolve-units',
                  label: 'Resolve units / Combine',
                  icon: 'git-merge-outline' as const,
                  onPress: () => {
                    setOverflowTarget(null);
                    handleResolveUnitCombine(overflowRegularItem);
                  },
                },
              ]
            : []),
        ],
      });

      const supplierItems = [];
      if (overflowRegularItem.secondarySupplierId && overflowRegularItem.secondarySupplierName) {
        supplierItems.push({
          id: 'regular-secondary',
          label: `Move to ${overflowRegularItem.secondarySupplierName}`,
          icon: 'swap-horizontal',
          onPress: () => {
            setOverflowTarget(null);
            handleMoveToSecondarySupplier(overflowRegularItem);
          },
        });
      }
      if (supplierItems.length > 0) {
        sections.push({
          id: 'regular-supplier',
          title: 'Supplier',
          items: supplierItems,
        });
      }

      sections.push({
        id: 'regular-item',
        title: 'Item',
        items: [
          {
            id: 'regular-note',
            label: overflowRegularItem.notes.length > 0 ? 'Edit Note' : 'Add Note',
            icon: 'create-outline',
            onPress: () => handleOpenRegularNoteEditor(overflowRegularItem),
          },
        ],
      });

      sections.push({
        id: 'regular-danger',
        title: 'Danger Zone',
        items: [
          {
            id: 'regular-remove',
            label: 'Remove item from this supplier order',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => {
              setOverflowTarget(null);
              handleDelete(overflowRegularItem);
            },
          },
        ],
      });

      return sections;
    }

    if (overflowRemainingItem) {
      const sections: ItemActionSheetSection[] = [];
      const breakdown = remainingContributorBreakdownByOrderItemId[overflowRemainingItem.orderItemId] ?? [];
      const logisticsItems = [
        {
          id: 'remaining-order-later',
          label: 'Move to Order Later',
          icon: 'time-outline' as const,
          onPress: () => {
            setOverflowTarget(null);
            setOrderLaterTarget({ kind: 'remaining', id: overflowRemainingItem.orderItemId });
          },
        },
        ...(breakdown.length > 1
          ? [
              {
                id: 'remaining-breakdown',
                label: 'View breakdown',
                icon: 'list-outline' as const,
                onPress: () => {
                  setOverflowTarget(null);
                  showRemainingBreakdown(overflowRemainingItem);
                },
              },
            ]
          : []),
      ];
      sections.push({
        id: 'remaining-logistics',
        title: 'Logistics',
        items: logisticsItems,
      });

      if (overflowRemainingItem.secondarySupplierId && overflowRemainingItem.secondarySupplierName) {
        sections.push({
          id: 'remaining-supplier',
          title: 'Supplier',
          items: [
            {
              id: 'remaining-secondary',
              label: `Move to ${overflowRemainingItem.secondarySupplierName}`,
              icon: 'swap-horizontal',
              onPress: () => {
                setOverflowTarget(null);
                handleMoveRemainingToSecondarySupplier(overflowRemainingItem);
              },
            },
          ],
        });
      }

      sections.push({
        id: 'remaining-item',
        title: 'Item',
        items: [
          {
            id: 'remaining-note',
            label: overflowRemainingItem.note ? 'Edit Note' : 'Add Note',
            icon: 'create-outline',
            onPress: () => handleOpenRemainingNoteEditor(overflowRemainingItem),
          },
        ],
      });

      sections.push({
        id: 'remaining-danger',
        title: 'Danger Zone',
        items: [
          {
            id: 'remaining-remove',
            label: 'Remove item from this supplier order',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => {
              setOverflowTarget(null);
              handleDeleteRemaining(overflowRemainingItem);
            },
          },
        ],
      });

      return sections;
    }

    return [];
  }, [
    handleDelete,
    handleDeleteRemaining,
    handleMoveRemainingToSecondarySupplier,
    handleMoveToSecondarySupplier,
    handleOpenRegularNoteEditor,
    handleOpenRemainingNoteEditor,
    handleResolveUnitCombine,
    overflowRegularItem,
    overflowRemainingItem,
    remainingContributorBreakdownByOrderItemId,
    getRegularConversionMultiplier,
    getRegularUnitSiblings,
    showRemainingBreakdown,
  ]);

  const handleRegularItemOverflow = useCallback((item: ConfirmationItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setOverflowTarget({ kind: 'regular', id: item.id });
  }, []);

  const handleRemainingItemOverflow = useCallback((item: RemainingConfirmationItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setOverflowTarget({ kind: 'remaining', id: item.orderItemId });
  }, []);

  const handleQuantityChange = useCallback(
    (item: ConfirmationItem, newQuantity: number) => {
      if (!Number.isFinite(newQuantity)) return;
      const safeValue = Math.max(0, newQuantity);

      if (safeValue <= 0) {
        handleDelete(item);
        return;
      }

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                quantity: safeValue,
              }
            : row
        )
      );

      if (item.sourceDraftItemIds.length === 1) {
        updateSupplierDraftItemQuantity(item.sourceDraftItemIds[0], safeValue);
      }
    },
    [handleDelete, updateSupplierDraftItemQuantity]
  );

  const handleResetToSum = useCallback((item: ConfirmationItem) => {
    const resetQuantity = Math.max(0, item.sumOfContributorQuantities);
    if (resetQuantity <= 0) return;
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? {
              ...row,
              quantity: resetQuantity,
            }
          : row
      )
    );
    if (item.sourceDraftItemIds.length === 1) {
      updateSupplierDraftItemQuantity(item.sourceDraftItemIds[0], resetQuantity);
    }
  }, [updateSupplierDraftItemQuantity]);

  const setRemainingDecisionLocal = useCallback((orderItemId: string, decidedQuantity: number | null) => {
    setRemainingItems((prev) =>
      prev.map((item) =>
        item.orderItemId === orderItemId
          ? {
              ...item,
              decidedQuantity,
            }
          : item
      )
    );
  }, []);

  const handleRemainingQuantityChange = useCallback(
    (item: RemainingConfirmationItem, nextValue: number | null) => {
      if (nextValue == null) {
        setRemainingDecisionLocal(item.orderItemId, null);
        return;
      }

      const safeValue = Math.max(0, nextValue);
      const previousValue = item.decidedQuantity;
      setRemainingDecisionLocal(item.orderItemId, safeValue);
      void persistRemainingDecision(item.orderItemId, safeValue, { silent: true }).then((saved) => {
        if (!saved) {
          setRemainingDecisionLocal(item.orderItemId, previousValue);
        }
      });
    },
    [persistRemainingDecision, setRemainingDecisionLocal]
  );

  const handleAutoFillSuggestions = useCallback(async () => {
    const unresolvedItems = remainingItems.filter(
      (item) =>
        item.decidedQuantity == null ||
        !Number.isFinite(item.decidedQuantity) ||
        item.decidedQuantity <= 0
    );

    if (unresolvedItems.length === 0) {
      Alert.alert('Already Filled', 'All remaining items already have final quantities.');
      return;
    }

    const candidates = unresolvedItems
      .map((item) => ({ item, suggestion: getSuggestion(item) }))
      .filter(
        (entry): entry is { item: RemainingConfirmationItem; suggestion: number } =>
          entry.suggestion != null && Number.isFinite(entry.suggestion)
      );

    if (candidates.length === 0) {
      Alert.alert(
        historyUnavailableOffline ? 'History Unavailable Offline' : 'No History Available',
        historyUnavailableOffline
          ? 'Reconnect to load last ordered quantities.'
          : 'No previous order quantities were found for the unresolved items.'
      );
      return;
    }

    const previousValuesById = new Map(
      remainingItems.map((item) => [item.orderItemId, item.decidedQuantity] as const)
    );
    const nextById = new Map(candidates.map((entry) => [entry.item.orderItemId, entry.suggestion]));
    setRemainingItems((prev) =>
      prev.map((item) =>
        nextById.has(item.orderItemId)
          ? {
              ...item,
              decidedQuantity: nextById.get(item.orderItemId) ?? item.decidedQuantity,
            }
          : item
      )
    );

    const results = await Promise.all(
      candidates.map((entry) =>
        persistRemainingDecision(entry.item.orderItemId, entry.suggestion, { silent: true })
      )
    );
    results.forEach((saved, index) => {
      if (saved) return;
      const failedItem = candidates[index]?.item;
      if (!failedItem) return;
      setRemainingDecisionLocal(
        failedItem.orderItemId,
        previousValuesById.get(failedItem.orderItemId) ?? null
      );
    });
    const successCount = results.filter(Boolean).length;

    if (successCount > 0) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Suggestions Applied', `Updated ${successCount} remaining item${successCount === 1 ? '' : 's'}.`);
    }
  }, [
    getSuggestion,
    historyUnavailableOffline,
    persistRemainingDecision,
    remainingItems,
    setRemainingDecisionLocal,
  ]);

  const buildFinalizePayload = useCallback(() => {
    const regularPayload = items.map((item) => ({
      id: item.id,
      inventoryItemId: item.inventoryItemId,
      name: item.name,
      category: item.category,
      locationGroup: item.locationGroup,
      quantity: item.quantity,
      unitType: item.unitType,
      unitLabel: item.unitLabel,
      notes: item.notes.map((note) => note.text),
      sourceOrderItemIds: item.sourceOrderItemIds,
      sourceOrderIds: item.sourceOrderIds,
      sourceDraftItemIds: item.sourceDraftItemIds,
    }));

    const remainingPayload = remainingItems.map((item) => ({
      orderItemId: item.orderItemId,
      orderId: item.orderId,
      inventoryItemId: item.inventoryItemId,
      name: item.name,
      category: item.category,
      locationGroup: item.locationGroup,
      locationId: item.locationId,
      locationName: item.locationName,
      quantity: item.decidedQuantity ?? 0,
      decidedQuantity: item.decidedQuantity ?? 0,
      reportedRemaining: item.reportedRemaining,
      unitType: item.unitType,
      unitLabel: item.unitLabel,
      note: item.note,
    }));

    const locationSet = new Set<string>();
    regularPayload.forEach((item) => {
      locationSet.add(item.locationGroup === 'poki' ? 'Poki' : 'Sushi');
    });
    remainingPayload.forEach((item) => {
      locationSet.add(item.locationGroup === 'poki' ? 'Poki' : 'Sushi');
    });

    const consumedOrderItemIds = Array.from(
      new Set([
        ...regularPayload.flatMap((item) => item.sourceOrderItemIds),
        ...remainingPayload.map((item) => item.orderItemId),
      ])
    );

    const consumedDraftItemIds = Array.from(
      new Set(regularPayload.flatMap((item) => item.sourceDraftItemIds))
    );

    const sourceOrderIds = Array.from(
      new Set([
        ...regularPayload.flatMap((item) => item.sourceOrderIds),
        ...remainingPayload.map((item) => item.orderId),
      ])
    );

    const historyLineItems = [
      ...regularPayload.map((item) => ({
        itemId: item.inventoryItemId,
        itemName: item.name,
        unit: item.unitLabel,
        quantity: item.quantity,
        locationId: null,
        locationName: null,
        locationGroup: item.locationGroup,
        unitType: item.unitType,
        note: item.notes.length > 0 ? item.notes[0] : null,
      })),
      ...remainingPayload.map((item) => ({
        itemId: item.inventoryItemId,
        itemName: item.name,
        unit: item.unitLabel,
        quantity: item.decidedQuantity ?? item.quantity,
        locationId: item.locationId,
        locationName: item.locationName,
        locationGroup: item.locationGroup,
        unitType: item.unitType,
        note: item.note,
      })),
    ].filter(
      (line) =>
        typeof line.itemId === 'string' &&
        line.itemId.trim().length > 0 &&
        Number.isFinite(line.quantity) &&
        line.quantity > 0
    );

    return {
      regularPayload,
      remainingPayload,
      historyLineItems,
      locationLabels: Array.from(locationSet),
      consumedOrderItemIds,
      consumedDraftItemIds,
      sourceOrderIds,
      totalItemCount: regularPayload.length + remainingPayload.length,
    };
  }, [items, remainingItems]);

  const finalizeOrder = useCallback(
    async (shareMethod: 'share' | 'copy') => {
      if (!user?.id) {
        Alert.alert('Sign In Required', 'Please sign in again to finalize this order.');
        return false;
      }
      if (!supplierId) {
        Alert.alert('Missing Supplier', 'Unable to finalize because supplier info is missing.');
        return false;
      }

      const payload = buildFinalizePayload();

      if (payload.consumedOrderItemIds.length === 0) {
        Alert.alert(
          'Finalize Blocked',
          'This supplier order is missing source order-item links. Pull to refresh and try again.'
        );
        return false;
      }

      if (__DEV__) {
        console.log(
          '[Fulfillment:Confirm] finalize — consumed order_item ids:',
          payload.consumedOrderItemIds.length,
          payload.consumedOrderItemIds.slice(0, 5)
        );
      }

      setIsFinalizing(true);
      try {
        // createPastOrder (called by finalizeSupplierOrder) handles:
        //   1. Inserting into past_orders + past_order_items tables
        //   2. Calling markOrderItemsStatus to set status='sent'
        //   3. Updating local state (pastOrders, orders) to remove consumed items
        //   4. Queueing for offline sync if DB operations fail
        await finalizeSupplierOrder({
          supplierId,
          supplierName: supplierLabel,
          createdBy: user.id,
          messageText,
          shareMethod,
          payload: {
            regularItems: payload.regularPayload,
            remainingItems: payload.remainingPayload,
            locations: payload.locationLabels,
            sourceOrderIds: payload.sourceOrderIds,
            source_order_ids: payload.sourceOrderIds,
            sourceOrderItemIds: payload.consumedOrderItemIds,
            source_order_item_ids: payload.consumedOrderItemIds,
            totalItemCount: payload.totalItemCount,
            finalizedAt: new Date().toISOString(),
          },
          consumedOrderItemIds: payload.consumedOrderItemIds,
          consumedDraftItemIds: payload.consumedDraftItemIds,
          lineItems: payload.historyLineItems,
        });

        // Refresh fulfillment data so the cleared items don't reappear
        try {
          await fetchPendingFulfillmentOrders(managerLocationIds);
        } catch {
          // Non-critical: local state was already updated by createPastOrder
        }

        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        router.replace('/(manager)/fulfillment');
        return true;
      } catch (error: any) {
        console.error('[Fulfillment:Confirm] finalizeOrder failed:', error);
        Alert.alert('Finalize Failed', error?.message || 'Unable to move this order to past orders.');
        return false;
      } finally {
        setIsFinalizing(false);
      }
    },
    [
      buildFinalizePayload,
      fetchPendingFulfillmentOrders,
      finalizeSupplierOrder,
      managerLocationIds,
      messageText,
      supplierId,
      supplierLabel,
      user?.id,
    ]
  );

  const handleMoveTargetToOrderLater = useCallback(
    async (scheduledAtIso: string) => {
      if (!user?.id) {
        Alert.alert('Sign In Required', 'Please sign in again to schedule order-later items.');
        return;
      }

      const preferredSupplierId = supplierId ?? undefined;

      if (orderLaterRegularItem) {
        const removed = await persistRegularRemoval(orderLaterRegularItem.sourceOrderItemIds, 'order_later');
        if (!removed) return;

        if (orderLaterRegularItem.sourceDraftItemIds.length > 0) {
          removeSupplierDraftItems(orderLaterRegularItem.sourceDraftItemIds);
        }

        const noteText = orderLaterRegularItem.notes
          .map((note) => note.text.trim())
          .filter((note) => note.length > 0)
          .join(' • ');
        const firstDetail = orderLaterRegularItem.details[0];

        await createOrderLaterItem({
          createdBy: user.id,
          scheduledAt: scheduledAtIso,
          quantity: orderLaterRegularItem.quantity,
          itemId: orderLaterRegularItem.inventoryItemId,
          itemName: orderLaterRegularItem.name,
          unit: orderLaterRegularItem.unitLabel,
          locationId: firstDetail?.locationId,
          locationName: firstDetail?.locationName,
          notes: noteText.length > 0 ? noteText : null,
          suggestedSupplierId: preferredSupplierId,
          preferredSupplierId,
          preferredLocationGroup: orderLaterRegularItem.locationGroup,
          sourceOrderItemId:
            orderLaterRegularItem.sourceOrderItemIds.length === 1
              ? orderLaterRegularItem.sourceOrderItemIds[0]
              : null,
          sourceOrderItemIds: orderLaterRegularItem.sourceOrderItemIds,
          sourceOrderId:
            orderLaterRegularItem.sourceOrderIds.length === 1
              ? orderLaterRegularItem.sourceOrderIds[0]
              : null,
          payload: {
            quantity: orderLaterRegularItem.quantity,
            unitType: orderLaterRegularItem.unitType,
            unitLabel: orderLaterRegularItem.unitLabel,
            category: orderLaterRegularItem.category,
            locationGroup: orderLaterRegularItem.locationGroup,
            sourceDraftItemIds: orderLaterRegularItem.sourceDraftItemIds,
          },
        });

        setItems((prev) => prev.filter((item) => item.id !== orderLaterRegularItem.id));
        setExpandedItems((prev) => {
          const next = new Set(prev);
          next.delete(orderLaterRegularItem.id);
          return next;
        });
      } else if (orderLaterRemainingItem) {
        const removed = await persistRemainingRemoval(orderLaterRemainingItem.orderItemId, 'order_later');
        if (!removed) return;

        await createOrderLaterItem({
          createdBy: user.id,
          scheduledAt: scheduledAtIso,
          quantity: orderLaterRemainingItem.decidedQuantity ?? 0,
          itemId: orderLaterRemainingItem.inventoryItemId,
          itemName: orderLaterRemainingItem.name,
          unit: orderLaterRemainingItem.unitLabel,
          locationId: orderLaterRemainingItem.locationId,
          locationName: orderLaterRemainingItem.locationName,
          notes: orderLaterRemainingItem.note,
          suggestedSupplierId: preferredSupplierId,
          preferredSupplierId,
          preferredLocationGroup: orderLaterRemainingItem.locationGroup,
          sourceOrderItemId: orderLaterRemainingItem.orderItemId,
          sourceOrderItemIds: [orderLaterRemainingItem.orderItemId],
          sourceOrderId: orderLaterRemainingItem.orderId,
          payload: {
            quantity: orderLaterRemainingItem.decidedQuantity ?? 0,
            reportedRemaining: orderLaterRemainingItem.reportedRemaining,
            unitType: orderLaterRemainingItem.unitType,
            unitLabel: orderLaterRemainingItem.unitLabel,
            category: orderLaterRemainingItem.category,
            locationGroup: orderLaterRemainingItem.locationGroup,
            inputMode: 'remaining',
          },
        });

        setRemainingItems((prev) =>
          prev.filter((item) => item.orderItemId !== orderLaterRemainingItem.orderItemId)
        );
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Moved to Order Later', 'Item moved to Order Later.');
      setOrderLaterTarget(null);
    },
    [
      createOrderLaterItem,
      orderLaterRegularItem,
      orderLaterRemainingItem,
      persistRegularRemoval,
      persistRemainingRemoval,
      removeSupplierDraftItems,
      supplierId,
      user?.id,
    ]
  );

  const handleShareOrder = useCallback(async () => {
    if (actionsDisabled) {
      Alert.alert('Decision Required', 'Set final quantities greater than zero for all remaining items before ordering.');
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // Start finalization in parallel with the share sheet so DB work
    // happens while the user is interacting with the share dialog.
    const finalizePromise = finalizeOrder('share');

    try {
      await Share.share({
        message: messageText,
        title: `${supplierLabel} Order`,
      });
    } catch {
      // Share dialog threw (rare) — finalization still running in background.
    }

    // Wait for finalization to finish (usually already done by now).
    const finalized = await finalizePromise;
    if (!finalized) {
      setShowRetryActions(true);
    }
  }, [actionsDisabled, finalizeOrder, messageText, supplierLabel]);

  const handleCopyToClipboard = useCallback(async () => {
    if (actionsDisabled) {
      Alert.alert('Decision Required', 'Set final quantities greater than zero for all remaining items before ordering.');
      return;
    }

    await Clipboard.setStringAsync(messageText);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // Always finalize after copy — the order is done.
    const finalized = await finalizeOrder('copy');
    if (!finalized) {
      setShowRetryActions(true);
    }
  }, [actionsDisabled, finalizeOrder, messageText]);

  const handleRemainingInstructionsPress = useCallback(() => {
    Alert.alert(
      'Remaining Item Instructions',
      [
        'Set a final order quantity greater than zero for each remaining item.',
        'Use "Suggested" or "Auto-fill" when suggestions are available.',
        'If you do not want to order now, open the item menu (•••) and choose "Set to Order Later".',
        'Share stays disabled until all remaining items are resolved.',
      ].join('\n\n')
    );
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right', 'bottom']}>
      <ManagerScaleContainer>
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <TouchableOpacity
              onPress={handleBackPress}
              className="p-2 mr-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
            </TouchableOpacity>
            <View>
              <Text className="text-lg font-bold text-gray-900">{supplierLabel}</Text>
              <Text className="text-xs text-gray-500">Review Order</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => router.push('/(manager)/settings/export-format')} className="p-2">
            <Ionicons name="create-outline" size={18} color={colors.gray[600]} />
          </TouchableOpacity>
        </View>

        <FlatList
          className="flex-1"
          data={regularListEntries}
          keyExtractor={(entry) => entry.key}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={(
            <View>
              {remainingItems.length > 0 && (
                <View className="bg-white rounded-2xl border border-amber-200 px-3 py-3 mb-3">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1 pr-2">
                      <View className="flex-row items-center">
                        <Text className="text-base font-bold text-amber-900">Remaining Items</Text>
                        <TouchableOpacity
                          onPress={handleRemainingInstructionsPress}
                          className="ml-1.5 p-1"
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="information-circle-outline" size={16} color="#B45309" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={handleAutoFillSuggestions}
                      disabled={suggestionCount === 0 || loadingLastOrdered || savingRemainingIds.size > 0}
                      className={`px-2.5 py-1.5 rounded-lg ${
                        suggestionCount === 0 || loadingLastOrdered || savingRemainingIds.size > 0
                          ? 'bg-amber-100'
                          : 'bg-amber-200'
                      }`}
                    >
                      <Text className="text-xs font-semibold text-amber-900">Auto-fill</Text>
                    </TouchableOpacity>
                  </View>

                  {hasMissingRemaining && (
                    <View className="mt-2 rounded-lg bg-red-50 border border-red-200 px-2.5 py-2">
                      <Text className="text-xs font-medium text-red-700">
                        {unresolvedRemainingItemIds.length} remaining item
                        {unresolvedRemainingItemIds.length === 1 ? '' : 's'} still need a final quantity.
                      </Text>
                    </View>
                  )}

                  <View className="mt-2">
                    {(['sushi', 'poki'] as LocationGroup[]).map((group) => {
                      const rows = groupedRemainingItems[group];
                      if (!rows || rows.length === 0) return null;

                      return (
                        <View key={`remaining-${group}`} className="mb-3 last:mb-0">
                          <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                            {LOCATION_GROUP_LABELS[group]}
                          </Text>

                          {rows.map((item, index) => {
                            const suggested = getSuggestion(item);
                            const isSaving = savingRemainingIds.has(item.orderItemId);
                            const settings = getExportSettings(item.orderItemId, item.unitType);
                            const contributorBreakdown =
                              remainingContributorBreakdownByOrderItemId[item.orderItemId] ?? [];
                            const unitSelectorProps = getUnitSelectorPropsByInventoryItemId(
                              item.inventoryItemId,
                              item.unitType,
                              item.unitLabel
                            );

                            return (
                              <View
                                key={item.orderItemId}
                                className={index < rows.length - 1 ? 'mb-2' : ''}
                              >
                                <RemainingItemRow
                                  item={item}
                                  suggested={suggested}
                                  isSaving={isSaving}
                                  unitSelectorProps={unitSelectorProps}
                                  exportUnitType={settings.exportUnitType}
                                  contributorBreakdown={contributorBreakdown}
                                  onUnitChange={(unit) =>
                                    updateExportSettings(item.orderItemId, { exportUnitType: unit })
                                  }
                                  onQuantityChange={handleRemainingQuantityChange}
                                  onOverflowPress={handleRemainingItemOverflow}
                                />
                              </View>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              <View className="bg-white rounded-2xl border border-gray-100 p-3 mb-3">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Message Preview</Text>
                  <TouchableOpacity
                    onPress={() => router.push('/(manager)/settings/export-format')}
                    className="flex-row items-center"
                  >
                    <Ionicons name="create-outline" size={14} color={colors.primary[500]} />
                    <Text className="text-xs text-primary-600 font-semibold ml-1">Edit Format</Text>
                  </TouchableOpacity>
                </View>
                <View className="bg-gray-50 rounded-xl p-2.5">
                  <Text className="text-sm text-gray-800 leading-5">{messageText}</Text>
                </View>
              </View>

              {hasAnyItems ? (
                <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2.5">
                  Regular Items ({regularItemCount})
                </Text>
              ) : null}
            </View>
          )}
          ListEmptyComponent={(
            hasAnyItems ? (
              <View className="items-center justify-center py-8 bg-white border border-gray-200 rounded-xl">
                <Text className="text-gray-500 text-sm">No regular items in this supplier section</Text>
              </View>
            ) : (
              <View className="items-center justify-center py-12">
                <Ionicons name="list-outline" size={48} color={colors.gray[300]} />
                <Text className="text-gray-500 text-base mt-3">No items to confirm</Text>
                <Text className="text-gray-400 text-sm mt-1">Return to fulfillment to select items</Text>
              </View>
            )
          )}
          renderItem={({ item: entry }) => {
            if (entry.type === 'group-header') {
              const label = LOCATION_GROUP_LABELS[entry.group].toUpperCase();
              return (
                <View className="mb-2">
                  <View className="flex-row items-center">
                    <View className="flex-1 h-px bg-gray-200" />
                    <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest mx-3">
                      {label}
                    </Text>
                    <View className="flex-1 h-px bg-gray-200" />
                  </View>
                </View>
              );
            }

            const item = entry.item;
            const isExpanded = expandedItems.has(item.id);
            const contributorCount = item.contributors.length;
            const hasMultipleContributors = contributorCount > 1;
            const singleContributorName =
              item.contributors[0]?.name ||
              item.details[0]?.orderedBy ||
              'Unknown';
            const finalTotalText = `${formatQuantity(item.quantity)} ${item.unitLabel}`;
            const contributorTotalText = `${formatQuantity(item.sumOfContributorQuantities)} ${item.unitLabel}`;
            const canResetToSum =
              hasMultipleContributors &&
              Math.abs(item.quantity - item.sumOfContributorQuantities) > 0.000001;
            const settings = getExportSettings(item.id, item.unitType);
            const unitSelectorProps = getUnitSelectorPropsByInventoryItemId(
              item.inventoryItemId,
              item.unitType,
              item.unitLabel
            );

            return (
              <View className="mb-2.5">
                <FulfillmentConfirmItemRow
                  title={item.name}
                  headerActions={(
                    <>
                      <TouchableOpacity
                        onPress={() => handleRegularItemOverflow(item)}
                        className="p-1.5 mr-1"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color={colors.gray[500]} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => toggleExpand(item.id)}
                        className="p-1.5"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name={isExpanded ? 'information-circle' : 'information-circle-outline'}
                          size={18}
                          color={isExpanded ? colors.primary[500] : colors.gray[500]}
                        />
                      </TouchableOpacity>
                    </>
                  )}
                  quantityValue={formatQuantity(item.quantity)}
                  onQuantityChangeText={(text) => {
                    const sanitized = text.replace(/[^0-9.]/g, '');
                    if (sanitized.length === 0) return;
                    const parsed = Number(sanitized);
                    if (!Number.isFinite(parsed)) return;
                    handleQuantityChange(item, parsed);
                  }}
                  onDecrement={() => handleQuantityChange(item, item.quantity - 1)}
                  onIncrement={() => handleQuantityChange(item, item.quantity + 1)}
                  unitSelector={(
                    <QuantityExportSelector
                      exportUnitType={settings.exportUnitType}
                      baseUnitLabel={unitSelectorProps.baseUnitLabel}
                      packUnitLabel={unitSelectorProps.packUnitLabel}
                      canSwitchUnit={unitSelectorProps.canSwitchUnit}
                      onUnitChange={(unit) =>
                        updateExportSettings(item.id, { exportUnitType: unit })
                      }
                    />
                  )}
                  detailsVisible={isExpanded}
                  details={(
                    <View className="rounded-xl border border-gray-200 bg-white px-3 py-3">
                      <Text className="text-sm font-semibold text-gray-900">
                        Ordered by: {hasMultipleContributors ? `${contributorCount} people` : singleContributorName}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-1">
                        Final total: {finalTotalText}
                      </Text>

                      {hasMultipleContributors && (
                        <View className="mt-3">
                          <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Per-person breakdown
                          </Text>
                          {item.contributors.map((contributor, contributorIndex) => (
                            <View
                              key={`${item.id}-contributor-${contributor.userId || contributor.name}-${contributorIndex}`}
                              className={`flex-row items-center justify-between py-1.5 ${
                                contributorIndex < item.contributors.length - 1 ? 'border-b border-gray-200' : ''
                              }`}
                            >
                              <Text className="text-sm text-gray-700">{contributor.name}</Text>
                              <Text className="text-sm font-medium text-gray-700">
                                {formatQuantity(contributor.quantity)} {item.unitLabel}
                              </Text>
                            </View>
                          ))}
                          <Text className="text-xs text-gray-500 mt-2">
                            Contributors total: {contributorTotalText}
                          </Text>

                          {canResetToSum && (
                            <TouchableOpacity
                              onPress={() => handleResetToSum(item)}
                              className="self-start mt-2 px-2.5 py-1.5 rounded-md bg-gray-200"
                            >
                              <Text className="text-[11px] font-semibold text-gray-700">Reset to sum</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {item.details.length > 0 && (
                        <View className="mt-3">
                          <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Location breakdown
                          </Text>
                          {item.details.map((detail, detailIndex) => (
                            <View
                              key={`${item.id}-detail-${detail.locationId || detail.locationName}-${detailIndex}`}
                              className={`py-1.5 ${
                                detailIndex < item.details.length - 1 ? 'border-b border-gray-200' : ''
                              }`}
                            >
                              <View className="flex-row items-center justify-between">
                                <Text className="text-sm text-gray-700">
                                  {detail.locationName}
                                  {detail.shortCode ? ` (${detail.shortCode})` : ''}
                                </Text>
                                <Text className="text-sm font-medium text-gray-700">
                                  {formatQuantity(detail.quantity)} {item.unitLabel}
                                </Text>
                              </View>
                              <Text className="text-xs text-gray-500 mt-1">Ordered by {detail.orderedBy}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {item.notes.length > 0 && (
                        <View className="mt-3">
                          <Text className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                            Notes
                          </Text>
                          {item.notes.map((note, noteIndex) => (
                            <View
                              key={note.id}
                              className={`rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-2 ${
                                noteIndex < item.notes.length - 1 ? 'mb-2' : ''
                              }`}
                            >
                              <Text className="text-[11px] font-semibold text-blue-700">
                                {note.author} • {note.locationName} ({note.shortCode})
                              </Text>
                              <Text className="text-xs text-blue-900 mt-1">{note.text}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                />
              </View>
            );
          }}
        />

        <ItemActionSheet
          visible={Boolean(overflowRegularItem || overflowRemainingItem)}
          title="Item Actions"
          subtitle={overflowRegularItem?.name || overflowRemainingItem?.name}
          sections={overflowActionSections}
          onClose={() => setOverflowTarget(null)}
        />

        <Modal
          visible={Boolean(noteRegularItem || noteRemainingItem)}
          transparent
          animationType="fade"
          onRequestClose={closeNoteEditor}
        >
          <Pressable className="flex-1 bg-black/35 justify-end" onPress={closeNoteEditor}>
            <Pressable
              className="bg-white rounded-t-3xl px-4 pt-4 pb-5"
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-1 pr-2">
                  <Text className="text-lg font-bold text-gray-900">
                    {(noteRegularItem?.notes.length || noteRemainingItem?.note) ? 'Edit Note' : 'Add Note'}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {noteRegularItem?.name || noteRemainingItem?.name || ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={closeNoteEditor} className="p-2">
                  <Ionicons name="close" size={20} color={colors.gray[500]} />
                </TouchableOpacity>
              </View>

              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Add supplier note..."
                placeholderTextColor={colors.gray[400]}
                multiline
                maxLength={240}
                textAlignVertical="top"
                className="min-h-[110px] rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900"
              />
              <Text className="text-xs text-gray-400 mt-2">{noteDraft.length}/240</Text>

              <View className="flex-row mt-4">
                <TouchableOpacity
                  onPress={closeNoteEditor}
                  className="flex-1 py-3 rounded-xl bg-gray-100 items-center justify-center mr-2"
                >
                  <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveNote}
                  disabled={isSavingNote}
                  className={`flex-1 py-3 rounded-xl items-center justify-center ${
                    isSavingNote ? 'bg-primary-300' : 'bg-primary-500'
                  }`}
                >
                  <Text className="text-sm font-semibold text-white">
                    {isSavingNote ? 'Saving...' : 'Save Note'}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <View className="bg-white border-t border-gray-200 px-4 py-4">
          {showRetryActions ? (
            <View className="flex-row">
              <TouchableOpacity
                onPress={handleCopyToClipboard}
                disabled={actionsDisabled}
                className={`flex-1 rounded-xl py-3 items-center flex-row justify-center mr-3 ${
                  actionsDisabled ? 'bg-gray-200' : 'bg-gray-100'
                }`}
              >
                <Ionicons
                  name="copy-outline"
                  size={18}
                  color={actionsDisabled ? colors.gray[400] : colors.gray[700]}
                />
                <Text className={`font-semibold ml-2 ${actionsDisabled ? 'text-gray-400' : 'text-gray-700'}`}>
                  Copy to Clipboard
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleShareOrder}
                disabled={actionsDisabled}
                className={`flex-1 rounded-xl py-3 items-center flex-row justify-center ${
                  actionsDisabled ? 'bg-gray-200' : 'bg-primary-500'
                }`}
              >
                <Ionicons
                  name="share-social-outline"
                  size={18}
                  color={actionsDisabled ? colors.gray[400] : 'white'}
                />
                <Text className={`font-semibold ml-2 ${actionsDisabled ? 'text-gray-400' : 'text-white'}`}>
                  Share
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleShareOrder}
              disabled={actionsDisabled}
              className={`rounded-xl py-3 items-center flex-row justify-center ${
                actionsDisabled ? 'bg-gray-200' : 'bg-primary-500'
              }`}
            >
              <Ionicons
                name={isFinalizing ? 'hourglass-outline' : 'share-social-outline'}
                size={18}
                color={actionsDisabled ? colors.gray[400] : 'white'}
              />
              <Text className={`font-semibold ml-2 ${actionsDisabled ? 'text-gray-400' : 'text-white'}`}>
                {isFinalizing ? 'Sending...' : 'Share'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <OrderLaterScheduleModal
          visible={Boolean(orderLaterRegularItem || orderLaterRemainingItem)}
          title="Order Later"
          subtitle="Choose when this item should be ordered."
          confirmLabel="Move Item"
          onClose={() => setOrderLaterTarget(null)}
          onConfirm={handleMoveTargetToOrderLater}
        />
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
