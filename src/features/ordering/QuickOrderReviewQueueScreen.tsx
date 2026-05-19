import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { GlassSurface, StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { supabase } from '@/lib/supabase';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';

type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'not_required';
type UnitType = 'base' | 'pack';

type InventoryOption = {
  id: string;
  name: string;
  base_unit: string | null;
  pack_unit: string | null;
  category: string | null;
};

type ReviewOrderItem = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit_type: UnitType;
  input_mode: string | null;
  note: string | null;
  inventory_item?: InventoryOption | null;
};

type QuickOrderSession = {
  id: string;
  messages: Record<string, unknown>[];
  parsed_items: Record<string, unknown>[];
};

type ReviewOrder = {
  id: string;
  order_number: number | null;
  user_id: string | null;
  location_id: string | null;
  status: string;
  created_at: string;
  entry_method: string | null;
  quick_session_id: string | null;
  manager_review_status: ReviewStatus | null;
  manager_review_notes: string | null;
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } | null;
  location?: {
    id: string;
    name?: string | null;
    short_code?: string | null;
  } | null;
  order_items?: ReviewOrderItem[];
  quick_session?: QuickOrderSession | null;
};

type EditLine = {
  id: string;
  inventory_item_id: string;
  item_name: string;
  search: string;
  quantity: string;
  unit_type: UnitType;
  original_inventory_item_id: string;
  original_quantity: number;
  original_unit_type: UnitType;
  raw_token: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getUserName(order: ReviewOrder) {
  return order.user?.name || order.user?.email || 'Unknown employee';
}

function getLocationName(order: ReviewOrder) {
  return order.location?.name || order.location?.short_code || 'Unknown location';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getUnitLabel(item: ReviewOrderItem) {
  const inventory = item.inventory_item;
  if (item.unit_type === 'pack') {
    return inventory?.pack_unit || 'pack';
  }
  return inventory?.base_unit || 'unit';
}

function getMessageRole(message: Record<string, unknown>) {
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : 'user';
  return role === 'assistant' || role === 'error' ? role : 'user';
}

function getMessageText(message: Record<string, unknown>) {
  for (const key of ['text', 'raw_text', 'reply_text', 'content']) {
    const value = message[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return JSON.stringify(message);
}

function getOrderItems(order: ReviewOrder) {
  return Array.isArray(order.order_items) ? order.order_items : [];
}

function getSessionParsedItems(order: ReviewOrder) {
  const parsedItems: Record<string, unknown>[] = [];

  if (Array.isArray(order.quick_session?.parsed_items)) {
    parsedItems.push(...order.quick_session.parsed_items);
  }

  if (Array.isArray(order.quick_session?.messages)) {
    for (const message of order.quick_session.messages) {
      const messageItems = message.parsed_items;
      if (Array.isArray(messageItems)) {
        parsedItems.push(
          ...messageItems.filter((entry): entry is Record<string, unknown> =>
            Boolean(entry && typeof entry === 'object'),
          ),
        );
      }
    }
  }

  return parsedItems;
}

function getRawTokenForOrderItem(order: ReviewOrder, item: ReviewOrderItem) {
  const match = getSessionParsedItems(order).find((parsedItem) => {
    const parsedItemId = parsedItem.item_id;
    return typeof parsedItemId === 'string' && parsedItemId === item.inventory_item_id;
  });

  const rawToken = match?.raw_token;
  if (typeof rawToken === 'string' && rawToken.trim()) {
    return rawToken.trim();
  }

  const itemName = match?.item_name;
  if (typeof itemName === 'string' && itemName.trim()) {
    return itemName.trim();
  }

  return item.inventory_item?.name || 'unknown';
}

function buildEditLines(order: ReviewOrder): EditLine[] {
  return getOrderItems(order).map((item) => {
    const name = item.inventory_item?.name || 'Unknown item';
    const unitType = item.unit_type === 'pack' ? 'pack' : 'base';
    const quantity = toNumber(item.quantity, 0);
    return {
      id: item.id,
      inventory_item_id: item.inventory_item_id,
      item_name: name,
      search: name,
      quantity: String(quantity),
      unit_type: unitType,
      original_inventory_item_id: item.inventory_item_id,
      original_quantity: quantity,
      original_unit_type: unitType,
      raw_token: getRawTokenForOrderItem(order, item),
    };
  });
}

export function QuickOrderReviewQueueScreen() {
  const ds = useScaledStyles();
  const manager = useAuthStore((state) => state.user);
  const [orders, setOrders] = useState<ReviewOrder[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [editOrder, setEditOrder] = useState<ReviewOrder | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [activeEditLineId, setActiveEditLineId] = useState<string | null>(null);
  const [rejectOrder, setRejectOrder] = useState<ReviewOrder | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inventoryById = useMemo(() => {
    const map = new Map<string, InventoryOption>();
    inventory.forEach((item) => map.set(item.id, item));
    return map;
  }, [inventory]);

  const fetchReviewQueue = useCallback(async () => {
    setErrorMessage(null);

    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        user_id,
        location_id,
        status,
        created_at,
        entry_method,
        quick_session_id,
        manager_review_status,
        manager_review_notes,
        user:users!orders_user_id_fkey(id,name,email),
        location:locations(id,name,short_code),
        order_items(
          id,
          inventory_item_id,
          quantity,
          unit_type,
          input_mode,
          note,
          inventory_item:inventory_items(id,name,base_unit,pack_unit,category)
        )
      `)
      .or('manager_review_status.is.null,manager_review_status.eq.pending')
      .or('entry_method.eq.quick_order,quick_session_id.not.is.null')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    const nextOrders = (data ?? []) as ReviewOrder[];
    const sessionIds = Array.from(
      new Set(
        nextOrders
          .map((order) => order.quick_session_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    let sessionsById = new Map<string, QuickOrderSession>();
    if (sessionIds.length > 0) {
      const { data: sessions, error: sessionsError } = await supabase
        .from('quick_order_sessions')
        .select('id,messages,parsed_items')
        .in('id', sessionIds);

      if (sessionsError) throw sessionsError;
      sessionsById = new Map(
        ((sessions ?? []) as QuickOrderSession[]).map((session) => [session.id, session]),
      );
    }

    setOrders(
      nextOrders.map((order) => ({
        ...order,
        quick_session: order.quick_session_id
          ? sessionsById.get(order.quick_session_id) ?? null
          : null,
      })),
    );
  }, []);

  const fetchInventory = useCallback(async () => {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id,name,base_unit,pack_unit,category')
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(1000);

    if (error) throw error;
    setInventory((data ?? []) as InventoryOption[]);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      await Promise.all([fetchReviewQueue(), fetchInventory()]);
    } catch (error: any) {
      setErrorMessage(error?.message || 'Unable to load pending Quick Order reviews.');
    } finally {
      setIsLoading(false);
    }
  }, [fetchInventory, fetchReviewQueue]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const { refreshing, onRefresh } = useManagedRefresh(loadData);

  const approveOrder = useCallback(
    async (order: ReviewOrder) => {
      if (!manager?.id) {
        Alert.alert('Manager required', 'Sign in as a manager to approve orders.');
        return;
      }

      try {
        setActionOrderId(order.id);
        const { error } = await supabase
          .from('orders')
          .update({
            status: 'submitted',
            manager_review_status: 'approved',
            manager_review_notes: null,
            manager_reviewed_at: new Date().toISOString(),
            manager_reviewed_by: manager.id,
          })
          .eq('id', order.id);

        if (error) throw error;
        await loadData();
      } catch (error: any) {
        Alert.alert('Approval failed', error?.message || 'Unable to approve this order.');
      } finally {
        setActionOrderId(null);
      }
    },
    [loadData, manager?.id],
  );

  const openEditModal = useCallback((order: ReviewOrder) => {
    setEditOrder(order);
    setEditLines(buildEditLines(order));
    setActiveEditLineId(null);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditOrder(null);
    setEditLines([]);
    setActiveEditLineId(null);
  }, []);

  const saveEditsAndApprove = useCallback(async () => {
    if (!editOrder || !manager?.id) return;

    if (!isUuid(manager.id)) {
      Alert.alert('Manager required', 'Sign in again before saving review corrections.');
      return;
    }

    const invalidLine = editLines.find((line) => {
      const quantity = Number(line.quantity);
      return !line.inventory_item_id || !Number.isFinite(quantity) || quantity <= 0;
    });

    if (invalidLine) {
      Alert.alert('Check edits', 'Every item needs a selected inventory item and positive quantity.');
      return;
    }

    try {
      setActionOrderId(editOrder.id);

      for (const line of editLines) {
        const { error } = await supabase
          .from('order_items')
          .update({
            inventory_item_id: line.inventory_item_id,
            quantity: Number(line.quantity),
            unit_type: line.unit_type,
            input_mode: 'quantity',
            quantity_requested: Number(line.quantity),
            remaining_reported: null,
            decided_quantity: null,
            decided_by: null,
            decided_at: null,
          })
          .eq('id', line.id);

        if (error) throw error;
      }

      const correctionRows = editLines
        .filter((line) => {
          const quantity = Number(line.quantity);
          return (
            line.inventory_item_id !== line.original_inventory_item_id ||
            quantity !== line.original_quantity ||
            line.unit_type !== line.original_unit_type
          );
        })
        .filter((line) => isUuid(line.inventory_item_id) && line.raw_token.trim())
        .map((line) => ({
          session_id: isUuid(editOrder.quick_session_id) ? editOrder.quick_session_id : null,
          user_id: manager.id,
          raw_token: line.raw_token.trim(),
          parser_suggested_item_id: isUuid(line.original_inventory_item_id)
            ? line.original_inventory_item_id
            : null,
          user_corrected_item_id: line.inventory_item_id,
          user_corrected_qty: Number(line.quantity),
          user_corrected_unit: line.unit_type,
        }));

      if (correctionRows.length > 0) {
        const { error: correctionsError } = await supabase
          .from('parser_corrections')
          .insert(correctionRows);

        if (correctionsError) throw correctionsError;
      }

      const { error: orderError } = await supabase
        .from('orders')
        .update({
          status: 'submitted',
          manager_review_status: 'approved',
          manager_review_notes: 'Edited during manager review.',
          manager_reviewed_at: new Date().toISOString(),
          manager_reviewed_by: manager.id,
        })
        .eq('id', editOrder.id);

      if (orderError) throw orderError;

      closeEditModal();
      await loadData();
    } catch (error: any) {
      Alert.alert('Edit approval failed', error?.message || 'Unable to save edits.');
    } finally {
      setActionOrderId(null);
    }
  }, [closeEditModal, editLines, editOrder, loadData, manager?.id]);

  const openRejectModal = useCallback((order: ReviewOrder) => {
    setRejectOrder(order);
    setRejectNote('');
  }, []);

  const closeRejectModal = useCallback(() => {
    setRejectOrder(null);
    setRejectNote('');
  }, []);

  const rejectWithNote = useCallback(async () => {
    if (!rejectOrder || !manager?.id) return;

    const note = rejectNote.trim();
    if (!note) {
      Alert.alert('Note required', 'Add a note so the employee knows what to fix.');
      return;
    }

    try {
      setActionOrderId(rejectOrder.id);
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          manager_review_status: 'rejected',
          manager_review_notes: note,
          manager_reviewed_at: new Date().toISOString(),
          manager_reviewed_by: manager.id,
        })
        .eq('id', rejectOrder.id);

      if (error) throw error;

      if (rejectOrder.user_id) {
        const { error: notificationError } = await supabase.from('notifications').insert({
          user_id: rejectOrder.user_id,
          title: 'Quick Order needs changes',
          body: note,
          notification_type: 'quick_order_review_rejected',
          payload: {
            order_id: rejectOrder.id,
            quick_session_id: rejectOrder.quick_session_id,
            manager_review_status: 'rejected',
          },
        });

        if (notificationError) {
          console.warn('[QuickOrderReview] Unable to create rejection notification:', notificationError);
        }
      }

      closeRejectModal();
      await loadData();
    } catch (error: any) {
      Alert.alert('Reject failed', error?.message || 'Unable to reject this order.');
    } finally {
      setActionOrderId(null);
    }
  }, [closeRejectModal, loadData, manager?.id, rejectNote, rejectOrder]);

  const updateEditLine = useCallback((lineId: string, patch: Partial<EditLine>) => {
    setEditLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    );
  }, []);

  const getInventoryMatches = useCallback(
    (query: string) => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return [];
      return inventory
        .filter((item) => item.name.toLowerCase().includes(normalized))
        .slice(0, 6);
    },
    [inventory],
  );

  const renderOrderItem = (item: ReviewOrderItem) => (
    <View key={item.id} style={[styles.itemRow, { paddingVertical: ds.spacing(8) }]}>
      <Ionicons name="checkmark-circle-outline" size={20} color="#18A957" />
      <View style={{ flex: 1, marginLeft: ds.spacing(10) }}>
        <Text style={[styles.itemName, { fontSize: ds.fontSize(15) }]}>
          {item.inventory_item?.name || 'Unknown item'}
        </Text>
        <Text style={[styles.itemMeta, { fontSize: ds.fontSize(12) }]}>
          {toNumber(item.quantity)} {getUnitLabel(item)}
          {item.note ? ` · ${item.note}` : ''}
        </Text>
      </View>
    </View>
  );

  const renderTranscript = (order: ReviewOrder) => {
    const messages = Array.isArray(order.quick_session?.messages)
      ? order.quick_session.messages
      : [];

    if (messages.length === 0) {
      return (
        <Text style={[styles.emptyText, { fontSize: ds.fontSize(13) }]}>
          No chat transcript was saved for this order.
        </Text>
      );
    }

    return messages.map((message, index) => {
      const role = getMessageRole(message);
      const isUser = role === 'user';
      return (
        <View
          key={`${order.id}-message-${index}`}
          style={[
            styles.transcriptBubble,
            {
              alignSelf: isUser ? 'flex-end' : 'flex-start',
              backgroundColor: isUser ? colors.primary : colors.white,
              borderRadius: ds.radius(14),
              padding: ds.spacing(10),
              maxWidth: '88%',
            },
          ]}
        >
          <Text
            style={{
              color: isUser ? colors.textOnPrimary : colors.textPrimary,
              fontSize: ds.fontSize(13),
              fontWeight: '700',
            }}
          >
            {getMessageText(message)}
          </Text>
        </View>
      );
    });
  };

  const renderOrderCard = (order: ReviewOrder) => {
    const orderItems = getOrderItems(order);
    const isBusy = actionOrderId === order.id;

    return (
      <GlassSurface
        key={order.id}
        intensity="subtle"
        blurred={false}
        style={{
          borderRadius: glassRadii.surface,
          padding: ds.spacing(16),
          marginBottom: ds.spacing(14),
        }}
      >
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.orderTitle, { fontSize: ds.fontSize(20) }]}>
              Order #{order.order_number ?? order.id.slice(0, 8)}
            </Text>
            <Text style={[styles.metaText, { fontSize: ds.fontSize(13), marginTop: 4 }]}>
              {getUserName(order)} · {getLocationName(order)}
            </Text>
            <Text style={[styles.metaText, { fontSize: ds.fontSize(13), marginTop: 2 }]}>
              {formatDate(order.created_at)}
            </Text>
          </View>
          <View style={styles.pendingPill}>
            <Text style={[styles.pendingPillText, { fontSize: ds.fontSize(11) }]}>
              Pending
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { fontSize: ds.fontSize(15), marginTop: ds.spacing(16) }]}>
          Parsed Order
        </Text>
        <View style={{ marginTop: ds.spacing(6) }}>
          {orderItems.length > 0 ? (
            orderItems.map(renderOrderItem)
          ) : (
            <Text style={[styles.emptyText, { fontSize: ds.fontSize(13) }]}>
              No order items found.
            </Text>
          )}
        </View>

        <Text style={[styles.sectionTitle, { fontSize: ds.fontSize(15), marginTop: ds.spacing(16) }]}>
          Chat Context
        </Text>
        <View style={{ marginTop: ds.spacing(8), gap: ds.spacing(8) }}>
          {renderTranscript(order)}
        </View>

        <View style={[styles.actionsRow, { marginTop: ds.spacing(18), gap: ds.spacing(8) }]}>
          <TouchableOpacity
            onPress={() => void approveOrder(order)}
            disabled={isBusy}
            activeOpacity={0.82}
            style={[styles.actionButton, styles.approveButton, { opacity: isBusy ? 0.6 : 1 }]}
          >
            <Ionicons name="checkmark" size={18} color={colors.textOnPrimary} />
            <Text style={styles.primaryActionText}>Approve</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => openEditModal(order)}
            disabled={isBusy}
            activeOpacity={0.82}
            style={[styles.actionButton, styles.editButton, { opacity: isBusy ? 0.6 : 1 }]}
          >
            <Ionicons name="create-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.secondaryActionText}>Edit & Approve</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => openRejectModal(order)}
            disabled={isBusy}
            activeOpacity={0.82}
            style={[styles.actionButton, styles.rejectButton, { opacity: isBusy ? 0.6 : 1 }]}
          >
            <Ionicons name="close" size={18} color={colors.statusRed} />
            <Text style={styles.rejectActionText}>Reject</Text>
          </TouchableOpacity>
        </View>
      </GlassSurface>
    );
  };

  const renderEditModal = () => (
    <Modal
      visible={Boolean(editOrder)}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeEditModal}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }}>
        <View style={[styles.modalHeader, { padding: ds.spacing(16) }]}>
          <Text style={[styles.modalTitle, { fontSize: ds.fontSize(22) }]}>Edit & Approve</Text>
          <TouchableOpacity onPress={closeEditModal} style={styles.modalCloseButton}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: ds.spacing(40) }}
        >
          {editLines.map((line) => {
            const matches =
              activeEditLineId === line.id ? getInventoryMatches(line.search) : [];
            const selectedInventory = inventoryById.get(line.inventory_item_id);

            return (
              <GlassSurface
                key={line.id}
                intensity="subtle"
                blurred={false}
                style={{
                  borderRadius: glassRadii.surface,
                  padding: ds.spacing(12),
                  marginBottom: ds.spacing(12),
                }}
              >
                <Text style={[styles.inputLabel, { fontSize: ds.fontSize(12) }]}>Item</Text>
                <TextInput
                  value={line.search}
                  onFocus={() => setActiveEditLineId(line.id)}
                  onChangeText={(value) => {
                    updateEditLine(line.id, {
                      search: value,
                      inventory_item_id:
                        value === line.item_name ? line.inventory_item_id : '',
                    });
                    setActiveEditLineId(line.id);
                  }}
                  placeholder="Search item"
                  placeholderTextColor={glassColors.textMuted}
                  style={[styles.textInput, { fontSize: ds.fontSize(15), minHeight: ds.spacing(46) }]}
                />

                {matches.length > 0 ? (
                  <View style={{ marginTop: ds.spacing(8), gap: ds.spacing(6) }}>
                    {matches.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => {
                          updateEditLine(line.id, {
                            inventory_item_id: item.id,
                            item_name: item.name,
                            search: item.name,
                          });
                          setActiveEditLineId(null);
                        }}
                        style={({ pressed }) => [
                          styles.matchRow,
                          { backgroundColor: pressed ? colors.primaryPale : colors.white },
                        ]}
                      >
                        <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>
                          {item.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <Text style={[styles.selectedHint, { fontSize: ds.fontSize(12) }]}>
                  Selected: {selectedInventory?.name || 'None'}
                </Text>

                <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(10) }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { fontSize: ds.fontSize(12) }]}>Quantity</Text>
                    <TextInput
                      value={line.quantity}
                      onChangeText={(value) =>
                        updateEditLine(line.id, { quantity: value.replace(/[^0-9.]/g, '') })
                      }
                      keyboardType="decimal-pad"
                      placeholder="Qty"
                      placeholderTextColor={glassColors.textMuted}
                      style={[styles.textInput, { fontSize: ds.fontSize(15), minHeight: ds.spacing(46) }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { fontSize: ds.fontSize(12) }]}>Unit</Text>
                    <View style={styles.unitSwitch}>
                      {(['base', 'pack'] as UnitType[]).map((unitType) => (
                        <Pressable
                          key={unitType}
                          onPress={() => updateEditLine(line.id, { unit_type: unitType })}
                          style={[
                            styles.unitButton,
                            line.unit_type === unitType && styles.unitButtonActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.unitButtonText,
                              line.unit_type === unitType && styles.unitButtonTextActive,
                            ]}
                          >
                            {unitType}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              </GlassSurface>
            );
          })}
        </ScrollView>

        <View style={[styles.modalFooter, { padding: ds.spacing(16) }]}>
          <TouchableOpacity
            onPress={closeEditModal}
            activeOpacity={0.82}
            style={[styles.footerButton, styles.footerSecondaryButton]}
          >
            <Text style={styles.secondaryActionText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void saveEditsAndApprove()}
            disabled={actionOrderId === editOrder?.id}
            activeOpacity={0.82}
            style={[
              styles.footerButton,
              styles.approveButton,
              { opacity: actionOrderId === editOrder?.id ? 0.6 : 1 },
            ]}
          >
            <Text style={styles.primaryActionText}>Save & Approve</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );

  const renderRejectModal = () => (
    <Modal
      visible={Boolean(rejectOrder)}
      animationType="fade"
      transparent
      onRequestClose={closeRejectModal}
    >
      <View style={styles.rejectOverlay}>
        <GlassSurface
          intensity="strong"
          blurred={false}
          style={{
            borderRadius: glassRadii.surface,
            padding: ds.spacing(16),
            marginHorizontal: ds.spacing(20),
          }}
        >
          <Text style={[styles.modalTitle, { fontSize: ds.fontSize(20) }]}>
            Reject with note
          </Text>
          <Text style={[styles.metaText, { fontSize: ds.fontSize(13), marginTop: ds.spacing(6) }]}>
            This cancels the order and notifies the employee.
          </Text>
          <TextInput
            value={rejectNote}
            onChangeText={setRejectNote}
            multiline
            placeholder="What needs to be fixed?"
            placeholderTextColor={glassColors.textMuted}
            style={[
              styles.textInput,
              {
                minHeight: ds.spacing(110),
                textAlignVertical: 'top',
                marginTop: ds.spacing(14),
                fontSize: ds.fontSize(15),
              },
            ]}
          />
          <View style={[styles.actionsRow, { gap: ds.spacing(8), marginTop: ds.spacing(14) }]}>
            <TouchableOpacity
              onPress={closeRejectModal}
              activeOpacity={0.82}
              style={[styles.footerButton, styles.footerSecondaryButton]}
            >
              <Text style={styles.secondaryActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void rejectWithNote()}
              disabled={actionOrderId === rejectOrder?.id}
              activeOpacity={0.82}
              style={[
                styles.footerButton,
                styles.rejectSolidButton,
                { opacity: actionOrderId === rejectOrder?.id ? 0.6 : 1 },
              ]}
            >
              <Text style={styles.primaryActionText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );

  if (manager?.role !== 'manager') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }}>
        <StackScreenHeader title="Pending Review" subtitle="Manager access required" />
        <View style={{ padding: glassSpacing.screen }}>
          <Text style={{ color: glassColors.textSecondary }}>
            Only managers can review Quick Order safety queue items.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <StackScreenHeader
          title="Pending Review"
          subtitle="Quick Order safety queue"
          onBackPress={() => router.replace('/(manager)/orders')}
        />

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            contentContainerStyle={{
              paddingHorizontal: glassSpacing.screen,
              paddingBottom: glassTabBarHeight + ds.spacing(32),
            }}
            showsVerticalScrollIndicator={false}
          >
            {errorMessage ? (
              <GlassSurface
                intensity="subtle"
                blurred={false}
                style={{
                  borderRadius: glassRadii.surface,
                  padding: ds.spacing(14),
                  marginBottom: ds.spacing(14),
                  backgroundColor: colors.statusRedBg,
                }}
              >
                <Text style={{ color: colors.statusRed, fontWeight: '700' }}>
                  {errorMessage}
                </Text>
              </GlassSurface>
            ) : null}

            {orders.length > 0 ? (
              orders.map(renderOrderCard)
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle-outline" size={48} color={colors.statusGreen} />
                <Text style={[styles.emptyTitle, { fontSize: ds.fontSize(18) }]}>
                  No pending reviews
                </Text>
                <Text style={[styles.emptyText, { fontSize: ds.fontSize(13), marginTop: ds.spacing(6) }]}>
                  Quick Order drafts that need manager approval will appear here.
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </ManagerScaleContainer>

      {renderEditModal()}
      {renderRejectModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  orderTitle: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  metaText: {
    color: colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 0,
  },
  pendingPill: {
    borderRadius: 999,
    backgroundColor: colors.tagAmberBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pendingPillText: {
    color: colors.tagAmber,
    fontWeight: '800',
    letterSpacing: 0,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: glassHairlineWidth,
    borderTopColor: glassColors.cardBorder,
  },
  itemName: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  itemMeta: {
    color: colors.textSecondary,
    fontWeight: '600',
    letterSpacing: 0,
    marginTop: 2,
  },
  transcriptBubble: {
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  actionsRow: {
    flexDirection: 'row',
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  approveButton: {
    backgroundColor: colors.primary,
  },
  editButton: {
    backgroundColor: colors.glassCircle,
  },
  rejectButton: {
    backgroundColor: colors.statusRedBg,
  },
  rejectSolidButton: {
    backgroundColor: colors.statusRed,
  },
  primaryActionText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    marginLeft: 6,
    letterSpacing: 0,
  },
  secondaryActionText: {
    color: colors.textPrimary,
    fontWeight: '800',
    marginLeft: 6,
    letterSpacing: 0,
  },
  rejectActionText: {
    color: colors.statusRed,
    fontWeight: '800',
    marginLeft: 6,
    letterSpacing: 0,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 72,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontWeight: '800',
    marginTop: 12,
    letterSpacing: 0,
  },
  emptyText: {
    color: colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: glassHairlineWidth,
    borderBottomColor: glassColors.cardBorder,
  },
  modalTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  modalCloseButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputLabel: {
    color: colors.textSecondary,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  textInput: {
    borderRadius: glassRadii.search,
    borderWidth: 1,
    borderColor: glassColors.cardBorder,
    backgroundColor: colors.white,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  selectedHint: {
    color: colors.textSecondary,
    marginTop: 8,
    fontWeight: '600',
    letterSpacing: 0,
  },
  matchRow: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  unitSwitch: {
    flexDirection: 'row',
    borderRadius: glassRadii.pill,
    backgroundColor: colors.glassCircle,
    padding: 4,
    minHeight: 46,
  },
  unitButton: {
    flex: 1,
    borderRadius: glassRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: {
    backgroundColor: colors.primary,
  },
  unitButtonText: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  unitButtonTextActive: {
    color: colors.textOnPrimary,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: glassHairlineWidth,
    borderTopColor: glassColors.cardBorder,
  },
  footerButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: glassRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerSecondaryButton: {
    backgroundColor: colors.glassCircle,
  },
  rejectOverlay: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
});
