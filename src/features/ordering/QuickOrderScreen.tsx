import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTabBarBottomInset } from '@/components/navigation';
import { useResolvedActiveLocation } from '@/hooks/useResolvedActiveLocation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { supabase } from '@/lib/supabase';
import {
  submitOrder as submitOrderService,
  syncProfileAfterOrder,
  type OrderItemPayload,
} from '@/services/orderSubmission';
import { useAuthStore } from '@/store';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';
import { StockCheckHeader } from '@/features/stock-check/components/StockCheckHeader';
import type { Location } from '@/types';
import type { OrderingMode } from './types';

type ParsedQuickOrderItem = {
  item_id: string | null;
  item_name: string;
  raw_token?: string;
  quantity: number | null;
  unit: string | null;
  confidence?: number;
  needs_clarification?: boolean;
  unresolved?: boolean;
  notes?: string | null;
};

type QuickOrderFlag = {
  type: string;
  message: string;
  raw_token?: string;
  item_id?: string;
};

type QuickOrderSuggestion = {
  item_id: string;
  item_name: string;
  suggested_qty: number;
  unit: string | null;
  unit_type?: string | null;
  reason?: string | null;
  confidence?: number;
};

type ParseOrderResponse = {
  reply_text?: string;
  parsed_items?: ParsedQuickOrderItem[];
  flags?: QuickOrderFlag[];
  suggestions?: QuickOrderSuggestion[];
  session_state?: {
    total_items?: number;
    ready_to_submit?: boolean;
  };
  error?: string;
  detail?: string;
  code?: string;
};

type QuickOrderMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  createdAt: string;
  parsedItems?: ParsedQuickOrderItem[];
  flags?: QuickOrderFlag[];
  suggestions?: QuickOrderSuggestion[];
  errorCode?: string;
};

type QuickOrderInventoryItem = {
  id: string;
  name: string;
  base_unit: string | null;
  pack_unit: string | null;
};

type EditingParsedItem = {
  messageId: string;
  itemIndex: number;
  original: ParsedQuickOrderItem;
  itemId: string;
  itemSearch: string;
  quantity: string;
  unit: string;
  isSaving: boolean;
};

type PersistedQuickOrderMessage = {
  role?: string;
  text?: string;
  raw_text?: string;
  reply_text?: string;
  created_at?: string;
  parsed_items?: ParsedQuickOrderItem[];
  flags?: QuickOrderFlag[];
  suggestions?: QuickOrderSuggestion[];
};

type QuickOrderSessionRow = {
  id: string;
  messages?: PersistedQuickOrderMessage[];
  parsed_items?: ParsedQuickOrderItem[];
};

type QuickOrderScreenProps = {
  mode: OrderingMode;
};

const ERROR_MESSAGES: Record<string, string> = {
  feature_disabled: 'Quick Order is temporarily off — please use Browse.',
  rate_limit_user_daily: 'Daily limit reached. Switch to Browse or try tomorrow.',
  rate_limit_org_monthly: 'Monthly AI budget reached. Contact your manager.',
  ai_unavailable: 'Sorry, having trouble connecting.',
};
const DEFAULT_ERROR = 'Something went wrong.';

function getErrorMessage(code?: string): string {
  return (code && ERROR_MESSAGES[code]) || DEFAULT_ERROR;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (marker) => {
    const random = Math.floor(Math.random() * 16);
    const value = marker === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isUuid(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function formatQuantity(item: ParsedQuickOrderItem) {
  if (item.quantity == null || item.quantity <= 0) {
    return item.unit ? `pick quantity ${item.unit}` : 'pick quantity';
  }

  return item.unit ? `${item.quantity} ${item.unit}` : `${item.quantity} · pick unit`;
}

function getItemIssue(item: ParsedQuickOrderItem) {
  if (!item.item_id || item.unresolved) return 'choose item';
  if (item.quantity == null || item.quantity <= 0) return 'pick quantity';
  if (!item.unit) return 'what unit?';
  if (item.needs_clarification) return 'fix item';
  return null;
}

function getItemFixCta(item: ParsedQuickOrderItem) {
  return getItemIssue(item) ?? formatQuantity(item);
}

function normalizeParsedItems(value: unknown): ParsedQuickOrderItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry as ParsedQuickOrderItem : null))
    .filter((entry): entry is ParsedQuickOrderItem => Boolean(entry?.item_name));
}

function normalizeSuggestions(value: unknown): QuickOrderSuggestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry as QuickOrderSuggestion : null))
    .filter((entry): entry is QuickOrderSuggestion => Boolean(entry?.item_id && entry?.item_name));
}

function mapPersistedMessages(messages: PersistedQuickOrderMessage[]): QuickOrderMessage[] {
  return messages
    .map((message): QuickOrderMessage | null => {
      const role = message.role === 'assistant' || message.role === 'error' ? message.role : 'user';
      const text =
        typeof message.text === 'string'
          ? message.text
          : typeof message.raw_text === 'string'
            ? message.raw_text
            : typeof message.reply_text === 'string'
              ? message.reply_text
              : '';

      if (!text) return null;

      return {
        id: createMessageId(),
        role,
        text,
        createdAt: message.created_at ?? new Date().toISOString(),
        parsedItems: normalizeParsedItems(message.parsed_items),
        flags: Array.isArray(message.flags) ? message.flags : [],
        suggestions: normalizeSuggestions(message.suggestions),
      };
    })
    .filter((message): message is QuickOrderMessage => Boolean(message));
}

