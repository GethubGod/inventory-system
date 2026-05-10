import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  Easing,
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
import { useAuthStore, useOrderStore } from '@/store';
import { areQuickOrderItemsCartReady, quickOrderItemsToCartAdds } from '@/store/helpers';
import { colors, glassColors, glassHairlineWidth, glassSpacing } from '@/theme/design';
import { StockCheckHeader } from '@/features/stock-check/components/StockCheckHeader';
import type { Location } from '@/types';
import type { OrderingMode } from './types';
import { QuickOrderListCard } from './QuickOrderListCard';
import {
  QuickOrderItemEditModal,
  type QuickOrderItemEditResult,
} from './QuickOrderItemEditModal';
import {
  QuickOrderQuantityDialog,
  type QuickOrderQuantityResult,
} from './QuickOrderQuantityDialog';
import { QuickOrderUserMessage } from './QuickOrderUserMessage';
import {
  sanitizeAssistantReply,
  toFriendlyQuickOrderError,
} from './quickOrderErrors';
import {
  buildQuickOrderAssistantMessage,
  hasQuickOrderStateChange,
  normalizeQuickOrderParseResponse,
} from './quickOrderResponse';
import {
  countUnresolvedItems,
  applyQuickOrderClarificationAction,
  formatParsedItemQuantity,
  getParsedItemDisplayName,
  getParsedItemIssue,
  getParsedItemKey,
  hasParsedItemName,
  isUuid,
  mergeQuickOrderParsedItemsDetailed,
  removeParsedItem,
  updateParsedItem,
  type PendingQuickOrderClarification,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from './quickOrderItems';

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

type QuickOrderMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  createdAt: string;
  parsedItems?: ParsedQuickOrderItem[];
  pendingClarifications?: PendingQuickOrderClarification[];
  flags?: QuickOrderFlag[];
  suggestions?: QuickOrderSuggestion[];
  errorCode?: string;
};

/** Identifies which parsed item the edit popup is currently working on. */
type EditingState = {
  /** Snapshot of the item at the moment the popup opened. */
  original: ParsedQuickOrderItem;
  /** Stable key (see {@link getParsedItemKey}) used to locate and patch the item. */
  key: string;
  isSaving: boolean;
};

/** Identifies which parsed item the focused quantity dialog is working on. */
type QuantityDialogState = {
  original: ParsedQuickOrderItem;
  key: string;
  isSaving: boolean;
};

type PersistedQuickOrderMessage = {
  role?: string;
  text?: string;
  raw_text?: string;
  reply_text?: string;
  created_at?: string;
  parsed_items?: ParsedQuickOrderItem[];
  pending_clarifications?: PendingQuickOrderClarification[];
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

/** Breathing room between the floating "Order List" card and the first chat bubble. */
const CARD_TO_CHAT_GAP = 16;
/** First-paint estimate for the floating card's height before it has measured itself. */
const INITIAL_CARD_HEIGHT_ESTIMATE = 196;
/** Duration the chat's top spacer uses to follow the card's height changes. */
const CARD_TIMING = { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) } as const;

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeParsedItems(value: unknown): ParsedQuickOrderItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (entry && typeof entry === 'object' ? (entry as ParsedQuickOrderItem) : null))
    // Keep anything we can render a row for: a name, a raw token, or an id. A
    // nameless item still gets a visible "Unknown item" row + issue indicator
    // rather than being silently dropped.
    .filter((entry): entry is ParsedQuickOrderItem =>
      Boolean(entry && (hasParsedItemName(entry) || entry.raw_token?.trim() || entry.raw_text?.trim() || entry.item_id)),
    );
}

function normalizeSuggestions(value: unknown): QuickOrderSuggestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry as QuickOrderSuggestion : null))
    .filter((entry): entry is QuickOrderSuggestion => Boolean(entry?.item_id && entry?.item_name));
}

function normalizeClarifications(value: unknown): PendingQuickOrderClarification[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry as PendingQuickOrderClarification : null))
    .filter((entry): entry is PendingQuickOrderClarification =>
      Boolean(entry?.id && entry.message && Array.isArray(entry.actions)),
    );
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
        pendingClarifications: normalizeClarifications(message.pending_clarifications),
        flags: Array.isArray(message.flags) ? message.flags : [],
        suggestions: normalizeSuggestions(message.suggestions),
      };
    })
    .filter((message): message is QuickOrderMessage => Boolean(message));
}

