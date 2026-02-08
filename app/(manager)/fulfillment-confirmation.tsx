import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SUPPLIER_CATEGORY_LABELS, colors } from '@/constants';
import { useAuthStore, useOrderStore, useSettingsStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { getInventoryWithStock } from '@/lib/api/stock';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';

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
  contributors: ConfirmationContributor[];
  notes: ConfirmationNote[];
  details: ConfirmationDetail[];
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
}

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

export default function FulfillmentConfirmationScreen() {
  const params = useLocalSearchParams<{ items?: string; supplier?: string; remaining?: string }>();
  const { user } = useAuthStore();
  const { exportFormat } = useSettingsStore();

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
  const [targetByItemKey, setTargetByItemKey] = useState<Record<string, number>>({});
  const [loadingTargets, setLoadingTargets] = useState(false);

  const supplierParam = Array.isArray(params.supplier) ? params.supplier[0] : params.supplier;
  const supplierLabel = supplierParam
    ? SUPPLIER_CATEGORY_LABELS[supplierParam as keyof typeof SUPPLIER_CATEGORY_LABELS]
    : 'Supplier';

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

  const remainingTargetSignature = useMemo(() => {
    return Array.from(new Set(remainingItems.map((item) => item.locationId))).sort().join('|');
  }, [remainingItems]);

  useEffect(() => {
    let isActive = true;

    const loadTargets = async () => {
      const locationIds = remainingTargetSignature.length > 0 ? remainingTargetSignature.split('|') : [];
      if (locationIds.length === 0) {
        if (isActive) {
          setTargetByItemKey({});
          setLoadingTargets(false);
        }
        return;
      }

      setLoadingTargets(true);
      const nextTargets: Record<string, number> = {};

      await Promise.all(
        locationIds.map(async (locationId) => {
          try {
            const rows = await getInventoryWithStock(locationId);
            rows.forEach((row) => {
              const target = row.max_quantity > 0 ? row.max_quantity : row.min_quantity > 0 ? row.min_quantity : 0;
              if (target > 0) {
                nextTargets[`${locationId}:${row.inventory_item.id}`] = target;
              }
            });
          } catch {
            // Ignore stock target fetch failures. Suggestions are optional.
          }
        })
      );

      if (isActive) {
        setTargetByItemKey(nextTargets);
        setLoadingTargets(false);
      }
    };

    void loadTargets();

    return () => {
      isActive = false;
    };
  }, [remainingTargetSignature]);

  const getSuggestion = useCallback(
    (item: RemainingConfirmationItem) => {
      const target = targetByItemKey[`${item.locationId}:${item.inventoryItemId}`];
      if (!Number.isFinite(target) || target <= 0) return null;
      return Math.max(0, target - item.reportedRemaining);
    },
    [targetByItemKey]
  );

  const suggestionCount = useMemo(() => {
    return remainingItems.filter((item) => getSuggestion(item) !== null).length;
  }, [getSuggestion, remainingItems]);

  const unresolvedRemainingItemIds = useMemo(() => {
    return remainingItems
      .filter((item) => item.decidedQuantity == null || !Number.isFinite(item.decidedQuantity))
      .map((item) => item.orderItemId);
  }, [remainingItems]);

  const hasMissingRemaining = unresolvedRemainingItemIds.length > 0;
  const hasAnyItems = items.length > 0 || remainingItems.length > 0;
  const actionsDisabled = !hasAnyItems || hasMissingRemaining || savingRemainingIds.size > 0;

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

  const formattedItems = useMemo(() => {
    const groupOrder: LocationGroup[] = ['sushi', 'poki'];
    const output = groupOrder
      .map((group) => {
        const lines: string[] = [];
        const regularItems = groupedItems[group] || [];
        const remainingRows = groupedRemainingItems[group] || [];

        regularItems.forEach((item) => {
          lines.push(`- ${item.name}: ${item.quantity} ${item.unitLabel}`);
        });

        remainingRows.forEach((item) => {
          const decidedQty =
            item.decidedQuantity == null || !Number.isFinite(item.decidedQuantity)
              ? '[set qty]'
              : `${item.decidedQuantity}`;
          lines.push(`- ${item.name}: ${decidedQty} ${item.unitLabel} (reported ${item.reportedRemaining})`);
        });

        if (lines.length === 0) return null;
        return `--- ${LOCATION_GROUP_LABELS[group].toUpperCase()} ---\n${lines.join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');

    return output.length > 0 ? output : 'No items to order.';
  }, [groupedItems, groupedRemainingItems]);

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

    return filled.replace(/\\n/g, '\n');
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

  const syncOrderStoreRegularRemoval = useCallback((orderItemIds: string[]) => {
    if (orderItemIds.length === 0) return;
    const idSet = new Set(orderItemIds);

    useOrderStore.setState((state: any) => {
      const patchOrder = (orderLike: any) => {
        if (!orderLike || !Array.isArray(orderLike.order_items)) return orderLike;

        let changed = false;
        const nextOrderItems = orderLike.order_items.map((orderItem: any) => {
          if (!idSet.has(orderItem?.id)) return orderItem;
          changed = true;
          return {
            ...orderItem,
            quantity: 0,
            quantity_requested: 0,
          };
        });

        return changed ? { ...orderLike, order_items: nextOrderItems } : orderLike;
      };

      return {
        orders: Array.isArray(state.orders) ? state.orders.map((order: any) => patchOrder(order)) : state.orders,
        currentOrder: patchOrder(state.currentOrder),
      };
    });
  }, []);

  const persistRegularRemoval = useCallback(
    async (orderItemIds: string[]) => {
      if (orderItemIds.length === 0) return true;

      try {
        const { error } = await (supabase as any)
          .from('order_items')
          .update({
            quantity: 0,
            quantity_requested: 0,
          })
          .in('id', orderItemIds);

        if (error) throw error;

        syncOrderStoreRegularRemoval(orderItemIds);
        return true;
      } catch (error: any) {
        Alert.alert('Unable to Remove Item', error?.message || 'Please try again.');
        return false;
      }
    },
    [syncOrderStoreRegularRemoval]
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
    [persistRegularRemoval]
  );

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
    },
    [handleDelete]
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
  }, []);

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
    const candidates = remainingItems
      .map((item) => ({ item, suggestion: getSuggestion(item) }))
      .filter(
        (entry): entry is { item: RemainingConfirmationItem; suggestion: number } =>
          entry.suggestion != null && Number.isFinite(entry.suggestion)
      );

    if (candidates.length === 0) {
      Alert.alert('No Suggestions Available', 'No stock targets are available for these remaining items.');
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
  }, [getSuggestion, persistRemainingDecision, remainingItems, setRemainingDecisionLocal]);

  const handleCopyToClipboard = useCallback(async () => {
    if (actionsDisabled) {
      Alert.alert('Decision Required', 'Set final quantities for all remaining items before copying.');
      return;
    }

    await Clipboard.setStringAsync(messageText);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert('Copied!', 'Order message copied to clipboard');
  }, [actionsDisabled, messageText]);

  const handleShare = useCallback(async () => {
    if (actionsDisabled) {
      Alert.alert('Decision Required', 'Set final quantities for all remaining items before sending.');
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      const result = await Share.share({
        message: messageText,
        title: `${supplierLabel} Order`,
      });

      if (result.action === Share.sharedAction) {
        Alert.alert('Shared!', 'Order has been shared');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to share');
    }
  }, [actionsDisabled, messageText, supplierLabel]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right', 'bottom']}>
      <ManagerScaleContainer>
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <TouchableOpacity
              onPress={() => router.back()}
              className="p-2 mr-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
            </TouchableOpacity>
            <View>
              <Text className="text-lg font-bold text-gray-900">Send Order</Text>
              <Text className="text-xs text-gray-500">{supplierLabel}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => router.push('/(manager)/settings/export-format')} className="p-2">
            <Ionicons name="create-outline" size={18} color={colors.gray[600]} />
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          {remainingItems.length > 0 && (
            <View className="bg-white rounded-2xl border border-amber-200 p-4 mb-4">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-2">
                  <View className="flex-row items-center">
                    <Ionicons name="alert-circle-outline" size={16} color="#B45309" />
                    <Text className="ml-2 text-sm font-bold text-amber-900">Remaining Items (Required)</Text>
                  </View>
                  <Text className="text-xs text-amber-700 mt-1">
                    Set a final order quantity for each remaining-mode item before Copy/Share is enabled.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleAutoFillSuggestions}
                  disabled={suggestionCount === 0 || loadingTargets || savingRemainingIds.size > 0}
                  className={`px-3 py-2 rounded-lg ${
                    suggestionCount === 0 || loadingTargets || savingRemainingIds.size > 0
                      ? 'bg-amber-100'
                      : 'bg-amber-200'
                  }`}
                >
                  <Text className="text-xs font-semibold text-amber-900">Auto-fill</Text>
                </TouchableOpacity>
              </View>

              {hasMissingRemaining && (
                <View className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <Text className="text-xs font-medium text-red-700">
                    {unresolvedRemainingItemIds.length} remaining item
                    {unresolvedRemainingItemIds.length === 1 ? '' : 's'} still need a final quantity.
                  </Text>
                </View>
              )}

              <View className="mt-3">
                {(['sushi', 'poki'] as LocationGroup[]).map((group) => {
                  const rows = groupedRemainingItems[group];
                  if (!rows || rows.length === 0) return null;

                  return (
                    <View key={`remaining-${group}`} className="mb-4 last:mb-0">
                      <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        {LOCATION_GROUP_LABELS[group]}
                      </Text>

                      {rows.map((item) => {
                        const isMissing = item.decidedQuantity == null || !Number.isFinite(item.decidedQuantity);
                        const suggested = getSuggestion(item);
                        const isSaving = savingRemainingIds.has(item.orderItemId);

                        return (
                          <View key={item.orderItemId} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 mb-2 last:mb-0">
                            <View className="flex-row items-start justify-between">
                              <View className="flex-1 pr-2">
                                <Text className="text-sm font-semibold text-gray-900">{item.name}</Text>
                                <Text className="text-xs text-gray-500 mt-1">
                                  {item.locationName} ({item.shortCode}) • Ordered by {item.orderedBy}
                                </Text>
                                <View className="flex-row items-center mt-1.5">
                                  <View className="px-1.5 py-0.5 rounded-full bg-amber-100">
                                    <Text className="text-[10px] font-semibold text-amber-700">Remaining</Text>
                                  </View>
                                  <Text className="ml-2 text-xs text-amber-700">
                                    Reported: {item.reportedRemaining} {item.unitLabel}
                                  </Text>
                                </View>
                                {item.note && (
                                  <Text className="text-xs text-blue-700 mt-1.5">Note: {item.note}</Text>
                                )}
                              </View>
                            </View>

                            <View className="flex-row items-center mt-3">
                              <TouchableOpacity
                                onPress={() => {
                                  const current = item.decidedQuantity ?? 0;
                                  handleRemainingQuantityChange(item, Math.max(0, current - 1));
                                }}
                                className="w-9 h-9 rounded-lg bg-white border border-gray-200 items-center justify-center"
                              >
                                <Ionicons name="remove" size={16} color={colors.gray[600]} />
                              </TouchableOpacity>

                              <TextInput
                                value={item.decidedQuantity == null ? '' : `${item.decidedQuantity}`}
                                onChangeText={(text) => {
                                  const sanitized = text.replace(/[^0-9.]/g, '');
                                  if (sanitized.length === 0) {
                                    handleRemainingQuantityChange(item, null);
                                    return;
                                  }
                                  const parsed = Number(sanitized);
                                  if (!Number.isFinite(parsed) || parsed < 0) return;
                                  handleRemainingQuantityChange(item, parsed);
                                }}
                                keyboardType="decimal-pad"
                                placeholder="Set qty"
                                placeholderTextColor={colors.gray[400]}
                                className="mx-2 h-9 min-w-[84px] rounded-lg border border-gray-200 bg-white px-2 text-center text-sm font-semibold text-gray-900"
                              />

                              <TouchableOpacity
                                onPress={() => {
                                  const current = item.decidedQuantity ?? 0;
                                  handleRemainingQuantityChange(item, current + 1);
                                }}
                                className="w-9 h-9 rounded-lg bg-white border border-gray-200 items-center justify-center"
                              >
                                <Ionicons name="add" size={16} color={colors.gray[600]} />
                              </TouchableOpacity>

                              <Text className="text-xs text-gray-500 ml-2">{item.unitLabel}</Text>

                              {suggested != null && (
                                <TouchableOpacity
                                  onPress={() => handleRemainingQuantityChange(item, suggested)}
                                  className="ml-auto px-2.5 py-1.5 rounded-md bg-amber-100"
                                >
                                  <Text className="text-[11px] font-semibold text-amber-800">Use {suggested}</Text>
                                </TouchableOpacity>
                              )}
                            </View>

                            {isMissing && (
                              <Text className="text-[11px] text-red-600 mt-2">
                                Final order quantity is required before sending.
                              </Text>
                            )}
                            {isSaving && (
                              <Text className="text-[11px] text-gray-500 mt-1">Saving...</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Message Preview</Text>
              <TouchableOpacity
                onPress={() => router.push('/(manager)/settings/export-format')}
                className="flex-row items-center"
              >
                <Ionicons name="create-outline" size={14} color={colors.primary[500]} />
                <Text className="text-xs text-primary-600 font-semibold ml-1">Edit Format</Text>
              </TouchableOpacity>
            </View>
            <View className="bg-gray-50 rounded-xl p-3">
              <Text className="text-sm text-gray-800 leading-5">{messageText}</Text>
            </View>
          </View>

          {hasAnyItems ? (
            <>
              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Regular Items ({items.length})
              </Text>

              {items.length === 0 ? (
                <View className="items-center justify-center py-8 bg-white border border-gray-200 rounded-xl">
                  <Text className="text-gray-500 text-sm">No regular items in this supplier section</Text>
                </View>
              ) : (
                (['sushi', 'poki'] as LocationGroup[]).map((group) => {
                  const groupItems = groupedItems[group];
                  if (!groupItems || groupItems.length === 0) return null;
                  const label = LOCATION_GROUP_LABELS[group].toUpperCase();

                  return (
                    <View key={group} className="mb-6">
                      <View className="flex-row items-center mb-3">
                        <View className="flex-1 h-px bg-gray-200" />
                        <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest mx-3">
                          {label}
                        </Text>
                        <View className="flex-1 h-px bg-gray-200" />
                      </View>

                      {groupItems.map((item) => {
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

                        return (
                          <View key={item.id} className="bg-white rounded-2xl border border-gray-100 mb-4">
                            <View className="px-4 py-3">
                              <View className="flex-row items-start justify-between">
                                <View className="flex-1 pr-2">
                                  <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
                                    {item.name}
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  onPress={() => toggleExpand(item.id)}
                                  className="p-1"
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <Ionicons
                                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                    size={18}
                                    color={colors.gray[400]}
                                  />
                                </TouchableOpacity>
                              </View>

                              <View className="flex-row items-center mt-3">
                                <TouchableOpacity
                                  onPress={() => handleQuantityChange(item, item.quantity - 1)}
                                  className="w-9 h-9 rounded-lg bg-gray-100 items-center justify-center"
                                >
                                  <Ionicons name="remove" size={16} color={colors.gray[600]} />
                                </TouchableOpacity>

                                <TextInput
                                  value={formatQuantity(item.quantity)}
                                  onChangeText={(text) => {
                                    const sanitized = text.replace(/[^0-9.]/g, '');
                                    if (sanitized.length === 0) return;
                                    const parsed = Number(sanitized);
                                    if (!Number.isFinite(parsed)) return;
                                    handleQuantityChange(item, parsed);
                                  }}
                                  keyboardType="decimal-pad"
                                  className="mx-2 h-9 min-w-[84px] rounded-lg border border-gray-200 bg-white px-2 text-center text-sm font-semibold text-gray-900"
                                />

                                <TouchableOpacity
                                  onPress={() => handleQuantityChange(item, item.quantity + 1)}
                                  className="w-9 h-9 rounded-lg bg-gray-100 items-center justify-center"
                                >
                                  <Ionicons name="add" size={16} color={colors.gray[600]} />
                                </TouchableOpacity>

                                <Text className="text-xs text-gray-500 ml-2">{item.unitLabel}</Text>
                              </View>
                            </View>

                            {isExpanded && (
                              <View className="px-4 pb-4 border-t border-gray-100">
                                <View className="mt-3 bg-gray-50 rounded-xl p-3 border border-gray-200">
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

                                <TouchableOpacity
                                  onPress={() => handleDelete(item)}
                                  className="mt-3 flex-row items-center justify-center rounded-xl border border-red-200 bg-red-50 py-2.5"
                                >
                                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                                  <Text className="ml-2 text-sm font-semibold text-red-600">Delete item</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })
              )}
            </>
          ) : (
            <View className="items-center justify-center py-12">
              <Ionicons name="list-outline" size={48} color={colors.gray[300]} />
              <Text className="text-gray-500 text-base mt-3">No items to send</Text>
              <Text className="text-gray-400 text-sm mt-1">Return to fulfillment to select items</Text>
            </View>
          )}
        </ScrollView>

        <View className="bg-white border-t border-gray-200 px-4 py-4">
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
              onPress={handleShare}
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
        </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