function mergeParsedItems(
  current: ParsedQuickOrderItem[],
  incoming: ParsedQuickOrderItem[],
) {
  const byId = new Map<string, ParsedQuickOrderItem>();
  const unresolved: ParsedQuickOrderItem[] = [];

  for (const item of [...current, ...incoming]) {
    if (item.item_id) {
      byId.set(item.item_id, item);
    } else {
      unresolved.push(item);
    }
  }

  return [...byId.values(), ...unresolved];
}

function getParsedItemKey(item: ParsedQuickOrderItem) {
  return item.item_id
    ? `id:${item.item_id}`
    : `raw:${item.raw_token ?? item.item_name}`.toLowerCase();
}

function replaceParsedItem(
  current: ParsedQuickOrderItem[],
  original: ParsedQuickOrderItem,
  replacement: ParsedQuickOrderItem,
) {
  const originalKey = getParsedItemKey(original);
  return mergeParsedItems(
    current.filter((item) => getParsedItemKey(item) !== originalKey),
    [replacement],
  );
}

function buildPersistedMessage(message: QuickOrderMessage): PersistedQuickOrderMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      reply_text: message.text,
      text: message.text,
      parsed_items: message.parsedItems ?? [],
      flags: message.flags ?? [],
      suggestions: message.suggestions ?? [],
      created_at: message.createdAt,
    };
  }

  return {
    role: message.role,
    raw_text: message.text,
    text: message.text,
    created_at: message.createdAt,
  };
}

function resolveQuickOrderUnitType(
  item: ParsedQuickOrderItem,
  inventoryById: Map<string, QuickOrderInventoryItem>,
): 'base' | 'pack' {
  const inventory = item.item_id ? inventoryById.get(item.item_id) : null;
  const unit = item.unit?.trim().toLowerCase();
  const packUnit = inventory?.pack_unit?.trim().toLowerCase();

  return unit && packUnit && unit === packUnit ? 'pack' : 'base';
}

function toOrderItemPayload(
  item: ParsedQuickOrderItem,
  inventoryById: Map<string, QuickOrderInventoryItem>,
): OrderItemPayload {
  return {
    inventory_item_id: item.item_id ?? '',
    quantity: item.quantity ?? 0,
    unit_type: resolveQuickOrderUnitType(item, inventoryById),
    input_mode: 'quantity',
    quantity_requested: item.quantity ?? null,
    remaining_reported: null,
    decided_quantity: item.quantity ?? null,
    decided_by: null,
    decided_at: null,
    note: item.notes ?? null,
  };
}

type QuickOrderCartSummaryProps = {
  parsedItems: ParsedQuickOrderItem[];
  issueCount: number;
  isSubmitting: boolean;
  onPressItem: (item: ParsedQuickOrderItem) => void;
  onConfirm: () => void;
};