/** Applies `patch` to every embedded copy of the item identified by `key`. */
function patchMessageItems(
  messages: QuickOrderMessage[],
  key: string,
  patch: Partial<ParsedQuickOrderItem>,
): QuickOrderMessage[] {
  return messages.map((message) => {
    const items = message.parsedItems;
    if (!items || !items.some((item) => getParsedItemKey(item) === key)) return message;
    return { ...message, parsedItems: updateParsedItem(items, key, patch) };
  });
}

/** Drops every embedded copy of the item identified by `key`. */
function removeMessageItems(messages: QuickOrderMessage[], key: string): QuickOrderMessage[] {
  return messages.map((message) => {
    const items = message.parsedItems;
    if (!items || !items.some((item) => getParsedItemKey(item) === key)) return message;
    return { ...message, parsedItems: removeParsedItem(items, key) };
  });
}

function buildPersistedMessage(message: QuickOrderMessage): PersistedQuickOrderMessage {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      reply_text: message.text,
      text: message.text,
      parsed_items: message.parsedItems ?? [],
      pending_clarifications: message.pendingClarifications ?? [],
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

type AIResponsePillProps = {
  message: QuickOrderMessage;
};

function getAssistantPill(message: QuickOrderMessage) {
  const flags = message.flags ?? [];
  const items = message.parsedItems ?? [];
  const pendingCount = message.pendingClarifications?.length ?? 0;
  const flaggedItem = items.find((item) => getParsedItemIssue(item));
  const addedItem = items.find((item) => !getParsedItemIssue(item));

  if (pendingCount > 0 || flaggedItem || (flags.length > 0 && items.length === 0)) {
    const issue = flaggedItem ? getParsedItemIssue(flaggedItem) : null;
    const flaggedItemName = flaggedItem ? getParsedItemDisplayName(flaggedItem) : '';
    let text = message.text || flags[0]?.message;
    if (!text && flaggedItem) {
      switch (issue?.kind) {
        case 'pick-quantity':
          text = `How much ${flaggedItemName}?`;
          break;
        case 'pick-unit':
          text = `What unit for ${flaggedItemName}?`;
          break;
        case 'choose-item':
          text = `Couldn't match "${flaggedItemName}" — tap ⓘ to pick it.`;
          break;
        default:
          text = `Double-check ${flaggedItemName}.`;
      }
    }
    return {
      icon: 'alert-circle-outline' as const,
      color: colors.statusAmber,
      text: text ?? message.text,
    };
  }

  if (addedItem) {
    return {
      icon: 'checkmark' as const,
      color: colors.statusGreen,
      text: message.text || `Added ${getParsedItemDisplayName(addedItem)} · ${formatParsedItemQuantity(addedItem)}`,
    };
  }

  const looksLikeNoChange = /^those items are already|^that item is already/i.test(message.text);
  return {
    icon: looksLikeNoChange ? 'checkmark' as const : 'alert-circle-outline' as const,
    color: looksLikeNoChange ? colors.statusGreen : colors.statusAmber,
    text: message.text,
  };
}

const AIResponsePill = React.memo(function AIResponsePill({ message }: AIResponsePillProps) {
  const ds = useScaledStyles();
  const pill = getAssistantPill(message);
  // Defensive: a flag/reply that somehow carries technical text never reaches the user.
  const text = sanitizeAssistantReply(
    pill.text,
    'I had trouble reading that order. Please try again or add the items manually.',
  );

  return (
    <Animated.View
      entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
      style={[
        styles.aiPill,
        {
          borderRadius: ds.radius(20),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(10),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons name={pill.icon} size={16} color={pill.color} />
      <Text
        style={[styles.aiPillText, { fontSize: ds.fontSize(16) }]}
        numberOfLines={2}
      >
        {text}
      </Text>
    </Animated.View>
  );
});

type ClarificationCardProps = {
  clarification: PendingQuickOrderClarification;
  onAction: (
    clarification: PendingQuickOrderClarification,
    action: PendingQuickOrderClarification['actions'][number],
  ) => void;
};

const ClarificationCard = React.memo(function ClarificationCard({
  clarification,
  onAction,
}: ClarificationCardProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={[
        styles.clarificationCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <View style={styles.clarificationHeader}>
        <Ionicons name="help-circle-outline" size={ds.icon(18)} color={colors.statusAmber} />
        <Text style={[styles.clarificationText, { fontSize: ds.fontSize(15), marginLeft: ds.spacing(8) }]}>
          {clarification.message}
        </Text>
      </View>
      <View style={[styles.clarificationActions, { gap: ds.spacing(8), marginTop: ds.spacing(10) }]}>
        {clarification.actions.map((action) => (
          <Pressable
            key={`${clarification.id}:${action.id}:${action.existing_item_key ?? ''}`}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onAction(clarification, action)}
            style={({ pressed }) => [
              styles.clarificationButton,
              {
                borderRadius: ds.radius(12),
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(8),
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Text style={[styles.clarificationButtonText, { fontSize: ds.fontSize(13) }]} numberOfLines={1}>
              {action.preview ? `${action.label} — ${action.preview}` : action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

export function QuickOrderScreen({ mode }: QuickOrderScreenProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const chatListRef = useRef<FlatList<QuickOrderMessage> | null>(null);
  const user = useAuthStore((state) => state.user);
  const allLocations = useAuthStore((state) => state.locations);
  const setAuthLocation = useAuthStore((state) => state.setLocation);
  const { location } = useResolvedActiveLocation();
  const tabBarHeight = 60 + getTabBarBottomInset(insets.bottom);
  const closedComposerOffset = tabBarHeight + ds.spacing(14);

  const addToCart = useOrderStore((state) => state.addToCart);

  const [inputValue, setInputValue] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  /** Height of the software keyboard while it is visible (0 when hidden). */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuickOrderMessage[]>([]);
  const [parsedItems, setParsedItems] = useState<ParsedQuickOrderItem[]>([]);
  const [pendingClarifications, setPendingClarifications] = useState<PendingQuickOrderClarification[]>([]);
  const [inventoryItems, setInventoryItems] = useState<QuickOrderInventoryItem[]>([]);
  const [editingState, setEditingState] = useState<EditingState | null>(null);
  const [quantityDialogState, setQuantityDialogState] = useState<QuantityDialogState | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [floatingCardHeight, setFloatingCardHeight] = useState(
    () => ds.spacing(INITIAL_CARD_HEIGHT_ESTIMATE),
  );
  const lastUserTextRef = useRef('');
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScrollFrameRef = useRef<number | null>(null);
  const chatScrollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const composerBottomOffset = useSharedValue(closedComposerOffset);
  const userId = user?.id ?? null;
  const locationId = location?.id ?? null;

  const scrollChatToEnd = useCallback((animated = true) => {
    try {
      chatListRef.current?.scrollToEnd({ animated });
    } catch {
      // The list can be momentarily empty / unmounted during keyboard or
      // layout transitions — a failed scroll there is harmless.
    }
  }, []);

  const scheduleChatScrollToEnd = useCallback(
    (animated = true, delays: number[] = [0]) => {
      delays.forEach((delay) => {
        const run = () => {
          if (chatScrollFrameRef.current != null) {
            cancelAnimationFrame(chatScrollFrameRef.current);
          }
          chatScrollFrameRef.current = requestAnimationFrame(() => {
            chatScrollFrameRef.current = null;
            scrollChatToEnd(animated);
          });
        };

        if (delay <= 0) {
          run();
          return;
        }

        const timer = setTimeout(() => {
          chatScrollTimersRef.current = chatScrollTimersRef.current.filter(
            (entry) => entry !== timer,
          );
          run();
        }, delay);
        chatScrollTimersRef.current.push(timer);
      });
    },
    [scrollChatToEnd],
  );

  const handleChatContentSizeChange = useCallback(() => {
    scheduleChatScrollToEnd(true);
  }, [scheduleChatScrollToEnd]);

  const handleInputFocus = useCallback(() => {
    scheduleChatScrollToEnd(true, [0, 120, 320]);
  }, [scheduleChatScrollToEnd]);

  const handleChatLayout = useCallback(() => {
    scheduleChatScrollToEnd(false);
  }, [scheduleChatScrollToEnd]);

  // Keyboard-aware composer + chat. The composer is absolutely positioned and
  // its `bottom` is animated to sit just above the real keyboard height; the
  // chat list's bottom padding (see `chatContentStyle`) is widened by the same
  // amount so the newest message is never hidden behind the keyboard/composer.
  useEffect(() => {
    const isIos = Platform.OS === 'ios';
    const showEvent = isIos ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIos ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleShow = (event: KeyboardEvent) => {
      const height = event.endCoordinates?.height ?? 0;
      const duration = event.duration ?? 250;
      setKeyboardHeight(height);
      setKeyboardVisible(true);
      composerBottomOffset.value = withTiming(height + ds.spacing(8), {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      scheduleChatScrollToEnd(true, [0, Math.max(80, duration - 40), duration + 80]);
    };

    const handleHide = (event: KeyboardEvent) => {
      const duration = event.duration ?? 220;
      setKeyboardHeight(0);
      setKeyboardVisible(false);
      composerBottomOffset.value = withTiming(closedComposerOffset, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      scheduleChatScrollToEnd(true, [0, duration + 60]);
    };

    const subscriptions = [
      Keyboard.addListener(showEvent, handleShow),
      Keyboard.addListener(hideEvent, handleHide),
    ];
    if (isIos) {
      // One more scroll pass once the keyboard frame has fully settled.
      subscriptions.push(
        Keyboard.addListener('keyboardDidShow', () => scheduleChatScrollToEnd(true, [0, 120])),
      );
    }

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [closedComposerOffset, composerBottomOffset, ds, scheduleChatScrollToEnd]);

  useEffect(() => {
    if (!keyboardVisible) {
      composerBottomOffset.value = closedComposerOffset;
      setKeyboardHeight(0);
    }
  }, [closedComposerOffset, composerBottomOffset, keyboardVisible]);

  useEffect(() => {
    if (!userId || !locationId) {
      setSessionId(null);
      setMessages([]);
      setParsedItems([]);
      setPendingClarifications([]);
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
        const nextMessages = Array.isArray(row?.messages) ? mapPersistedMessages(row.messages) : [];
        setSessionId(row?.id ?? null);
        setMessages(nextMessages);
        setParsedItems(normalizeParsedItems(row?.parsed_items));
        setPendingClarifications(nextMessages.flatMap((message) => message.pendingClarifications ?? []));
      } catch (error) {
        console.warn('[QuickOrder] Failed to load active session:', error);
        if (!cancelled) {
          setSessionId(null);
          setMessages([]);
          setParsedItems([]);
          setPendingClarifications([]);
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

  // Re-snap to the newest message whenever something that affects layout below
  // it changes: a new message, the parsed-item list (which grows the floating
  // card / top spacer), the composer growing for multiline text, the card
  // height, or a send completing.
  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      scheduleChatScrollToEnd(true);
    });
    return () => cancelAnimationFrame(handle);
  }, [
    isSending,
    messages.length,
    parsedItems,
    composerHeight,
    floatingCardHeight,
    scheduleChatScrollToEnd,
  ]);

  useEffect(() => () => {
    if (chatScrollFrameRef.current != null) {
      cancelAnimationFrame(chatScrollFrameRef.current);
    }
    chatScrollTimersRef.current.forEach(clearTimeout);
    chatScrollTimersRef.current = [];
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
    }
  }, []);

  const issueCount = useMemo(
    () => countUnresolvedItems(parsedItems) + pendingClarifications.length,
    [parsedItems, pendingClarifications.length],
  );

  const chatContentStyle = useMemo(
    () => ({
      // Clear the composer and (when open) the keyboard, plus breathing room,
      // so the latest bubble always ends up above both. `closedComposerOffset`
      // already accounts for the tab bar + its safe-area inset; the keyboard
      // height is measured from the screen bottom, so neither path adds
      // `insets.bottom` again.
      paddingBottom:
        composerHeight +
        (keyboardVisible ? keyboardHeight + ds.spacing(8) : closedComposerOffset) +
        ds.spacing(28),
    }),
    [closedComposerOffset, composerHeight, ds, keyboardHeight, keyboardVisible],
  );

  const composerAnimatedStyle = useAnimatedStyle(() => ({
    bottom: composerBottomOffset.value,
  }));

  // The chat FlatList reserves a top spacer equal to the floating card's measured
  // height (plus a small gap) so the first message is never trapped behind the card.
  // The spacer is animated via a shared value (rather than a layout transition,
  // which is unsupported inside virtualized-list internals) so it grows/shrinks in
  // step with the card whenever items are added or the card expands/collapses.
  const chatTopSpacerTarget = floatingCardHeight + ds.spacing(CARD_TO_CHAT_GAP);
  const chatTopSpacerHeight = useSharedValue(chatTopSpacerTarget);
  useEffect(() => {
    chatTopSpacerHeight.value = withTiming(chatTopSpacerTarget, CARD_TIMING);
  }, [chatTopSpacerHeight, chatTopSpacerTarget]);
  const chatTopSpacerStyle = useAnimatedStyle(() => ({ height: chatTopSpacerHeight.value }));

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
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
    setInputValue('');
    setMessages([]);
    setParsedItems([]);
    setPendingClarifications([]);
    setEditingState(null);
    setQuantityDialogState(null);
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

  const handleEditItem = useCallback(
    (item: ParsedQuickOrderItem) => {
      setEditingState({ original: item, key: getParsedItemKey(item), isSaving: false });
      loadInventoryItems().catch((error) => {
        console.warn('[QuickOrder] Failed to load editor inventory:', error);
      });
    },
    [loadInventoryItems],
  );

  const handleCloseEditModal = useCallback(() => {
    setEditingState((current) => (current?.isSaving ? current : null));
  }, []);

  const handleSaveEditedItem = useCallback(
    async (result: QuickOrderItemEditResult) => {
      const editing = editingState;
      if (!editing) return;

      const trimmedUnit = result.unit.trim();
      const patch: Partial<ParsedQuickOrderItem> = {
        item_id: result.itemId,
        item_name: result.itemName,
        name: result.itemName,
        quantity: result.quantity,
        unit: trimmedUnit || null,
        // `updateParsedItem` clears these once the item is fully resolved.
        needs_clarification: editing.original.needs_clarification,
        unresolved: result.itemId ? false : editing.original.unresolved,
      };

      setEditingState((current) => (current ? { ...current, isSaving: true } : current));

      // Best-effort parser-correction logging — only when a real inventory row
      // is attached and we have the ids the table requires.
      const rawToken = (editing.original.raw_token || getParsedItemDisplayName(editing.original)).trim();
      if (result.inventoryItem && isUuid(result.inventoryItem.id) && isUuid(userId) && rawToken) {
        try {
          await supabase.from('parser_corrections').insert({
            session_id: isUuid(sessionId) ? sessionId : null,
            user_id: userId,
            location_id: isUuid(locationId) ? locationId : null,
            raw_token: rawToken,
            parser_suggested_item_id: isUuid(editing.original.item_id) ? editing.original.item_id : null,
            user_corrected_item_id: result.inventoryItem.id,
            user_corrected_qty: result.quantity,
            user_corrected_unit: trimmedUnit || null,
            correction_type: editing.original.unresolved ? 'manual_item_match' : 'unit',
          });
        } catch (error) {
          console.warn('[QuickOrder] Failed to log parser correction:', error);
        }
      }

      const nextParsedItems = updateParsedItem(parsedItems, editing.key, patch);
      const nextMessages = patchMessageItems(messages, editing.key, patch);

      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      setEditingState(null);

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, nextParsedItems);
        } catch (error) {
          console.warn('[QuickOrder] Failed to persist item edit:', error);
        }
      }
    },
    [editingState, locationId, messages, parsedItems, persistSession, sessionId, userId],
  );

  const handleRemoveEditedItem = useCallback(() => {
    const editing = editingState;
    if (!editing) return;

    Alert.alert(
      `Remove ${getParsedItemDisplayName(editing.original)}?`,
      'It will be taken off this order.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const nextParsedItems = removeParsedItem(parsedItems, editing.key);
            const nextMessages = removeMessageItems(messages, editing.key);
            setParsedItems(nextParsedItems);
            setMessages(nextMessages);
            setEditingState(null);
            if (sessionId) {
              persistSession(sessionId, nextMessages, nextParsedItems).catch((error) => {
                console.warn('[QuickOrder] Failed to persist item removal:', error);
              });
            }
          },
        },
      ],
    );
  }, [editingState, messages, parsedItems, persistSession, sessionId]);

  const handleResolveQuantity = useCallback(
    (item: ParsedQuickOrderItem) => {
      setQuantityDialogState({ original: item, key: getParsedItemKey(item), isSaving: false });
      loadInventoryItems().catch((error) => {
        console.warn('[QuickOrder] Failed to load editor inventory:', error);
      });
    },
    [loadInventoryItems],
  );

  const handleCloseQuantityDialog = useCallback(() => {
    setQuantityDialogState((current) => (current?.isSaving ? current : null));
  }, []);

  const handleSaveQuantity = useCallback(
    async (result: QuickOrderQuantityResult) => {
      const editing = quantityDialogState;
      if (!editing) return;

      const trimmedUnit = result.unit.trim();
      const patch: Partial<ParsedQuickOrderItem> = {
        quantity: result.quantity,
        unit: trimmedUnit || editing.original.unit,
        // `updateParsedItem` clears `needs_clarification` / `unresolved` once
        // the item has an id, a positive quantity and a unit.
      };

      setQuantityDialogState((current) => (current ? { ...current, isSaving: true } : current));

      const nextParsedItems = updateParsedItem(parsedItems, editing.key, patch);
      const nextMessages = patchMessageItems(messages, editing.key, patch);
      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      setQuantityDialogState(null);

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, nextParsedItems);
        } catch (error) {
          console.warn('[QuickOrder] Failed to persist quantity edit:', error);
        }
      }
    },
    [messages, parsedItems, persistSession, quantityDialogState, sessionId],
  );

  const appendErrorMessage = useCallback(
    async (baseMessages: QuickOrderMessage[], nextSessionId: string, errorCode?: string) => {
      const lastMsg = baseMessages[baseMessages.length - 1];
      const isRepeatError = lastMsg?.role === 'error';

      const errorMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: 'error',
        text: isRepeatError
          ? 'Still having trouble \u2014 tap to retry'
          : toFriendlyQuickOrderError(undefined, errorCode),
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

      const response = normalizeQuickOrderParseResponse(data);
      if (response.rawError) {
        console.warn(`[QuickOrder] parse-order returned an error: ${response.rawError}`);
        const code = response.errorCode || 'ai_unavailable';
        if (activeSessionId) {
          await appendErrorMessage(optimisticMessages, activeSessionId, code);
        }
        return;
      }

      const responseItems = response.parsedItems;
      const responseSuggestions = normalizeSuggestions(response.suggestions);
      const responseClarifications = response.pendingActions;
      const mergeResult = mergeQuickOrderParsedItemsDetailed(parsedItems, responseItems);
      const nextParsedItems = mergeResult.items;
      const nextPendingClarifications = [...pendingClarifications, ...responseClarifications];
      const assistantText = buildQuickOrderAssistantMessage({
        normalized: response,
        mergeResult,
        pendingCount: responseClarifications.length,
      });

      if (
        __DEV__ &&
        response.status === 'ok' &&
        !hasQuickOrderStateChange(mergeResult, responseClarifications.length)
      ) {
        console.warn('[QuickOrder] Parser response produced no state change', {
          sessionId: activeSessionId,
          locationId,
          received: response.diagnostics.items_received,
          accepted: response.diagnostics.items_accepted,
          rejected: response.diagnostics.items_rejected,
          pending: response.diagnostics.pending_action_count,
          mergeBefore: parsedItems.length,
          mergeAfter: nextParsedItems.length,
          rejectedReasons: [
            ...response.diagnostics.rejected_reasons,
            ...mergeResult.rejectedReasons,
          ],
        });
      }

      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: 'assistant',
        text: assistantText,
        createdAt: new Date().toISOString(),
        parsedItems: responseItems,
        pendingClarifications: responseClarifications,
        flags: response.flags,
        suggestions: responseSuggestions,
      };
      const nextMessages = [...optimisticMessages, assistantMessage];

      setParsedItems(nextParsedItems);
      setPendingClarifications(nextPendingClarifications);
      setMessages(nextMessages);
      await persistSession(activeSessionId, nextMessages, nextParsedItems);

      // Start nudge timer after a successful parse with items
      if (nextParsedItems.length > 0 && !nudgeSent) {
        if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = setTimeout(() => {
          const unresolvedCount = countUnresolvedItems(nextParsedItems) + nextPendingClarifications.length;
          if (nextParsedItems.length > 0 && unresolvedCount === 0 && !nudgeSent) {
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
    pendingClarifications,
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

  const handleClarificationAction = useCallback(
    async (
      clarification: PendingQuickOrderClarification,
      action: PendingQuickOrderClarification['actions'][number],
    ) => {
      const nextParsedItems = applyQuickOrderClarificationAction(parsedItems, clarification, action);
      const nextPendingClarifications = pendingClarifications.filter(
        (entry) => entry.id !== clarification.id,
      );
      const nextMessages = messages.map((message) => ({
        ...message,
        pendingClarifications: message.pendingClarifications?.filter(
          (entry) => entry.id !== clarification.id,
        ),
      }));

      setParsedItems(nextParsedItems);
      setPendingClarifications(nextPendingClarifications);
      setMessages(nextMessages);

      const incoming = clarification.incoming_item;
      if (incoming && action.id !== 'cancel' && isUuid(userId) && isUuid(locationId)) {
        try {
          await supabase.from('parser_corrections').insert({
            session_id: isUuid(sessionId) ? sessionId : null,
            user_id: userId,
            location_id: locationId,
            raw_token: (incoming.raw_token || incoming.raw_text || clarification.item_name).trim(),
            parser_suggested_item_id: isUuid(incoming.item_id) ? incoming.item_id : null,
            user_corrected_item_id: isUuid(incoming.item_id) ? incoming.item_id : null,
            user_corrected_qty: incoming.quantity,
            user_corrected_unit: incoming.unit,
            correction_type: action.id === 'add'
              ? 'conflict_add'
              : action.id === 'replace'
                ? 'conflict_replace'
                : 'conflict_keep_separate',
          });
        } catch (error) {
          console.warn('[QuickOrder] Failed to log conflict correction:', error);
        }
      }

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, nextParsedItems);
        } catch (error) {
          console.warn('[QuickOrder] Failed to persist clarification action:', error);
        }
      }
    },
    [locationId, messages, parsedItems, pendingClarifications, persistSession, sessionId, userId],
  );

  /**
   * Moves the resolved Quick Order items into the normal app cart and routes to
   * the Cart tab. Quick Order never submits an order itself — the cart is the
   * single submission surface.
   */
  const handleConfirmOrder = useCallback(async () => {
    if (
      parsedItems.length === 0 ||
      issueCount > 0 ||
      isConfirming ||
      !areQuickOrderItemsCartReady(parsedItems)
    ) {
      return;
    }

    if (!userId || !locationId) {
      Alert.alert('Choose a location', 'Choose a location before confirming this order.');
      return;
    }

    Keyboard.dismiss();
    setIsConfirming(true);

    const closingSessionId = sessionId;
    try {
      const loadedInventory = await loadInventoryItems();
      const inventoryById = new Map<string, QuickOrderInventoryItem>(
        loadedInventory.map((item) => [item.id, item]),
      );
      const cartAdds = quickOrderItemsToCartAdds(parsedItems, inventoryById);

      cartAdds.forEach((add) => {
        addToCart(locationId, add.inventoryItemId, add.quantity, add.unitType, {
          context: mode.scope,
          inputMode: 'quantity',
          quantityRequested: add.quantity,
          note: add.note,
        });
      });

      // The Order List card already plays a confirmation haptic on press; no
      // need to double up here.

      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }

      // The items live in the cart now — clear the Quick Order session so the
      // chat starts fresh next time. Best-effort; a failed update doesn't block
      // navigation since the cart already has the items.
      if (closingSessionId) {
        try {
          await supabase
            .from('quick_order_sessions')
            .update({ status: 'abandoned', messages: [], parsed_items: [] })
            .eq('id', closingSessionId);
        } catch (error) {
          console.warn('[QuickOrder] Failed to close session after confirm:', error);
        }
      }

      setInputValue('');
      setMessages([]);
      setParsedItems([]);
      setPendingClarifications([]);
      setEditingState(null);
      setQuantityDialogState(null);
      setSessionId(null);
      setNudgeSent(false);

      router.push(mode.cartRoute as never);
    } catch (error) {
      console.warn('[QuickOrder] Failed to move order to cart:', error);
      Alert.alert(
        'Could not confirm order',
        "Couldn't move these items to your cart. Please try again.",
      );
    } finally {
      setIsConfirming(false);
    }
  }, [
    addToCart,
    isConfirming,
    issueCount,
    loadInventoryItems,
    locationId,
    mode.cartRoute,
    mode.scope,
    parsedItems,
    sessionId,
    userId,
  ]);

  const renderChatMessage = useCallback(
    ({ item: message }: { item: QuickOrderMessage }) => {
      if (message.role === 'assistant') {
        return (
          <View>
            <AIResponsePill message={message} />
            {(message.pendingClarifications ?? []).map((clarification) => (
              <ClarificationCard
                key={clarification.id}
                clarification={clarification}
                onAction={handleClarificationAction}
              />
            ))}
          </View>
        );
      }

      if (message.role === 'error') {
        const canRetry =
          message.errorCode !== 'feature_disabled' &&
          message.errorCode !== 'rate_limit_user_daily' &&
          message.errorCode !== 'rate_limit_org_monthly';
        // Defensive: never render a raw technical string even if one slipped in.
        const errorText = toFriendlyQuickOrderError(message.text, message.errorCode);

        return (
          <View
            style={[
              styles.errorCard,
              {
                borderRadius: ds.radius(16),
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(10),
                marginTop: ds.spacing(10),
              },
            ]}
          >
            <Text style={[styles.errorText, { fontSize: ds.fontSize(15) }]}>{errorText}</Text>
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

      return <QuickOrderUserMessage text={message.text} />;
    },
    [ds, handleClarificationAction, handleRetry],
  );

  const keyExtractor = useCallback((item: QuickOrderMessage) => item.id, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.screen}>
        <View
          style={[
            styles.header,
            {
              paddingHorizontal: glassSpacing.screen,
              paddingTop: ds.spacing(4),
            },
          ]}
        >
          <StockCheckHeader
            locationLabel={location?.name ?? ''}
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

        <View style={styles.chatArea}>
          {/* Layer 1 — the chat scrolls the full height, passing beneath the card. */}
          <FlatList
            ref={chatListRef}
            data={isLoadingSession ? [] : messages}
            keyExtractor={keyExtractor}
            renderItem={renderChatMessage}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={handleCloseLocationDropdown}
            onLayout={handleChatLayout}
            onContentSizeChange={handleChatContentSizeChange}
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={16}
            maxToRenderPerBatch={8}
            windowSize={9}
            style={styles.chatStream}
            contentContainerStyle={[
              styles.chatContent,
              { paddingHorizontal: ds.spacing(28) },
              chatContentStyle,
            ]}
            ListHeaderComponent={<Animated.View style={chatTopSpacerStyle} />}
            ListEmptyComponent={
              isLoadingSession ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : null
            }
            ListFooterComponent={
              isSending ? (
                <View
                  style={[
                    styles.typingCard,
                    {
                      borderRadius: ds.radius(18),
                      paddingHorizontal: ds.spacing(14),
                      paddingVertical: ds.spacing(11),
                      marginTop: ds.spacing(10),
                    },
                  ]}
                >
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.typingText, { fontSize: ds.fontSize(15) }]}>
                    Reading order...
                  </Text>
                </View>
              ) : null
            }
          />

          {/* Layer 2 — the floating "Order List" card pinned just below the header. */}
          <QuickOrderListCard
            items={parsedItems}
            issueCount={issueCount}
            isSubmitting={isConfirming}
            onEditItem={handleEditItem}
            onResolveQuantity={handleResolveQuantity}
            onConfirm={() => void handleConfirmOrder()}
            onHeightChange={setFloatingCardHeight}
          />
        </View>

        <Animated.View
          onLayout={(event) => {
            setComposerHeight(event.nativeEvent.layout.height);
            scheduleChatScrollToEnd(false);
          }}
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
              placeholderTextColor={colors.textMuted}
              multiline
              onFocus={handleInputFocus}
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
                    ? colors.textMuted
                    : colors.primary,
                  opacity: isSending ? 0.5 : 1,
                },
              ]}
            >
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </Animated.View>

        <QuickOrderItemEditModal
          visible={Boolean(editingState)}
          item={editingState?.original ?? null}
          inventoryItems={inventoryItems}
          isSaving={Boolean(editingState?.isSaving)}
          canRemove
          onClose={handleCloseEditModal}
          onSave={(result) => void handleSaveEditedItem(result)}
          onRemove={handleRemoveEditedItem}
        />
        <QuickOrderQuantityDialog
          visible={Boolean(quantityDialogState)}
          item={quantityDialogState?.original ?? null}
          inventoryItem={
            quantityDialogState?.original.item_id
              ? inventoryItems.find((row) => row.id === quantityDialogState.original.item_id) ?? null
              : null
          }
          isSaving={Boolean(quantityDialogState?.isSaving)}
          onClose={handleCloseQuantityDialog}
          onSave={(result) => void handleSaveQuantity(result)}
        />
      </View>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.background,
    // Keep the header (and its location dropdown overlay) above the floating card.
    zIndex: 30,
  },
  chatArea: {
    flex: 1,
  },
  chatStream: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    paddingTop: 0,
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: 32,
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
  clarificationCard: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    backgroundColor: colors.statusAmberBg,
    borderWidth: glassHairlineWidth,
    borderColor: 'rgba(181, 121, 0, 0.24)',
  },
  clarificationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  clarificationText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  clarificationActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  clarificationButton: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  clarificationButtonText: {
    color: colors.primary,
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
});