function QuickOrderCartSummary({
  parsedItems,
  issueCount,
  isSubmitting,
  onPressItem,
  onConfirm,
}: QuickOrderCartSummaryProps) {
  const ds = useScaledStyles();
  const disabled = parsedItems.length === 0 || issueCount > 0 || isSubmitting;
  const statusColor = parsedItems.length === 0
    ? colors.textSecondary
    : issueCount > 0
      ? '#FF9500'
      : colors.statusGreen;

  return (
    <Animated.View
      layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
      style={[
        styles.cartSummary,
        {
          marginHorizontal: ds.spacing(24),
          borderRadius: ds.radius(24),
          padding: ds.spacing(20),
        },
      ]}
    >
      <View style={styles.cartSummaryHeader}>
        <Text style={[styles.cartSummaryTitle, { fontSize: ds.fontSize(18) }]}>
          Order List
        </Text>
        <Text style={[styles.cartSummaryMeta, { color: statusColor, fontSize: ds.fontSize(14) }]}>
          {parsedItems.length} item{parsedItems.length === 1 ? '' : 's'}{issueCount > 0 ? ` · ${issueCount} needs fix` : ''}
        </Text>
      </View>

      <View style={{ marginTop: ds.spacing(14) }}>
        {parsedItems.length === 0 ? (
          <Text style={[styles.cartEmptyText, { fontSize: ds.fontSize(15) }]}>
            Add items to build this order.
          </Text>
        ) : (
          parsedItems.map((item, index) => {
            const issue = getItemIssue(item);
            const key = `${item.item_id ?? item.raw_token ?? item.item_name}-${index}`;

            return (
              <Animated.View
                key={key}
                entering={FadeInDown.duration(220).easing(Easing.out(Easing.cubic))}
                layout={LinearTransition.duration(180)}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.item_name}`}
                  onPress={() => onPressItem(item)}
                  style={({ pressed }) => [
                    styles.cartSummaryItemRow,
                    {
                      minHeight: ds.spacing(42),
                      opacity: pressed ? 0.64 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={issue ? 'alert-circle-outline' : 'checkmark'}
                    size={19}
                    color={issue ? '#FF9500' : colors.statusGreen}
                  />
                  <Text
                    style={[styles.cartSummaryItemName, { fontSize: ds.fontSize(16) }]}
                    numberOfLines={1}
                  >
                    {item.item_name}
                  </Text>
                  <Text
                    style={[
                      styles.cartSummaryItemMeta,
                      {
                        color: issue ? '#FF9500' : colors.textSecondary,
                        fontSize: ds.fontSize(15),
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {issue ? getItemFixCta(item) : formatQuantity(item)}
                  </Text>
                </Pressable>
              </Animated.View>
            );
          })
        )}
      </View>

      <Animated.View layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={disabled ? 'Resolve items before confirming order' : 'Confirm order'}
          disabled={disabled}
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.confirmOrderButton,
            {
              minHeight: ds.spacing(50),
              borderRadius: ds.radius(25),
              marginTop: ds.spacing(18),
              backgroundColor: '#FBE1DC',
              opacity: pressed ? 0.86 : 1,
            },
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text
              style={[
                styles.confirmOrderText,
                {
                  color: colors.primary,
                  fontSize: ds.fontSize(17),
                },
              ]}
            >
              Confirm order  →
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

type AIResponsePillProps = {
  message: QuickOrderMessage;
};

function getAssistantPill(message: QuickOrderMessage) {
  const flags = message.flags ?? [];
  const items = message.parsedItems ?? [];
  const flaggedItem = items.find((item) => getItemIssue(item));
  const addedItem = items.find((item) => !getItemIssue(item));

  if (flags.length > 0 || flaggedItem) {
    const issue = flaggedItem ? getItemIssue(flaggedItem) : null;
    const text = flags[0]?.message
      ?? (flaggedItem && issue === 'pick quantity'
        ? `Pick quantity for ${flaggedItem.item_name}.`
        : flaggedItem
          ? `What unit for ${flaggedItem.item_name}?`
          : message.text);
    return {
      icon: 'alert-circle-outline' as const,
      color: '#FF9500',
      text,
    };
  }

  if (addedItem) {
    return {
      icon: 'checkmark' as const,
      color: colors.statusGreen,
      text: `Added ${addedItem.item_name} · ${formatQuantity(addedItem)}`,
    };
  }

  return {
    icon: 'checkmark' as const,
    color: colors.statusGreen,
    text: message.text,
  };
}

function AIResponsePill({ message }: AIResponsePillProps) {
  const ds = useScaledStyles();
  const pill = getAssistantPill(message);

  return (
    <Animated.View
      entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
      layout={LinearTransition.duration(180)}
      style={[
        styles.aiPill,
        {
          borderRadius: ds.radius(18),
          paddingHorizontal: ds.spacing(16),
          paddingVertical: ds.spacing(11),
          marginTop: ds.spacing(16),
        },
      ]}
    >
      <Ionicons name={pill.icon} size={17} color={pill.color} />
      <Text
        style={[styles.aiPillText, { fontSize: ds.fontSize(17) }]}
        numberOfLines={2}
      >
        {pill.text}
      </Text>
    </Animated.View>
  );
}

export function QuickOrderScreen({ mode: _mode }: QuickOrderScreenProps) {
  void _mode;
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const user = useAuthStore((state) => state.user);
  const allLocations = useAuthStore((state) => state.locations);
  const setAuthLocation = useAuthStore((state) => state.setLocation);
  const { location } = useResolvedActiveLocation();
  const tabBarHeight = 60 + getTabBarBottomInset(insets.bottom);
  const closedComposerOffset = tabBarHeight + ds.spacing(14);

  const [inputValue, setInputValue] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const [scrollBottomOffset, setScrollBottomOffset] = useState(closedComposerOffset);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuickOrderMessage[]>([]);
  const [parsedItems, setParsedItems] = useState<ParsedQuickOrderItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<QuickOrderInventoryItem[]>([]);
  const [editingItem, setEditingItem] = useState<EditingParsedItem | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const lastUserTextRef = useRef('');
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const composerBottomOffset = useSharedValue(closedComposerOffset);
  const userId = user?.id ?? null;
  const locationId = location?.id ?? null;

  const inventoryById = useMemo(() => {
    const map = new Map<string, QuickOrderInventoryItem>();
    inventoryItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [inventoryItems]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const moveComposer = (event: KeyboardEvent) => {
      const keyboardHeight = event.endCoordinates.height;
      const nextOffset =
        Platform.OS === 'ios'
          ? ds.spacing(8)
          : Math.max(keyboardHeight - insets.bottom, 0) + ds.spacing(8);

      composerBottomOffset.value = withTiming(nextOffset, {
        duration: event.duration ?? 240,
        easing: Easing.out(Easing.cubic),
      });
      setKeyboardVisible(true);
      setScrollBottomOffset(nextOffset);
    };

    const resetComposer = (event: KeyboardEvent) => {
      composerBottomOffset.value = withTiming(closedComposerOffset, {
        duration: event.duration ?? 220,
        easing: Easing.out(Easing.cubic),
      });
      setKeyboardVisible(false);
      setScrollBottomOffset(closedComposerOffset);
    };

    const showSubscription = Keyboard.addListener(showEvent, moveComposer);
    const hideSubscription = Keyboard.addListener(hideEvent, resetComposer);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [closedComposerOffset, composerBottomOffset, ds, insets.bottom]);

  useEffect(() => {
    if (!keyboardVisible) {
      composerBottomOffset.value = closedComposerOffset;
      setScrollBottomOffset(closedComposerOffset);
    }
  }, [closedComposerOffset, composerBottomOffset, keyboardVisible]);

  useEffect(() => {
    if (!userId || !locationId) {
      setSessionId(null);
      setMessages([]);
      setParsedItems([]);
      return;
    }

    let cancelled = false;

    async function loadActiveSession() {
      try {
        setIsLoadingSession(true);
        const { data, error } = await supabase
          .from('quick_order_sessions')
          .select('id, messages, parsed_items')
          .eq('user_id', userId)
          .eq('location_id', locationId)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        const row = data as QuickOrderSessionRow | null;
        setSessionId(row?.id ?? null);
        setMessages(Array.isArray(row?.messages) ? mapPersistedMessages(row.messages) : []);
        setParsedItems(normalizeParsedItems(row?.parsed_items));
      } catch (error) {
        console.warn('[QuickOrder] Failed to load active session:', error);
        if (!cancelled) {
          setSessionId(null);
          setMessages([]);
          setParsedItems([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSession(false);
        }
      }
    }

    void loadActiveSession();

    return () => {
      cancelled = true;
    };
  }, [locationId, userId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [isSending, messages.length]);

  useEffect(() => () => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
  }, []);

  const activeFlags = useMemo(() => (
    parsedItems.reduce<QuickOrderFlag[]>((flags, item) => {
        const issue = getItemIssue(item);
        if (!issue) return flags;

        flags.push({
          type: issue,
          message: `${item.item_name}: ${issue}`,
          raw_token: item.raw_token,
          item_id: item.item_id ?? undefined,
        });
        return flags;
      }, [])
  ), [parsedItems]);

  const chatContentStyle = useMemo(
    () => ({
      paddingBottom: composerHeight + scrollBottomOffset + ds.spacing(24),
    }),
    [composerHeight, ds, scrollBottomOffset],
  );

  const composerAnimatedStyle = useAnimatedStyle(() => ({
    bottom: composerBottomOffset.value,
  }));

  const persistSession = useCallback(
    async (nextSessionId: string, nextMessages: QuickOrderMessage[], nextParsedItems: ParsedQuickOrderItem[]) => {
      const { error } = await supabase
        .from('quick_order_sessions')
        .update({
          messages: nextMessages.map(buildPersistedMessage),
          parsed_items: nextParsedItems,
          status: 'active',
        })
        .eq('id', nextSessionId);

      if (error) {
        throw error;
      }
    },
    [],
  );

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    if (!userId || !locationId) {
      throw new Error('Choose a location before using Quick Order.');
    }

    const { data, error } = await supabase
      .from('quick_order_sessions')
      .insert({
        location_id: locationId,
        user_id: userId,
        status: 'active',
        messages: [],
        parsed_items: [],
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    const nextSessionId = String((data as { id: string }).id);
    setSessionId(nextSessionId);
    return nextSessionId;
  }, [locationId, sessionId, userId]);

  const handleToggleLocationDropdown = useCallback(() => {
    setLocationDropdownOpen((current) => !current);
  }, []);

  const handleCloseLocationDropdown = useCallback(() => {
    setLocationDropdownOpen(false);
  }, []);

  const handleSelectLocation = useCallback(
    (next: Location) => {
      if (next.id === location?.id) return;
      setAuthLocation(next);
    },
    [location?.id, setAuthLocation],
  );

  const handleClear = useCallback(async () => {
    Keyboard.dismiss();
    setInputValue('');
    setMessages([]);
    setParsedItems([]);
    setEditingItem(null);
    setNudgeSent(false);

    if (sessionId) {
      try {
        await supabase
          .from('quick_order_sessions')
          .update({
            status: 'abandoned',
            messages: [],
            parsed_items: [],
          })
          .eq('id', sessionId);
      } catch (error) {
        console.warn('[QuickOrder] Failed to abandon session:', error);
      } finally {
        setSessionId(null);
      }
    }
  }, [sessionId]);

  const handleClearRequest = useCallback(() => {
    Alert.alert(
      'Clear current order?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void handleClear();
          },
        },
      ],
    );
  }, [handleClear]);

  const loadInventoryItems = useCallback(async () => {
    if (inventoryItems.length > 0) return inventoryItems;

    const { data, error } = await supabase
      .from('inventory_items')
      .select('id,name,base_unit,pack_unit')
      .eq('active', true)
      .order('name', { ascending: true })
      .limit(1000);

    if (error) throw error;
    const nextItems = (data ?? []) as QuickOrderInventoryItem[];
    setInventoryItems(nextItems);
    return nextItems;
  }, [inventoryItems]);

  const getInventoryMatches = useCallback(
    (query: string) => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return [];
      return inventoryItems
        .filter((item) => item.name.toLowerCase().includes(normalized))
        .slice(0, 8);
    },
    [inventoryItems],
  );

  const openParsedItemEditor = useCallback(
    (messageId: string, itemIndex: number, item: ParsedQuickOrderItem) => {
      setEditingItem({
        messageId,
        itemIndex,
        original: item,
        itemId: item.item_id ?? '',
        itemSearch: item.item_name,
        quantity: item.quantity == null ? '' : String(item.quantity),
        unit: item.unit ?? '',
        isSaving: false,
      });

      loadInventoryItems().catch((error) => {
        console.warn('[QuickOrder] Failed to load correction inventory:', error);
      });
    },
    [loadInventoryItems],
  );

  const openCartItemEditor = useCallback(
    (item: ParsedQuickOrderItem) => {
      const itemKey = getParsedItemKey(item);
      let sourceMessageId = 'cart-summary';
      let sourceItemIndex = parsedItems.findIndex(
        (candidate) => getParsedItemKey(candidate) === itemKey,
      );

      for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex];
        const candidateIndex = (message.parsedItems ?? []).findIndex(
          (candidate) => getParsedItemKey(candidate) === itemKey,
        );

        if (candidateIndex >= 0) {
          sourceMessageId = message.id;
          sourceItemIndex = candidateIndex;
          break;
        }
      }

      openParsedItemEditor(sourceMessageId, Math.max(sourceItemIndex, 0), item);
    },
    [messages, openParsedItemEditor, parsedItems],
  );

  const closeParsedItemEditor = useCallback(() => {
    setEditingItem(null);
  }, []);

  const saveParsedItemCorrection = useCallback(async () => {
    if (!editingItem || !userId) return;

    const correctedItemId = editingItem.itemId;
    const correctedInventory = inventoryById.get(correctedItemId);
    const quantity = Number(editingItem.quantity);
    const rawToken = (editingItem.original.raw_token || editingItem.original.item_name).trim();
    const unit = editingItem.unit.trim();

    if (!isUuid(userId)) {
      Alert.alert('Sign in required', 'Sign in again before saving a correction.');
      return;
    }

    if (!isUuid(correctedItemId) || !correctedInventory) {
      Alert.alert('Choose an item', 'Select a valid inventory item before saving.');
      return;
    }

    if (!rawToken) {
      Alert.alert('Missing raw text', 'This correction needs the original typed text.');
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      Alert.alert('Check quantity', 'Enter a quantity greater than zero.');
      return;
    }

    try {
      setEditingItem((current) => current ? { ...current, isSaving: true } : current);

      const { error: correctionError } = await supabase.from('parser_corrections').insert({
        session_id: isUuid(sessionId) ? sessionId : null,
        user_id: userId,
        raw_token: rawToken,
        parser_suggested_item_id: isUuid(editingItem.original.item_id)
          ? editingItem.original.item_id
          : null,
        user_corrected_item_id: correctedItemId,
        user_corrected_qty: quantity,
        user_corrected_unit: unit || null,
      });

      if (correctionError) throw correctionError;

      const correctedParsedItem: ParsedQuickOrderItem = {
        ...editingItem.original,
        item_id: correctedItemId,
        item_name: correctedInventory.name,
        quantity,
        unit: unit || null,
        needs_clarification: !unit,
        unresolved: false,
      };

      const nextMessages = messages.map((message) => {
        if (message.id !== editingItem.messageId) return message;
        const nextItems = [...(message.parsedItems ?? [])];
        nextItems[editingItem.itemIndex] = correctedParsedItem;
        return { ...message, parsedItems: nextItems };
      });
      const nextParsedItems = replaceParsedItem(parsedItems, editingItem.original, correctedParsedItem);

      setMessages(nextMessages);
      setParsedItems(nextParsedItems);

      if (sessionId) {
        await persistSession(sessionId, nextMessages, nextParsedItems);
      }

      setEditingItem(null);
    } catch (error: any) {
      Alert.alert('Correction failed', error?.message ?? 'Unable to save this correction.');
      setEditingItem((current) => current ? { ...current, isSaving: false } : current);
    }
  }, [editingItem, inventoryById, messages, parsedItems, persistSession, sessionId, userId]);

  const appendErrorMessage = useCallback(
    async (baseMessages: QuickOrderMessage[], nextSessionId: string, errorCode?: string) => {
      const lastMsg = baseMessages[baseMessages.length - 1];
      const isRepeatError = lastMsg?.role === 'error';

      const errorMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: 'error',
        text: isRepeatError
          ? 'Still having trouble \u2014 tap to retry'
          : getErrorMessage(errorCode),
        createdAt: new Date().toISOString(),
        errorCode,
      };

      // Collapse consecutive identical errors
      const nextMessages = isRepeatError
        ? [...baseMessages.slice(0, -1), errorMessage]
        : [...baseMessages, errorMessage];

      setMessages(nextMessages);

      try {
        await persistSession(nextSessionId, nextMessages, parsedItems);
      } catch (error) {
        console.warn('[QuickOrder] Failed to persist error message:', error);
      }
    },
    [parsedItems, persistSession],
  );

  const handleSubmitMore = useCallback(async () => {
    const rawText = inputValue.trim();
    if (!rawText || isSending) {
      return;
    }

    if (!userId || !locationId) {
      const errorMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: 'error',
        text: 'Choose a location before using Quick Order.',
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, errorMessage]);
      return;
    }

    Keyboard.dismiss();
    setInputValue('');
    setIsSending(true);
    lastUserTextRef.current = rawText;

    // Cancel any pending nudge timer
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }

    const userMessage: QuickOrderMessage = {
      id: createMessageId(),
      role: 'user',
      text: rawText,
      createdAt: new Date().toISOString(),
    };
    const optimisticMessages = [...messages, userMessage];
    setMessages(optimisticMessages);

    let activeSessionId = sessionId;

    try {
      activeSessionId = await ensureSession();
      await persistSession(activeSessionId, optimisticMessages, parsedItems);

      const { data, error } = await supabase.functions.invoke('parse-order', {
        body: {
          raw_text: rawText,
          location_id: locationId,
          session_id: activeSessionId,
          user_id: userId,
        },
      });

      if (error) {
        throw error;
      }

      const response = data as ParseOrderResponse;
      if (response?.error) {
        console.warn(`[QuickOrder] AI API Error: ${response.error} - ${response.detail || 'No detail'}`);
        const code = response.code || 'ai_unavailable';
        if (activeSessionId) {
          await appendErrorMessage(optimisticMessages, activeSessionId, code);
        }
        return;
      }

      const responseItems = normalizeParsedItems(response?.parsed_items);
      const responseSuggestions = normalizeSuggestions(response?.suggestions);
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: 'assistant',
        text: response?.reply_text || 'Got these.',
        createdAt: new Date().toISOString(),
        parsedItems: responseItems,
        flags: Array.isArray(response?.flags) ? response.flags : [],
        suggestions: responseSuggestions,
      };
      const nextParsedItems = mergeParsedItems(parsedItems, responseItems);
      const nextMessages = [...optimisticMessages, assistantMessage];

      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      await persistSession(activeSessionId, nextMessages, nextParsedItems);

      // Start nudge timer after a successful parse with items
      if (nextParsedItems.length > 0 && !nudgeSent) {
        if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = setTimeout(() => {
          const unresolvedCount = nextParsedItems.filter((item) => getItemIssue(item)).length;
          if (unresolvedCount === 0 && !nudgeSent) {
            setNudgeSent(true);
            const nudgeMessage: QuickOrderMessage = {
              id: createMessageId(),
              role: 'assistant',
              text: 'Anything else, or ready to send?',
              createdAt: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, nudgeMessage]);
          }
        }, 30_000);
      }
    } catch (error) {
      console.warn('[QuickOrder] parse-order failed:', error);
      if (activeSessionId) {
        await appendErrorMessage(optimisticMessages, activeSessionId, 'ai_unavailable');
      }
    } finally {
      setIsSending(false);
    }
  }, [
    appendErrorMessage,
    ensureSession,
    inputValue,
    isSending,
    locationId,
    messages,
    nudgeSent,
    parsedItems,
    persistSession,
    sessionId,
    userId,
  ]);

  const handleRetry = useCallback(() => {
    const lastText = lastUserTextRef.current;
    if (!lastText || isSending) return;
    setInputValue(lastText);
    requestAnimationFrame(() => {
      void handleSubmitMore();
    });
  }, [handleSubmitMore, isSending]);

  const handleConfirmOrder = useCallback(async () => {
    if (parsedItems.length === 0 || activeFlags.length > 0 || isSubmittingOrder) {
      return;
    }

    if (!userId || !locationId) {
      Alert.alert('Choose a location', 'Choose a location before confirming this order.');
      return;
    }

    Keyboard.dismiss();
    setIsSubmittingOrder(true);

    try {
      const loadedInventory = await loadInventoryItems();
      const payloadInventoryById = new Map<string, QuickOrderInventoryItem>(
        loadedInventory.map((item) => [item.id, item]),
      );
      const orderItems = parsedItems.map((item) => toOrderItemPayload(item, payloadInventoryById));
      const activeSessionId = await ensureSession();
      const result = await submitOrderService({
        orderId: createUuid(),
        locationId,
        userId,
        status: 'submitted',
        items: orderItems,
      });

      syncProfileAfterOrder(userId, result.order.created_at);

      const { error: orderUpdateError } = await supabase
        .from('orders')
        .update({
          entry_method: 'quick_order',
          quick_session_id: activeSessionId,
          manager_review_status: 'pending',
        })
        .eq('id', result.order.id);

      if (orderUpdateError) throw orderUpdateError;

      const { error: sessionUpdateError } = await supabase
        .from('quick_order_sessions')
        .update({
          status: 'submitted',
          submitted_order_id: result.order.id,
          messages: messages.map(buildPersistedMessage),
          parsed_items: parsedItems,
        })
        .eq('id', activeSessionId);

      if (sessionUpdateError) throw sessionUpdateError;

      setShowSuccessToast(true);
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }

      successTimerRef.current = setTimeout(() => {
        setInputValue('');
        setMessages([]);
        setParsedItems([]);
        setEditingItem(null);
        setSessionId(null);
        setNudgeSent(false);
        setShowSuccessToast(false);
      }, 900);
    } catch (error: any) {
      Alert.alert('Could not confirm order', error?.message ?? 'Try again in a moment.');
    } finally {
      setIsSubmittingOrder(false);
    }
  }, [
    activeFlags.length,
    ensureSession,
    isSubmittingOrder,
    loadInventoryItems,
    locationId,
    messages,
    parsedItems,
    userId,
  ]);

  const renderParsedItemEditor = () => {
    const draft = editingItem;
    const matches = draft ? getInventoryMatches(draft.itemSearch) : [];
    const selectedInventory = draft ? inventoryById.get(draft.itemId) : null;

    return (
      <Modal
        visible={Boolean(draft)}
        animationType="slide"
        transparent
        onRequestClose={closeParsedItemEditor}
      >
        <Pressable style={styles.drawerOverlay} onPress={closeParsedItemEditor}>
          <Pressable
            style={[
              styles.editDrawer,
              {
                borderTopLeftRadius: ds.radius(26),
                borderTopRightRadius: ds.radius(26),
                padding: ds.spacing(18),
                paddingBottom: Math.max(insets.bottom, ds.spacing(16)),
              },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.drawerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerTitle, { fontSize: ds.fontSize(22) }]}>
                  Edit item
                </Text>
                <Text style={[styles.drawerSubtitle, { fontSize: ds.fontSize(13) }]}>
                  Raw text: {draft?.original.raw_token || draft?.original.item_name || 'Unknown'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close editor"
                onPress={closeParsedItemEditor}
                style={styles.drawerCloseButton}
              >
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={[styles.drawerLabel, { fontSize: ds.fontSize(12), marginTop: ds.spacing(14) }]}>
              Item
            </Text>
            <TextInput
              value={draft?.itemSearch ?? ''}
              onChangeText={(value) =>
                setEditingItem((current) =>
                  current
                    ? {
                        ...current,
                        itemSearch: value,
                        itemId: value === selectedInventory?.name ? current.itemId : '',
                      }
                    : current,
                )
              }
              placeholder="Search inventory item"
              placeholderTextColor="#A8A8A2"
              style={[styles.drawerInput, { fontSize: ds.fontSize(16), minHeight: ds.spacing(48) }]}
            />

            {matches.length > 0 ? (
              <View style={{ marginTop: ds.spacing(8), gap: ds.spacing(6), maxHeight: ds.spacing(190) }}>
                {matches.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      setEditingItem((current) =>
                        current
                          ? {
                              ...current,
                              itemId: item.id,
                              itemSearch: item.name,
                              unit: current.unit || item.base_unit || item.pack_unit || '',
                            }
                          : current,
                      )
                    }
                    style={({ pressed }) => [
                      styles.drawerMatchRow,
                      { backgroundColor: pressed ? colors.primaryPale : colors.glassCircle },
                    ]}
                  >
                    <Text style={[styles.drawerMatchText, { fontSize: ds.fontSize(14) }]}>
                      {item.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={[styles.drawerHint, { fontSize: ds.fontSize(12) }]}>
              Selected: {selectedInventory?.name || 'None'}
            </Text>

            <View style={{ flexDirection: 'row', gap: ds.spacing(10), marginTop: ds.spacing(12) }}>
              <View style={{ flex: 0.8 }}>
                <Text style={[styles.drawerLabel, { fontSize: ds.fontSize(12) }]}>Qty</Text>
                <TextInput
                  value={draft?.quantity ?? ''}
                  onChangeText={(value) =>
                    setEditingItem((current) =>
                      current ? { ...current, quantity: value.replace(/[^0-9.]/g, '') } : current,
                    )
                  }
                  keyboardType="decimal-pad"
                  placeholder="Qty"
                  placeholderTextColor="#A8A8A2"
                  style={[styles.drawerInput, { fontSize: ds.fontSize(16), minHeight: ds.spacing(48) }]}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerLabel, { fontSize: ds.fontSize(12) }]}>Unit</Text>
                <TextInput
                  value={draft?.unit ?? ''}
                  onChangeText={(value) =>
                    setEditingItem((current) => current ? { ...current, unit: value } : current)
                  }
                  placeholder="lb, case, pack"
                  placeholderTextColor="#A8A8A2"
                  style={[styles.drawerInput, { fontSize: ds.fontSize(16), minHeight: ds.spacing(48) }]}
                />
              </View>
            </View>

            <View style={[styles.drawerActions, { gap: ds.spacing(10), marginTop: ds.spacing(16) }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel edit"
                onPress={closeParsedItemEditor}
                style={({ pressed }) => [
                  styles.drawerSecondaryButton,
                  { opacity: pressed ? 0.82 : 1, minHeight: ds.spacing(50) },
                ]}
              >
                <Text style={[styles.drawerSecondaryText, { fontSize: ds.fontSize(16) }]}>Cancel</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save correction"
                onPress={() => void saveParsedItemCorrection()}
                disabled={draft?.isSaving}
                style={({ pressed }) => [
                  styles.drawerPrimaryButton,
                  {
                    opacity: draft?.isSaving ? 0.6 : pressed ? 0.86 : 1,
                    minHeight: ds.spacing(50),
                  },
                ]}
              >
                {draft?.isSaving ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={[styles.drawerPrimaryText, { fontSize: ds.fontSize(16) }]}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderMessage = (message: QuickOrderMessage) => {
    if (message.role === 'assistant') {
      return <AIResponsePill key={message.id} message={message} />;
    }

    if (message.role === 'error') {
      const canRetry = message.errorCode !== 'feature_disabled' &&
        message.errorCode !== 'rate_limit_user_daily' &&
        message.errorCode !== 'rate_limit_org_monthly';

      return (
        <View
          key={message.id}
          style={[
            styles.errorCard,
            {
              borderRadius: ds.radius(18),
              padding: ds.spacing(16),
            },
          ]}
        >
          <Text style={[styles.errorText, { fontSize: ds.fontSize(17) }]}>{message.text}</Text>
          {canRetry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry"
              onPress={handleRetry}
              style={({ pressed }) => [
                styles.retryButton,
                {
                  marginTop: ds.spacing(10),
                  borderRadius: ds.radius(12),
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.retryText, { fontSize: ds.fontSize(14) }]}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    return (
      <View
        key={message.id}
        style={[
          styles.userBubble,
          {
            borderRadius: ds.radius(28),
            paddingHorizontal: ds.spacing(22),
            paddingVertical: ds.spacing(14),
          },
        ]}
      >
        <Text style={[styles.userBubbleText, { fontSize: ds.fontSize(22) }]}>
          {message.text}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoider}
      >
        <View style={styles.screen}>
          <View style={[styles.header, { paddingHorizontal: ds.spacing(24) }]}>
            <StockCheckHeader
              locationLabel={location?.name ?? 'No location'}
              locations={allLocations}
              selectedLocationId={location?.id ?? null}
              isDropdownOpen={locationDropdownOpen}
              onToggleDropdown={handleToggleLocationDropdown}
              onSelectLocation={handleSelectLocation}
              onCloseDropdown={handleCloseLocationDropdown}
              onPressMore={handleClearRequest}
              moreAccessibilityLabel="Clear quick order"
              moreIconName="trash-outline"
            />
          </View>

          <QuickOrderCartSummary
            parsedItems={parsedItems}
            issueCount={activeFlags.length}
            isSubmitting={isSubmittingOrder}
            onPressItem={openCartItemEditor}
            onConfirm={() => void handleConfirmOrder()}
          />

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={handleCloseLocationDropdown}
            style={styles.chatStream}
            contentContainerStyle={[
              styles.chatContent,
              { paddingHorizontal: ds.spacing(28) },
              chatContentStyle,
            ]}
          >
            {isLoadingSession ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              messages.map(renderMessage)
            )}

            {isSending ? (
              <View
                style={[
                  styles.typingCard,
                  {
                    borderRadius: ds.radius(18),
                    padding: ds.spacing(14),
                    marginTop: ds.spacing(16),
                  },
                ]}
              >
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.typingText, { fontSize: ds.fontSize(16) }]}>
                  Reading order...
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <Animated.View
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
            style={[
              styles.composer,
              {
                left: ds.spacing(16),
                right: ds.spacing(16),
              },
              composerAnimatedStyle,
            ]}
          >
            <View
              style={[
                styles.inputPill,
                {
                  minHeight: ds.spacing(48),
                  borderRadius: ds.radius(24),
                  paddingLeft: ds.spacing(20),
                  paddingRight: ds.spacing(8),
                },
              ]}
            >
              <TextInput
                value={inputValue}
                onChangeText={setInputValue}
                placeholder={messages.length === 0 ? 'Type order...' : 'Add more...'}
                placeholderTextColor="#A8A8A2"
                multiline
                blurOnSubmit={false}
                submitBehavior="newline"
                editable={!isSending}
                style={[styles.input, { fontSize: ds.fontSize(17), maxHeight: 100 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                onPress={() => void handleSubmitMore()}
                disabled={isSending || !inputValue.trim()}
                hitSlop={8}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: isSending || !inputValue.trim()
                      ? '#E0D8CF'
                      : colors.primary,
                    opacity: isSending ? 0.5 : 1,
                  },
                ]}
              >
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              </Pressable>
            </View>

          </Animated.View>
          {showSuccessToast ? (
            <Animated.View
              entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
              style={[
                styles.successToast,
                {
                  top: insets.top + ds.spacing(72),
                  borderRadius: ds.radius(18),
                  paddingHorizontal: ds.spacing(18),
                  paddingVertical: ds.spacing(12),
                },
              ]}
            >
              <Ionicons name="checkmark-circle" size={20} color={colors.statusGreen} />
              <Text style={[styles.successToastText, { fontSize: ds.fontSize(16) }]}>
                Sent for manager review
              </Text>
            </Animated.View>
          ) : null}
          {renderParsedItemEditor()}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 4,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  headerSummary: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: 0,
  },
  cartSummary: {
    backgroundColor: colors.white,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    zIndex: 5,
  },
  cartSummaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cartSummaryTitle: {
    color: colors.textSecondary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  cartSummaryMeta: {
    fontWeight: '800',
    letterSpacing: 0,
  },
  cartEmptyText: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0,
  },
  cartSummaryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: glassHairlineWidth,
    borderBottomColor: colors.divider,
  },
  cartSummaryItemName: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '800',
    marginLeft: 12,
    letterSpacing: 0,
  },
  cartSummaryItemMeta: {
    fontWeight: '700',
    letterSpacing: 0,
    marginLeft: 12,
  },
  confirmOrderButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOrderText: {
    fontWeight: '800',
    letterSpacing: 0,
  },
  chatStream: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    paddingTop: 8,
  },
  timestamp: {
    alignSelf: 'center',
    color: '#8D8D88',
    fontWeight: '700',
    marginBottom: 18,
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: colors.primary,
    marginTop: 14,
  },
  userBubbleText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  systemCard: {
    marginTop: 18,
    backgroundColor: colors.white,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  errorCard: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    marginTop: 16,
    backgroundColor: colors.statusRedBg,
    borderWidth: glassHairlineWidth,
    borderColor: 'rgba(163, 45, 45, 0.18)',
  },
  errorText: {
    color: colors.statusRed,
    fontWeight: '700',
    letterSpacing: 0,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(163, 45, 45, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  retryText: {
    color: colors.statusRed,
    fontWeight: '800',
    letterSpacing: 0,
  },
  typingCard: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  typingText: {
    marginLeft: 10,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  aiPill: {
    alignSelf: 'flex-start',
    maxWidth: '88%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 1,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  aiPillText: {
    flex: 1,
    marginLeft: 10,
    color: colors.textPrimary,
    fontWeight: '600',
    letterSpacing: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderText: {
    color: '#8B8B86',
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 0,
  },
  assistantText: {
    color: colors.textPrimary,
    fontWeight: '600',
    lineHeight: 25,
    letterSpacing: 0,
  },
  parsedItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  parsedItemText: {
    flex: 1,
    marginLeft: 12,
    color: colors.textPrimary,
    fontWeight: '500',
    letterSpacing: 0,
  },
  suggestionBox: {
    backgroundColor: '#FFF2D9',
  },
  suggestionTitle: {
    color: '#704612',
    fontWeight: '800',
    letterSpacing: 0,
  },
  suggestionText: {
    color: '#704612',
    fontWeight: '700',
    lineHeight: 25,
    letterSpacing: 0,
  },
  suggestionReason: {
    color: '#8F6837',
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  suggestionPrimaryButton: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionSecondaryButton: {
    flex: 1,
    backgroundColor: '#EEE5D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionPrimaryText: {
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0,
  },
  suggestionSecondaryText: {
    color: colors.black,
    fontWeight: '800',
    letterSpacing: 0,
  },
  composer: {
    position: 'absolute',
  },
  inputPill: {
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 1,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '600',
    minHeight: 40,
    letterSpacing: 0,
    textAlignVertical: 'center',
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeOrderButton: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeOrderText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  successToast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 20,
  },
  successToastText: {
    color: colors.textPrimary,
    fontWeight: '800',
    marginLeft: 8,
    letterSpacing: 0,
  },
  drawerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.scrim,
  },
  editDrawer: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  drawerTitle: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  drawerSubtitle: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: 3,
    letterSpacing: 0,
  },
  drawerCloseButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerLabel: {
    color: colors.textSecondary,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  drawerInput: {
    borderRadius: 14,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    backgroundColor: colors.glassCircle,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  drawerMatchRow: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  drawerMatchText: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  drawerHint: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: 8,
    letterSpacing: 0,
  },
  drawerActions: {
    flexDirection: 'row',
  },
  drawerPrimaryButton: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  drawerSecondaryButton: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassCircle,
  },
  drawerPrimaryText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  drawerSecondaryText: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
