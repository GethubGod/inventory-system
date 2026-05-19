import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  Easing,
  LinearTransition,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { getTabBarBottomInset } from "@/components/navigation";
import { useResolvedActiveLocation } from "@/hooks/useResolvedActiveLocation";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { triggerSelectionHaptic } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuthStore, useOrderStore } from "@/store";
import {
  areQuickOrderItemsCartReady,
  quickOrderItemsToCartAdds,
} from "@/store/helpers";
import { useRouter } from "expo-router";
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassSpacing,
} from "@/theme/design";
import { StockCheckHeader } from "@/features/stock-check/components/StockCheckHeader";
import type { Location } from "@/types";
import type { OrderingMode } from "./types";
import { QuickOrderListCard } from "./QuickOrderListCard";
import {
  QuickOrderItemEditModal,
  type QuickOrderItemEditResult,
} from "./QuickOrderItemEditModal";
import {
  QuickOrderQuantitySheet,
  type QuickOrderQuantityResult,
  type QuickOrderQuantitySheetItem,
} from "./QuickOrderQuantitySheet";
import {
  advanceQuantityFlow,
  getQuantityFixQueue,
  type QuantityFlowState,
} from "./quickOrderQuantityFlow";
import { QuickOrderComposerBar } from "./QuickOrderComposerBar";
import {
  fetchPreviousQuantitySuggestions,
  type PreviousQuantitySuggestion,
} from "./quickOrderHistorySuggestions";
import { QuickOrderUserMessage } from "./QuickOrderUserMessage";
import { QuickOrderWelcomeMessageCard } from "./QuickOrderWelcomeMessage";
import { NeedsInputActionButtons } from "./NeedsInputActionButtons";
import {
  buildQuickOrderDisplayMessages,
  createQuickOrderWelcomeMessage,
  isQuickOrderWelcomeMessage,
  shouldShowQuickOrderWelcomeMessage,
} from "./quickOrderWelcome";
import {
  sanitizeAssistantReply,
  toFriendlyQuickOrderError,
} from "./quickOrderErrors";
import {
  buildSendSnapDelays,
  calculateQuickOrderBottomScrollOffset,
  calculateQuickOrderBottomPadding,
  shouldAutoStickToBottom,
} from "./quickOrderChatLayout";
import {
  buildQuickOrderAssistantMessage,
  hasQuickOrderStateChange,
  normalizeQuickOrderParseResponse,
  type QuickOrderBlockedOperation,
  type QuickOrderMessageSource,
  type QuickOrderRecommendation,
  type QuickOrderSafetyWarning,
  type QuickOrderStockUpdate,
} from "./quickOrderResponse";
import {
  countUnresolvedItems,
  applyQuickOrderClarificationAction,
  applyQuickOrderOperations,
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
  type QuickOrderMergeResult,
  type QuickOrderOperationResult,
} from "./quickOrderItems";

type SpeechRecognitionModule = {
  addListener: (eventName: string, listener: (event: any) => void) => { remove: () => void };
  requestPermissionsAsync: () => Promise<{ granted?: boolean }>;
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
};

let ExpoSpeechRecognitionModule: SpeechRecognitionModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ExpoSpeechRecognitionModule = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
} catch {
  ExpoSpeechRecognitionModule = null;
}

type QuickOrderFlag = {
  type: string;
  message: string;
  raw_token?: string;
  item_id?: string;
};

type QuickOrderSuggestion = {
  type?: "reorder_recent" | "reorder_last_week" | "usual_item" | "missing_item";
  title?: string;
  message?: string;
  items?: {
    item_id: string;
    item_name: string;
    quantity: number;
    unit: string | null;
    unit_type?: string | null;
  }[];
  item_id?: string;
  item_name?: string;
  suggested_qty?: number;
  unit?: string | null;
  unit_type?: string | null;
  reason?: string | null;
  confidence?: number;
  action?: "preview" | "add";
};

type QuickOrderMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  createdAt: string;
  source?: QuickOrderMessageSource;
  transcriptPreview?: string;
  parsedItems?: ParsedQuickOrderItem[];
  pendingClarifications?: PendingQuickOrderClarification[];
  flags?: QuickOrderFlag[];
  suggestions?: QuickOrderSuggestion[];
  stockUpdates?: QuickOrderStockUpdate[];
  recommendations?: QuickOrderRecommendation[];
  safetyWarnings?: QuickOrderSafetyWarning[];
  blockedOperations?: QuickOrderBlockedOperation[];
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

type PersistedQuickOrderMessage = {
  id?: string;
  role?: string;
  text?: string;
  raw_text?: string;
  reply_text?: string;
  created_at?: string;
  parsed_items?: ParsedQuickOrderItem[];
  pending_clarifications?: PendingQuickOrderClarification[];
  flags?: QuickOrderFlag[];
  suggestions?: QuickOrderSuggestion[];
  source?: QuickOrderMessageSource;
  stock_updates?: QuickOrderStockUpdate[];
  recommendations?: QuickOrderRecommendation[];
  safety_warnings?: QuickOrderSafetyWarning[];
  blocked_operations?: QuickOrderBlockedOperation[];
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
const CARD_TIMING = {
  duration: 280,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
} as const;
const CHAT_NEAR_BOTTOM_THRESHOLD = 160;
const QUICK_ORDER_READY_NUDGE_DELAY_MS = 120_000;

type ChatSnapOptions = {
  active?: boolean;
  afterInteractions?: boolean;
};

type ChatScrollMetrics = {
  contentHeight: number;
  visibleHeight: number;
  offsetY: number;
};

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function devTextFingerprint(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `${text.length}chars:${(hash >>> 0).toString(16).slice(0, 8)}`;
}

function devIdFingerprint(id: string | null | undefined): string | null {
  if (!id) return null;
  return devTextFingerprint(id);
}

function normalizeParsedItems(value: unknown): ParsedQuickOrderItem[] {
  if (!Array.isArray(value)) return [];

  return (
    value
      .map((entry) =>
        entry && typeof entry === "object"
          ? (entry as ParsedQuickOrderItem)
          : null,
      )
      // Keep anything we can render a row for: a name, a raw token, or an id. A
      // nameless item still gets a visible "Unknown item" row + issue indicator
      // rather than being silently dropped.
      .filter((entry): entry is ParsedQuickOrderItem =>
        Boolean(
          entry &&
          (hasParsedItemName(entry) ||
            entry.raw_token?.trim() ||
            entry.raw_text?.trim() ||
            entry.item_id),
        ),
      )
  );
}

function normalizeSuggestions(value: unknown): QuickOrderSuggestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as QuickOrderSuggestion)
        : null,
    )
    .filter((entry): entry is QuickOrderSuggestion =>
      Boolean(
        (entry?.items && entry.items.length > 0) ||
        (entry?.item_id && entry?.item_name),
      ),
    );
}

function normalizeClarifications(
  value: unknown,
): PendingQuickOrderClarification[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as PendingQuickOrderClarification)
        : null,
    )
    .filter((entry): entry is PendingQuickOrderClarification =>
      Boolean(entry?.id && entry.message && Array.isArray(entry.actions)),
    );
}

/**
 * If a clarification is a low-confidence match with a single "use_item"
 * action, accept it on the user's behalf: rewrite the matching parsed item
 * to point at the suggested inventory id and drop the clarification. The
 * downstream merge + assistant message then treats the item as the resolved
 * one (e.g. "Shrimp (Frozen)") and the user only sees "How much …?" if a
 * quantity is still needed.
 */
function autoResolveSingleAlternativeMatches(
  items: ParsedQuickOrderItem[],
  clarifications: PendingQuickOrderClarification[],
): {
  items: ParsedQuickOrderItem[];
  clarifications: PendingQuickOrderClarification[];
} {
  if (clarifications.length === 0) {
    return { items, clarifications };
  }

  const remaining: PendingQuickOrderClarification[] = [];
  const autoAccepted: PendingQuickOrderClarification[] = [];
  for (const clarification of clarifications) {
    const useAction = clarification.actions.find(
      (action) => action.id === "use_item",
    );
    const isAutoAcceptable =
      (clarification.type === "low_confidence_match" ||
        clarification.type === "item_not_found") &&
      clarification.actions.length === 1 &&
      useAction != null &&
      clarification.incoming_item != null &&
      Boolean(clarification.incoming_item.item_id);
    if (isAutoAcceptable) {
      autoAccepted.push(clarification);
    } else {
      remaining.push(clarification);
    }
  }

  if (autoAccepted.length === 0) {
    return { items, clarifications };
  }

  const incomingByToken = new Map<string, ParsedQuickOrderItem>();
  for (const clarification of autoAccepted) {
    const incoming = clarification.incoming_item;
    if (!incoming) continue;
    const key = clarificationMatchKey(incoming);
    if (key) incomingByToken.set(key, incoming);
  }

  const resolved = items.map((item) => {
    const key = clarificationMatchKey(item);
    if (!key) return item;
    const incoming = incomingByToken.get(key);
    if (!incoming) return item;
    return {
      ...item,
      item_id: incoming.item_id,
      item_name: incoming.item_name ?? item.item_name,
      display_name: incoming.item_name ?? item.display_name,
      unresolved: false,
      status: undefined,
      needs_clarification: false,
      issue: undefined,
      issue_code: undefined,
      alternatives: undefined,
      action: null,
      parse_source: "correction" as const,
    };
  });

  return { items: resolved, clarifications: remaining };
}

/**
 * Detect "bare quantity" messages like "1pk", "2 cases", "3 packs", "5". When
 * the most recent parsed item is still waiting on a quantity, prepend the
 * item's display name so the parser treats this as a quantity for that item.
 * The visible user bubble shows the rewritten text — matches what the user
 * meant.
 */
function rewriteBareQuantityWithContext(
  rawText: string,
  parsedItems: ParsedQuickOrderItem[],
): string {
  const trimmed = rawText.trim();
  if (!trimmed) return rawText;
  // "1pk", "2 cases", "3 packs", "5", "10 lb". Letters-only suffix is OK.
  if (!/^\d+(?:\.\d+)?\s*[a-z]{0,8}\.?$/i.test(trimmed)) return rawText;

  const target = [...parsedItems].reverse().find((item) => {
    const issue = getParsedItemIssue(item);
    return (
      issue != null &&
      (issue.kind === "pick-quantity" || issue.kind === "pick-unit")
    );
  });
  if (!target) return rawText;
  const name = getParsedItemDisplayName(target);
  if (!name || name === "Unknown item") return rawText;
  return `${name} ${trimmed}`;
}

function clarificationMatchKey(
  item: ParsedQuickOrderItem,
): string | null {
  const raw = (item.raw_token ?? item.raw_text ?? item.item_text ?? "")
    .trim()
    .toLowerCase();
  return raw ? raw : null;
}

function buildClarificationConfirmedLabel(
  clarification: PendingQuickOrderClarification,
  action: PendingQuickOrderClarification["actions"][number],
): string {
  if (action.id === "cancel") return "Canceled";
  if (action.id === "clear_order") return "Cleared order";
  const stripped = action.label
    .replace(/^Use\s+/i, "")
    .replace(/^Add\s+/i, "")
    .replace(/^Replace with\s+/i, "")
    .replace(/^Replace\s+/i, "")
    .replace(/^Choose\s+/i, "")
    .trim();
  if (action.id === "use_unit") {
    return `Set unit to ${stripped}`;
  }
  if (action.id === "request_approval") {
    return `Requested approval for ${stripped || clarification.item_name}`;
  }
  if (action.id === "replace" || action.id === "choose_existing") {
    return `Replaced with ${stripped || clarification.item_name}`;
  }
  return `Added ${stripped || clarification.item_name}`;
}

function isCartBlockingClarification(
  clarification: PendingQuickOrderClarification,
): boolean {
  return ![
    "item_not_found",
    "ambiguous_item",
    "invalid_unit",
    "quantity_safety",
    "manager_approval_required",
    "low_confidence_match",
  ].includes(clarification.type);
}

function mergePendingClarificationsAfterParse(
  existing: PendingQuickOrderClarification[],
  resolvedItems: ParsedQuickOrderItem[],
  incoming: PendingQuickOrderClarification[],
): PendingQuickOrderClarification[] {
  const resolvedItemIds = new Set(
    resolvedItems
      .filter((item) => getParsedItemIssue(item) == null && item.item_id)
      .map((item) => item.item_id as string),
  );
  const resolvedKeys = new Set(
    resolvedItems
      .filter((item) => getParsedItemIssue(item) == null)
      .map(getParsedItemKey),
  );

  const retained = existing.filter((clarification) => {
    if (clarification.item_id && resolvedItemIds.has(clarification.item_id))
      return false;
    if (
      clarification.existing_item_key &&
      resolvedKeys.has(clarification.existing_item_key)
    )
      return false;
    return true;
  });
  const byId = new Map<string, PendingQuickOrderClarification>();
  for (const clarification of [...retained, ...incoming].filter(
    isCartBlockingClarification,
  )) {
    byId.set(clarification.id, clarification);
  }
  return [...byId.values()];
}

function mapPersistedMessages(
  messages: PersistedQuickOrderMessage[],
): QuickOrderMessage[] {
  return messages
    .filter((message) => !isQuickOrderWelcomeMessage({ id: message.id, source: message.source }))
    .map((message): QuickOrderMessage | null => {
      const role =
        message.role === "assistant" || message.role === "error"
          ? message.role
          : "user";
      const text =
        typeof message.text === "string"
          ? message.text
          : typeof message.raw_text === "string"
            ? message.raw_text
            : typeof message.reply_text === "string"
              ? message.reply_text
              : "";

      if (!text) return null;

      return {
        id:
          typeof message.id === "string" && message.id.trim()
            ? message.id
            : createMessageId(),
        role,
        text,
        createdAt: message.created_at ?? new Date().toISOString(),
        source: message.source === "voice" ? "voice" : "typed",
        parsedItems: normalizeParsedItems(message.parsed_items),
        pendingClarifications: normalizeClarifications(
          message.pending_clarifications,
        ),
        flags: Array.isArray(message.flags) ? message.flags : [],
        suggestions: normalizeSuggestions(message.suggestions),
        stockUpdates: Array.isArray(message.stock_updates)
          ? message.stock_updates
          : [],
        recommendations: Array.isArray(message.recommendations)
          ? message.recommendations
          : [],
        safetyWarnings: Array.isArray(message.safety_warnings)
          ? message.safety_warnings
          : [],
        blockedOperations: Array.isArray(message.blocked_operations)
          ? message.blocked_operations
          : [],
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
    if (!items || !items.some((item) => getParsedItemKey(item) === key))
      return message;
    return { ...message, parsedItems: updateParsedItem(items, key, patch) };
  });
}

/** Drops every embedded copy of the item identified by `key`. */
function removeMessageItems(
  messages: QuickOrderMessage[],
  key: string,
): QuickOrderMessage[] {
  return messages.map((message) => {
    const items = message.parsedItems;
    if (!items || !items.some((item) => getParsedItemKey(item) === key))
      return message;
    return { ...message, parsedItems: removeParsedItem(items, key) };
  });
}

function buildPersistedMessage(
  message: QuickOrderMessage,
): PersistedQuickOrderMessage | null {
  if (isQuickOrderWelcomeMessage(message)) {
    return null;
  }

  if (message.role === "assistant") {
    return {
      id: message.id,
      role: "assistant",
      reply_text: message.text,
      text: message.text,
      parsed_items: message.parsedItems ?? [],
      pending_clarifications: (message.pendingClarifications ?? []).filter(
        (clarification) => clarification.actions.length > 0,
      ),
      flags: message.flags ?? [],
      suggestions: message.suggestions ?? [],
      source: message.source,
      stock_updates: message.stockUpdates ?? [],
      recommendations: message.recommendations ?? [],
      safety_warnings: message.safetyWarnings ?? [],
      blocked_operations: message.blockedOperations ?? [],
      created_at: message.createdAt,
    };
  }

  return {
    id: message.id,
    role: message.role,
    raw_text: message.text,
    text: message.text,
    source: message.source,
    created_at: message.createdAt,
  };
}

type AIResponsePillProps = {
  message: QuickOrderMessage;
  onLayout?: (event: LayoutChangeEvent) => void;
};

type AssistantPillTone = "success" | "caution" | "neutral";

function getAssistantPill(message: QuickOrderMessage) {
  const flags = message.flags ?? [];
  const items = message.parsedItems ?? [];
  const pendingCount = message.pendingClarifications?.length ?? 0;
  const flaggedItem = items.find((item) => getParsedItemIssue(item));
  const addedItem = items.find((item) => !getParsedItemIssue(item));
  const hasUserFix =
    pendingCount > 0 ||
    Boolean(flaggedItem) ||
    Boolean(message.safetyWarnings?.length) ||
    Boolean(message.blockedOperations?.length) ||
    (flags.length > 0 && items.length === 0);

  if (hasUserFix) {
    const issue = flaggedItem ? getParsedItemIssue(flaggedItem) : null;
    const flaggedItemName = flaggedItem
      ? getParsedItemDisplayName(flaggedItem)
      : "";
    let text = message.text || flags[0]?.message;
    if (!text && flaggedItem) {
      switch (issue?.kind) {
        case "pick-quantity":
          text = `How much ${flaggedItemName}?`;
          break;
        case "pick-unit":
          text = `What unit for ${flaggedItemName}?`;
          break;
        case "choose-item":
          text = `Couldn't match "${flaggedItemName}" — tap ⓘ to pick it.`;
          break;
        default:
          text = `Double-check ${flaggedItemName}.`;
      }
    }
    return {
      icon: "alert-circle" as const,
      color: colors.statusAmber,
      tone: "caution" as AssistantPillTone,
      text: text ?? message.text,
    };
  }

  if (addedItem) {
    return {
      icon: "checkmark" as const,
      color: colors.statusGreen,
      tone: "success" as AssistantPillTone,
      text: message.text || "Done",
    };
  }

  const looksLikeNoChange =
    /^those items are already|^that item is already/i.test(message.text);
  return {
    icon: looksLikeNoChange
      ? ("checkmark" as const)
      : ("sparkles-outline" as const),
    color: looksLikeNoChange ? colors.statusGreen : colors.primary,
    tone: looksLikeNoChange ? ("success" as AssistantPillTone) : ("neutral" as AssistantPillTone),
    text: message.text,
  };
}

function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text.includes("**")) return text;
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((segment, index) => {
    if (segment.startsWith("**") && segment.endsWith("**") && segment.length > 4) {
      return (
        <Text key={index} style={{ fontWeight: "800" }}>
          {segment.slice(2, -2)}
        </Text>
      );
    }
    return segment;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wraps every case-insensitive occurrence of `term` in the given `text` with
 * markdown bold markers (`**...**`) so it can be rendered by
 * {@link renderInlineMarkdown}. If the term is already bolded somewhere in the
 * text we leave it alone.
 */
function boldifyTerm(text: string, term: string | null | undefined): string {
  if (!text || !term) return text;
  const trimmed = term.trim();
  if (!trimmed) return text;
  // Already bolded? leave as-is to avoid double-wrap
  if (text.includes(`**${trimmed}**`)) return text;
  const re = new RegExp(`(${escapeRegExp(trimmed)})`, "i");
  if (!re.test(text)) return text;
  return text.replace(re, "**$1**");
}

type CardBadgeTone = "needs-input" | "added" | "info" | "dismissed";

type CardBadgeProps = {
  tone: CardBadgeTone;
};

const CARD_BADGE_CONFIG: Record<
  CardBadgeTone,
  {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    background: string;
    foreground: string;
  }
> = {
  "needs-input": {
    label: "NEEDS INPUT",
    icon: "alert-circle",
    background: "#FEF3C7",
    foreground: "#92400E",
  },
  added: {
    label: "ADDED",
    icon: "checkmark-circle",
    background: "#DCFCE7",
    foreground: "#166534",
  },
  info: {
    label: "INFO",
    icon: "sparkles-outline",
    background: "#EFF6FF",
    foreground: "#1E40AF",
  },
  dismissed: {
    label: "DISMISSED",
    icon: "close-circle",
    background: "#F3F4F6",
    foreground: "#6B7280",
  },
};

const CardBadge = React.memo(function CardBadge({ tone }: CardBadgeProps) {
  const cfg = CARD_BADGE_CONFIG[tone];
  return (
    <View
      style={[
        styles.cardBadge,
        { backgroundColor: cfg.background },
      ]}
    >
      <Ionicons name={cfg.icon} size={12} color={cfg.foreground} />
      <Text style={[styles.cardBadgeText, { color: cfg.foreground }]}>
        {cfg.label}
      </Text>
    </View>
  );
});

/**
 * Detects "informational" Q&A assistant messages (e.g. a Gemini answer to a
 * question like "how many packs in a case?") so they can be rendered with the
 * INFO card variant instead of the regular assistant pill. A message qualifies
 * when none of the list-shaped result fields carry content — i.e. the message
 * is purely conversational.
 */
function isQaAnswerMessage(message: QuickOrderMessage): boolean {
  if (message.role !== "assistant") return false;
  if (!message.text || !message.text.trim()) return false;
  if (message.parsedItems && message.parsedItems.length > 0) return false;
  if (message.pendingClarifications && message.pendingClarifications.length > 0) return false;
  if (message.suggestions && message.suggestions.length > 0) return false;
  if (message.stockUpdates && message.stockUpdates.length > 0) return false;
  if (message.recommendations && message.recommendations.length > 0) return false;
  if (message.safetyWarnings && message.safetyWarnings.length > 0) return false;
  if (message.blockedOperations && message.blockedOperations.length > 0) return false;
  if (message.flags && message.flags.length > 0) return false;
  return true;
}

type InfoCardProps = {
  text: string;
  onLayout?: (event: LayoutChangeEvent) => void;
};

const InfoCard = React.memo(function InfoCard({ text, onLayout }: InfoCardProps) {
  const ds = useScaledStyles();
  const safe = sanitizeAssistantReply(
    text,
    "I had trouble reading that order. Please try again or add the items manually.",
  );
  return (
    <Animated.View
      onLayout={onLayout}
      entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
      style={[
        styles.chatWhiteCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(14),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <CardBadge tone="info" />
      <Text
        style={[
          styles.chatWhiteCardText,
          { fontSize: ds.fontSize(15), marginTop: ds.spacing(10) },
        ]}
      >
        {renderInlineMarkdown(safe)}
      </Text>
    </Animated.View>
  );
});

const AIResponsePill = React.memo(function AIResponsePill({
  message,
  onLayout,
}: AIResponsePillProps) {
  const ds = useScaledStyles();
  const pill = getAssistantPill(message);
  // Defensive: a flag/reply that somehow carries technical text never reaches the user.
  const text = sanitizeAssistantReply(
    pill.text,
    "I had trouble reading that order. Please try again or add the items manually.",
  );

  return (
    <Animated.View
      onLayout={onLayout}
      entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
      style={[
        styles.aiPill,
        pill.tone === "caution" && styles.aiPillCaution,
        pill.tone === "success" && styles.aiPillSuccess,
        {
          borderRadius: ds.radius(20),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(10),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons name={pill.icon} size={pill.tone === "caution" ? 20 : 16} color={pill.color} />
      <Text style={[
        styles.aiPillText,
        pill.tone === "caution" && styles.aiPillTextCaution,
        { fontSize: ds.fontSize(16) },
      ]}>
        {renderInlineMarkdown(text)}
      </Text>
    </Animated.View>
  );
});

type ClarificationCardProps = {
  clarification: PendingQuickOrderClarification;
  confirmed?: boolean;
  dismissed?: boolean;
  confirmedLabel?: string;
  onAction: (
    clarification: PendingQuickOrderClarification,
    action: PendingQuickOrderClarification["actions"][number],
  ) => void;
  onReject: (clarification: PendingQuickOrderClarification) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

const ClarificationCard = React.memo(function ClarificationCard({
  clarification,
  confirmed = false,
  dismissed = false,
  confirmedLabel,
  onAction,
  onReject,
  onLayout,
}: ClarificationCardProps) {
  const ds = useScaledStyles();

  if (confirmed) {
    const rawLabel = confirmedLabel ?? `Added ${clarification.item_name ?? ""}`.trim();
    const labelWithBold = boldifyTerm(rawLabel, clarification.item_name);
    return (
      <View
        onLayout={onLayout}
        style={[
          styles.chatWhiteCard,
          {
            borderRadius: ds.radius(16),
            padding: ds.spacing(14),
            marginTop: ds.spacing(10),
          },
        ]}
      >
        <CardBadge tone="added" />
        <Text
          style={[
            styles.chatWhiteCardText,
            { fontSize: ds.fontSize(15), marginTop: ds.spacing(10) },
          ]}
          numberOfLines={2}
        >
          {renderInlineMarkdown(labelWithBold)}
        </Text>
      </View>
    );
  }

  if (dismissed) {
    return (
      <View
        onLayout={onLayout}
        style={[
          styles.chatDismissedPillCard,
          {
            borderRadius: ds.radius(16),
            padding: ds.spacing(12),
            marginTop: ds.spacing(10),
          },
        ]}
      >
        <CardBadge tone="dismissed" />
      </View>
    );
  }

  const hasActions = clarification.actions.length > 0;
  const messageWithBold = boldifyTerm(
    clarification.message,
    clarification.item_name,
  );

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.chatWhiteCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(14),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <CardBadge tone="needs-input" />
      <Text
        style={[
          styles.chatWhiteCardText,
          { fontSize: ds.fontSize(15), marginTop: ds.spacing(10) },
        ]}
      >
        {renderInlineMarkdown(messageWithBold)}
      </Text>
      {hasActions ? (
        <NeedsInputActionButtons
          primaryActions={clarification.actions.map((action, index) => ({
            key: `${clarification.id}:${action.id}:${action.existing_item_key ?? ""}`,
            label:
              clarification.actions.length === 1 && index === 0
                ? "Use this"
                : action.preview
                  ? `${action.label} — ${action.preview}`
                  : action.label,
            accessibilityLabel: action.label,
            onPress: () => onAction(clarification, action),
          }))}
          onReject={() => onReject(clarification)}
        />
      ) : null}
    </View>
  );
});

type SuggestionCardProps = {
  suggestion: QuickOrderSuggestion;
  onAdd: (suggestion: QuickOrderSuggestion) => void | Promise<void>;
  onReject: (suggestion: QuickOrderSuggestion) => void | Promise<void>;
  onLayout?: (event: LayoutChangeEvent) => void;
};

function getSuggestionItems(
  suggestion: QuickOrderSuggestion,
): NonNullable<QuickOrderSuggestion["items"]> {
  if (suggestion.items?.length) return suggestion.items;
  if (!suggestion.item_id || !suggestion.item_name) return [];
  return [
    {
      item_id: suggestion.item_id,
      item_name: suggestion.item_name,
      quantity: suggestion.suggested_qty ?? 1,
      unit: suggestion.unit ?? null,
      unit_type: suggestion.unit_type,
    },
  ];
}

type SuggestionDecision = "pending" | "accepted" | "rejected";

const SuggestionCard = React.memo(function SuggestionCard({
  suggestion,
  onAdd,
  onReject,
  onLayout,
}: SuggestionCardProps) {
  const ds = useScaledStyles();
  const [decision, setDecision] = useState<SuggestionDecision>("pending");
  const items = getSuggestionItems(suggestion);
  const title = suggestion.title ?? suggestion.item_name ?? "Suggestion";
  const addedTitle = items.length === 1 ? items[0].item_name : title;
  const addedUnit = items.length === 1 ? items[0].unit ?? null : null;
  const addedQty = items.length === 1 ? items[0].quantity ?? 1 : null;
  const message =
    suggestion.message ??
    suggestion.reason ??
    items
      .map((item) => item.item_name)
      .slice(0, 3)
      .join(", ");

  const handleAdd = useCallback(() => {
    if (decision !== "pending") return;
    void triggerSelectionHaptic();
    setDecision("accepted");
    void onAdd(suggestion);
  }, [decision, onAdd, suggestion]);

  const handleReject = useCallback(() => {
    if (decision !== "pending") return;
    void triggerSelectionHaptic();
    setDecision("rejected");
    void onReject(suggestion);
  }, [decision, onReject, suggestion]);

  if (decision === "accepted") {
    const addedLabel =
      addedQty != null
        ? `Added ${addedQty}${addedUnit ? ` ${addedUnit}` : ""} of ${addedTitle}`
        : `Added ${addedTitle}`;
    const labelWithBold = boldifyTerm(addedLabel, addedTitle);
    return (
      <Animated.View
        layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
        onLayout={onLayout}
        style={[
          styles.chatWhiteCard,
          {
            borderRadius: ds.radius(16),
            padding: ds.spacing(14),
            marginTop: ds.spacing(10),
          },
        ]}
      >
        <CardBadge tone="added" />
        <Text
          style={[
            styles.chatWhiteCardText,
            { fontSize: ds.fontSize(15), marginTop: ds.spacing(10) },
          ]}
          numberOfLines={2}
        >
          {renderInlineMarkdown(labelWithBold)}
        </Text>
      </Animated.View>
    );
  }

  if (decision === "rejected") {
    return (
      <Animated.View
        layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
        onLayout={onLayout}
        style={[
          styles.chatDismissedPillCard,
          {
            borderRadius: ds.radius(16),
            padding: ds.spacing(12),
            marginTop: ds.spacing(10),
          },
        ]}
      >
        <CardBadge tone="dismissed" />
      </Animated.View>
    );
  }

  const messageWithBold = boldifyTerm(message, addedTitle);

  return (
    <Animated.View
      layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
      onLayout={onLayout}
      style={[
        styles.chatWhiteCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(14),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <CardBadge tone="needs-input" />
      <Text
        style={[
          styles.chatWhiteCardText,
          { fontSize: ds.fontSize(15), marginTop: ds.spacing(10) },
        ]}
      >
        {renderInlineMarkdown(messageWithBold || title)}
      </Text>
      <NeedsInputActionButtons
        primaryActions={[
          {
            key: `${suggestion.item_id ?? title}:use`,
            label: "Use this",
            accessibilityLabel: `Use ${title}`,
            onPress: handleAdd,
          },
        ]}
        onReject={handleReject}
        rejectAccessibilityLabel={`Reject ${title}`}
      />
    </Animated.View>
  );
});

const SafetyWarningCard = React.memo(function SafetyWarningCard({
  warning,
  onLayout,
}: {
  warning: QuickOrderSafetyWarning;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  const blocked = warning.severity === "blocked";
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.noticeCard,
        blocked ? styles.blockedCard : styles.warningCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons
        name={blocked ? "ban-outline" : "warning-outline"}
        size={ds.icon(18)}
        color={blocked ? colors.statusRed : colors.statusAmber}
      />
      <Text style={[styles.noticeText, { fontSize: ds.fontSize(14) }]}>
        {warning.message}
      </Text>
    </View>
  );
});

const BlockedOperationCard = React.memo(function BlockedOperationCard({
  operation,
  onLayout,
}: {
  operation: QuickOrderBlockedOperation;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.noticeCard,
        styles.blockedCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons name="ban-outline" size={ds.icon(18)} color={colors.statusRed} />
      <Text style={[styles.noticeText, { fontSize: ds.fontSize(14) }]}>
        {operation.message}
      </Text>
    </View>
  );
});

const StockUpdateCard = React.memo(function StockUpdateCard({
  updates,
  onLayout,
}: {
  updates: QuickOrderStockUpdate[];
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  if (updates.length === 0) return null;
  const visibleUpdates = updates.slice(0, 4);
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.noticeCard,
        styles.stockCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons name="clipboard-outline" size={ds.icon(18)} color={colors.primary} />
      <View style={[styles.stockTextCluster, { marginLeft: ds.spacing(8), gap: ds.spacing(4) }]}>
        <Text style={[styles.stockTitle, { fontSize: ds.fontSize(13) }]}>
          Current stock
        </Text>
        {visibleUpdates.map((update, index) => (
          <Text
            key={`${update.item_id}:${update.original_text}:${index}`}
            style={[styles.stockRowText, { fontSize: ds.fontSize(14) }]}
          >
            {update.item_name} {update.quantity}
            {update.unit ? ` ${update.unit}` : ""}
          </Text>
        ))}
        {updates.length > 4 ? (
          <Text style={[styles.stockMoreText, { fontSize: ds.fontSize(12) }]}>
            +{updates.length - 4} more
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const RecommendationCard = React.memo(function RecommendationCard({
  recommendations,
  onAdd,
  onLayout,
}: {
  recommendations: QuickOrderRecommendation[];
  onAdd: (recommendations: QuickOrderRecommendation[]) => void | Promise<void>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  const [isAdded, setIsAdded] = useState(false);

  const handleAdd = useCallback(() => {
    if (isAdded) return;
    void triggerSelectionHaptic();
    setIsAdded(true);
    void onAdd(recommendations);
  }, [isAdded, onAdd, recommendations]);

  if (recommendations.length === 0) return null;

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.recommendationCard,
        isAdded && styles.suggestionCardAdded,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <View style={styles.suggestionHeader}>
        <Ionicons name="sparkles-outline" size={ds.icon(18)} color={colors.primary} />
        <View style={styles.suggestionTextCluster}>
          <Text style={[styles.suggestionTitle, { fontSize: ds.fontSize(15) }]}>
            Suggested order
          </Text>
          <Text style={[styles.suggestionMessage, { fontSize: ds.fontSize(13) }]}>
            {recommendations
              .slice(0, 4)
              .map((item) => `${item.item_name} ${item.suggested_quantity}${item.unit ? ` ${item.unit}` : ""}`)
              .join(" · ")}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add suggested order"
        accessibilityState={{ selected: isAdded }}
        onPress={handleAdd}
        style={({ pressed }) => [
          styles.suggestionButton,
          {
            borderRadius: ds.radius(12),
            paddingHorizontal: ds.spacing(12),
            paddingVertical: ds.spacing(8),
            marginTop: ds.spacing(10),
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        <Text style={[styles.suggestionButtonText, { fontSize: ds.fontSize(13) }]}>
          {isAdded ? "Added" : "Add suggestions"}
        </Text>
      </Pressable>
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
  const addToCart = useOrderStore((state) => state.addToCart);
  const router = useRouter();
  const { location } = useResolvedActiveLocation();
  const tabBarHeight = 60 + getTabBarBottomInset(insets.bottom);

  const [composerHeight, setComposerHeight] = useState(0);
  const [composerBottomOffset, setComposerBottomOffset] =
    useState(tabBarHeight);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuickOrderMessage[]>([]);
  const [parsedItems, setParsedItems] = useState<ParsedQuickOrderItem[]>([]);
  const [pendingClarifications, setPendingClarifications] = useState<
    PendingQuickOrderClarification[]
  >([]);
  const [confirmedClarifications, setConfirmedClarifications] = useState<
    Record<string, string>
  >({});
  const [dismissedClarifications, setDismissedClarifications] = useState<
    Record<string, true>
  >({});
  const [inventoryItems, setInventoryItems] = useState<
    QuickOrderInventoryItem[]
  >([]);
  const [editingState, setEditingState] = useState<EditingState | null>(null);
  const [quantityFlow, setQuantityFlow] = useState<QuantityFlowState | null>(
    null,
  );
  const [isQuantitySaving, setIsQuantitySaving] = useState(false);
  const [quantitySuggestions, setQuantitySuggestions] = useState<
    Map<string, PreviousQuantitySuggestion>
  >(() => new Map());
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [liveVoiceTranscript, setLiveVoiceTranscript] = useState("");
  const [finalVoiceTranscript, setFinalVoiceTranscript] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [floatingCardHeight, setFloatingCardHeight] = useState(() =>
    ds.spacing(INITIAL_CARD_HEIGHT_ESTIMATE),
  );
  const lastUserTextRef = useRef("");
  const requestGenerationRef = useRef(0);
  const isSendingRef = useRef(false);
  const isConfirmingRef = useRef(false);
  const quickOrderPendingOrderIdRef = useRef<string | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScrollFrameRef = useRef<number | null>(null);
  const chatScrollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chatInteractionHandlesRef = useRef<{ cancel?: () => void }[]>([]);
  const chatUserScrollEndTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUserScrollingChatRef = useRef(false);
  const chatScrollMetricsRef = useRef<ChatScrollMetrics>({
    contentHeight: 0,
    visibleHeight: 0,
    offsetY: 0,
  });
  const isChatNearBottomRef = useRef(true);
  const lastChatSnapReasonRef = useRef("initial");

  const userId = user?.id ?? null;
  const locationId = location?.id ?? null;
  const isOrderBusy = isSending || isConfirming;
  const voiceEnabled =
    process.env.EXPO_PUBLIC_ENABLE_QUICK_ORDER_VOICE === "true" &&
    ExpoSpeechRecognitionModule != null;

  const updateChatStickiness = useCallback((active = false) => {
    const next = shouldAutoStickToBottom({
      active,
      ...chatScrollMetricsRef.current,
      threshold: CHAT_NEAR_BOTTOM_THRESHOLD,
    });
    isChatNearBottomRef.current = next;
    return next;
  }, []);

  const scrollChatToEnd = useCallback((animated = true) => {
    try {
      const targetOffset = calculateQuickOrderBottomScrollOffset(
        chatScrollMetricsRef.current,
      );
      chatScrollMetricsRef.current = {
        ...chatScrollMetricsRef.current,
        offsetY: targetOffset,
      };
      chatListRef.current?.scrollToOffset({
        offset: targetOffset,
        animated,
      });
    } catch {
      // The list can be momentarily empty / unmounted during keyboard or
      // layout transitions — a failed scroll there is harmless.
    }
  }, []);

  const scheduleChatScrollToEnd = useCallback(
    (
      reason: string,
      animated = true,
      delays: number[] = [0],
      options: ChatSnapOptions = {},
    ) => {
      const active = options.active ?? false;
      if (active) {
        isChatNearBottomRef.current = true;
      } else if (!isChatNearBottomRef.current) {
        return;
      }

      lastChatSnapReasonRef.current = reason;

      delays
        .map((delay) => Math.max(0, delay))
        .forEach((delay) => {
          const run = () => {
            if (chatScrollFrameRef.current != null) {
              cancelAnimationFrame(chatScrollFrameRef.current);
            }
            chatScrollFrameRef.current = requestAnimationFrame(() => {
              chatScrollFrameRef.current = null;
              scrollChatToEnd(animated);
            });
          };
          const runWithOptionalInteraction = () => {
            if (!options.afterInteractions) {
              run();
              return;
            }

            const interaction = InteractionManager.runAfterInteractions(() => {
              chatInteractionHandlesRef.current =
                chatInteractionHandlesRef.current.filter(
                  (entry) => entry !== interaction,
                );
              run();
            }) as { cancel?: () => void };
            chatInteractionHandlesRef.current.push(interaction);
          };

          if (delay <= 0) {
            runWithOptionalInteraction();
            return;
          }

          const timer = setTimeout(() => {
            chatScrollTimersRef.current = chatScrollTimersRef.current.filter(
              (entry) => entry !== timer,
            );
            runWithOptionalInteraction();
          }, delay);
          chatScrollTimersRef.current.push(timer);
        });
    },
    [scrollChatToEnd],
  );

  const handleChatScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      chatScrollMetricsRef.current = {
        contentHeight: contentSize.height,
        visibleHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      };
      if (isUserScrollingChatRef.current) {
        updateChatStickiness(false);
      }
    },
    [updateChatStickiness],
  );

  const handleChatContentSizeChange = useCallback(
    (_: number, height: number) => {
      const wasSticking = isChatNearBottomRef.current;
      chatScrollMetricsRef.current = {
        ...chatScrollMetricsRef.current,
        contentHeight: height,
      };
      if (!wasSticking) return;
      scheduleChatScrollToEnd("content-size", true, [0, 80], {
        afterInteractions: true,
      });
    },
    [scheduleChatScrollToEnd],
  );

  const handleChatLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const wasSticking = isChatNearBottomRef.current;
      chatScrollMetricsRef.current = {
        ...chatScrollMetricsRef.current,
        visibleHeight: event.nativeEvent.layout.height,
      };
      if (!wasSticking) return;
      scheduleChatScrollToEnd("chat-layout", false, [0, 80], {
        afterInteractions: true,
      });
    },
    [scheduleChatScrollToEnd],
  );

  const handleMessageLayout = useCallback(() => {
    scheduleChatScrollToEnd("message-layout", true, [0, 80], {
      afterInteractions: true,
    });
  }, [scheduleChatScrollToEnd]);

  useEffect(() => {
    if (!userId || !locationId) {
      requestGenerationRef.current += 1;
      isSendingRef.current = false;
      setIsSending(false);
      setSessionId(null);
      setMessages([]);
      setConfirmedClarifications({});
      setDismissedClarifications({});
      setParsedItems([]);
      setPendingClarifications([]);
      setSessionLoadError(null);
      return;
    }

    let cancelled = false;
    requestGenerationRef.current += 1;

    async function loadActiveSession() {
      try {
        setIsLoadingSession(true);
        setSessionLoadError(null);
        const { data, error } = await supabase
          .from("quick_order_sessions")
          .select("id, messages, parsed_items")
          .eq("user_id", userId)
          .eq("location_id", locationId)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cancelled) return;
        if (error) throw error;

        const row = data as QuickOrderSessionRow | null;
        const nextMessages = Array.isArray(row?.messages)
          ? mapPersistedMessages(row.messages)
          : [];
        setSessionId(row?.id ?? null);
        setMessages(nextMessages);
        setParsedItems(normalizeParsedItems(row?.parsed_items));
        setPendingClarifications(
          nextMessages.flatMap(
            (message) => message.pendingClarifications ?? [],
          ).filter(isCartBlockingClarification),
        );
      } catch (error) {
        console.warn("[QuickOrder] Failed to load active session:", error);
        if (!cancelled) {
          setSessionId(null);
          setMessages([]);
          setConfirmedClarifications({});
      setDismissedClarifications({});
          setParsedItems([]);
          setPendingClarifications([]);
          setSessionLoadError(
            "Couldn't load your Quick Order session. Check your connection and try again.",
          );
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

  const retrySessionLoad = useCallback(() => {
    if (!userId || !locationId || isLoadingSession) return;
    requestGenerationRef.current += 1;

    void (async () => {
      try {
        setIsLoadingSession(true);
        setSessionLoadError(null);
        const { data, error } = await supabase
          .from("quick_order_sessions")
          .select("id, messages, parsed_items")
          .eq("user_id", userId)
          .eq("location_id", locationId)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        const row = data as QuickOrderSessionRow | null;
        const nextMessages = Array.isArray(row?.messages)
          ? mapPersistedMessages(row.messages)
          : [];
        setSessionId(row?.id ?? null);
        setMessages(nextMessages);
        setParsedItems(normalizeParsedItems(row?.parsed_items));
        setPendingClarifications(
          nextMessages.flatMap(
            (message) => message.pendingClarifications ?? [],
          ).filter(isCartBlockingClarification),
        );
      } catch (error) {
        console.warn("[QuickOrder] Failed to reload active session:", error);
        setSessionLoadError(
          "Couldn't load your Quick Order session. Check your connection and try again.",
        );
      } finally {
        setIsLoadingSession(false);
      }
    })();
  }, [isLoadingSession, locationId, userId]);

  useEffect(
    () => () => {
      if (chatScrollFrameRef.current != null) {
        cancelAnimationFrame(chatScrollFrameRef.current);
      }
      chatScrollTimersRef.current.forEach(clearTimeout);
      chatScrollTimersRef.current = [];
      chatInteractionHandlesRef.current.forEach((handle) => handle.cancel?.());
      chatInteractionHandlesRef.current = [];
      if (chatUserScrollEndTimerRef.current) {
        clearTimeout(chatUserScrollEndTimerRef.current);
      }
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!voiceEnabled || !ExpoSpeechRecognitionModule) return;

    const subscriptions = [
      ExpoSpeechRecognitionModule.addListener("start", () => {
        setIsVoiceListening(true);
        setVoiceError(null);
      }),
      ExpoSpeechRecognitionModule.addListener("end", () => {
        setIsVoiceListening(false);
      }),
      ExpoSpeechRecognitionModule.addListener("result", (event: any) => {
        const transcript = event?.results?.[0]?.transcript ?? "";
        if (event?.isFinal) {
          setFinalVoiceTranscript(transcript);
          setLiveVoiceTranscript("");
        } else {
          setLiveVoiceTranscript(transcript);
        }
      }),
      ExpoSpeechRecognitionModule.addListener("error", () => {
        setIsVoiceListening(false);
        setVoiceError("I had trouble hearing that. Try again.");
      }),
    ];

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      try {
        ExpoSpeechRecognitionModule?.abort();
      } catch {
        // The native module can already be stopped during unmount.
      }
    };
  }, [voiceEnabled]);

  const issueCount = useMemo(
    () => countUnresolvedItems(parsedItems) + pendingClarifications.length,
    [parsedItems, pendingClarifications.length],
  );

  const showWelcomeMessage = useMemo(
    () =>
      !isLoadingSession &&
      !sessionLoadError &&
      shouldShowQuickOrderWelcomeMessage(parsedItems.length, messages),
    [isLoadingSession, messages, parsedItems.length, sessionLoadError],
  );

  const displayMessages = useMemo(
    () =>
      buildQuickOrderDisplayMessages(
        messages,
        showWelcomeMessage,
        createQuickOrderWelcomeMessage,
      ),
    [messages, showWelcomeMessage],
  );

  // Re-snap to the newest message whenever something that affects layout below
  // it changes: a new message, the parsed-item list (which grows the floating
  // card / top spacer), the composer growing for multiline text, the card
  // height, or a send completing.
  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      scheduleChatScrollToEnd("layout-state-change", true, [0, 80], {
        afterInteractions: true,
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [
    isSending,
    composerBottomOffset,
    composerHeight,
    displayMessages.length,
    parsedItems,
    floatingCardHeight,
    scheduleChatScrollToEnd,
  ]);

  const chatContentStyle = useMemo(
    () => ({
      paddingBottom: calculateQuickOrderBottomPadding({
        composerBottomOffset,
        composerHeight,
        gap: ds.spacing(14),
      }),
    }),
    [composerBottomOffset, ds, composerHeight],
  );

  // The chat FlatList reserves a top spacer equal to the floating card's measured
  // height (plus a small gap) so the first message is never trapped behind the card.
  // The spacer is animated via a shared value (rather than a layout transition,
  // which is unsupported inside virtualized-list internals) so it grows/shrinks in
  // step with the card whenever items are added or the card expands/collapses.
  const chatTopSpacerTarget = floatingCardHeight + ds.spacing(CARD_TO_CHAT_GAP);
  const chatTopSpacerHeight = useSharedValue(chatTopSpacerTarget);
  useEffect(() => {
    chatTopSpacerHeight.value = withTiming(chatTopSpacerTarget, CARD_TIMING);
    scheduleChatScrollToEnd(
      "order-card-height",
      true,
      [0, CARD_TIMING.duration + 80],
      {
        active: true,
        afterInteractions: true,
      },
    );
  }, [chatTopSpacerHeight, chatTopSpacerTarget, scheduleChatScrollToEnd]);
  const chatTopSpacerStyle = useAnimatedStyle(() => ({
    height: chatTopSpacerHeight.value,
  }));

  const persistSession = useCallback(
    async (
      nextSessionId: string,
      nextMessages: QuickOrderMessage[],
      nextParsedItems: ParsedQuickOrderItem[],
    ) => {
      const { error } = await supabase
        .from("quick_order_sessions")
        .update({
          messages: nextMessages
            .map(buildPersistedMessage)
            .filter((message): message is PersistedQuickOrderMessage => message != null),
          parsed_items: nextParsedItems,
          status: "active",
        })
        .eq("id", nextSessionId);

      if (error) {
        throw error;
      }
    },
    [],
  );

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    if (!userId || !locationId) {
      throw new Error("Choose a location before using Quick Order.");
    }

    const { data, error } = await supabase
      .from("quick_order_sessions")
      .insert({
        location_id: locationId,
        user_id: userId,
        status: "active",
        messages: [],
        parsed_items: [],
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    const nextSessionId = String((data as { id: string }).id);
    setSessionId(nextSessionId);
    return nextSessionId;
  }, [locationId, sessionId, userId]);

  const handleToggleLocationDropdown = useCallback(() => {
    if (isOrderBusy) return;
    setLocationDropdownOpen((current) => !current);
  }, [isOrderBusy]);

  const handleCloseLocationDropdown = useCallback(() => {
    setLocationDropdownOpen(false);
  }, []);

  const clearChatUserScrollEndTimer = useCallback(() => {
    if (!chatUserScrollEndTimerRef.current) return;
    clearTimeout(chatUserScrollEndTimerRef.current);
    chatUserScrollEndTimerRef.current = null;
  }, []);

  const updateChatMetricsFromEvent = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      chatScrollMetricsRef.current = {
        contentHeight: contentSize.height,
        visibleHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      };
      return updateChatStickiness(false);
    },
    [updateChatStickiness],
  );

  const handleChatScrollBeginDrag = useCallback(() => {
    handleCloseLocationDropdown();
    clearChatUserScrollEndTimer();
    isUserScrollingChatRef.current = true;
  }, [clearChatUserScrollEndTimer, handleCloseLocationDropdown]);

  const handleChatMomentumScrollBegin = useCallback(() => {
    clearChatUserScrollEndTimer();
    isUserScrollingChatRef.current = true;
  }, [clearChatUserScrollEndTimer]);

  const handleChatScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateChatMetricsFromEvent(event);
      clearChatUserScrollEndTimer();
      chatUserScrollEndTimerRef.current = setTimeout(() => {
        isUserScrollingChatRef.current = false;
        chatUserScrollEndTimerRef.current = null;
      }, 160);
    },
    [clearChatUserScrollEndTimer, updateChatMetricsFromEvent],
  );

  const handleChatMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateChatMetricsFromEvent(event);
      clearChatUserScrollEndTimer();
      isUserScrollingChatRef.current = false;
    },
    [clearChatUserScrollEndTimer, updateChatMetricsFromEvent],
  );

  const handleSelectLocation = useCallback(
    (next: Location) => {
      if (isOrderBusy) return;
      if (next.id === location?.id) return;
      setAuthLocation(next);
    },
    [isOrderBusy, location?.id, setAuthLocation],
  );

  const handleClear = useCallback(async () => {
    if (isOrderBusy) return;
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
    setMessages([]);
    setConfirmedClarifications({});
      setDismissedClarifications({});
    setParsedItems([]);
    setPendingClarifications([]);
    setEditingState(null);
    setQuantityFlow(null);
    setQuantitySuggestions(new Map());
    setLiveVoiceTranscript("");
    setFinalVoiceTranscript(null);
    setVoiceError(null);
    setIsVoiceListening(false);
    setNudgeSent(false);

    if (sessionId) {
      try {
        await supabase
          .from("quick_order_sessions")
          .update({
            status: "abandoned",
            messages: [],
            parsed_items: [],
          })
          .eq("id", sessionId);
      } catch (error) {
        console.warn("[QuickOrder] Failed to abandon session:", error);
      } finally {
        setSessionId(null);
      }
    }
  }, [sessionId]);

  const handleClearRequest = useCallback(() => {
    if (isOrderBusy) return;
    Alert.alert("Clear current order?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          void handleClear();
        },
      },
    ]);
  }, [handleClear, isOrderBusy]);

  const loadInventoryItems = useCallback(async () => {
    if (inventoryItems.length > 0) return inventoryItems;

    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,name,base_unit,pack_unit,allowed_units")
      .eq("active", true)
      .order("name", { ascending: true })
      .limit(1000);

    if (error) throw error;
    const nextItems = (data ?? []) as QuickOrderInventoryItem[];
    setInventoryItems(nextItems);
    return nextItems;
  }, [inventoryItems]);

  const handleEditItem = useCallback(
    (item: ParsedQuickOrderItem) => {
      setEditingState({
        original: item,
        key: getParsedItemKey(item),
        isSaving: false,
      });
      loadInventoryItems().catch((error) => {
        console.warn("[QuickOrder] Failed to load editor inventory:", error);
      });
    },
    [loadInventoryItems],
  );

  const handleCloseEditModal = useCallback(() => {
    setEditingState((current) => (current?.isSaving ? current : null));
    scheduleChatScrollToEnd("edit-modal-close", true, [0, 120, 260], {
      active: true,
      afterInteractions: true,
    });
  }, [scheduleChatScrollToEnd]);

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

      setEditingState((current) =>
        current ? { ...current, isSaving: true } : current,
      );

      // Best-effort parser-correction logging — only when a real inventory row
      // is attached and we have the ids the table requires.
      const rawToken = (
        editing.original.raw_token || getParsedItemDisplayName(editing.original)
      ).trim();
      if (
        result.inventoryItem &&
        isUuid(result.inventoryItem.id) &&
        isUuid(userId) &&
        rawToken
      ) {
        try {
          await supabase.from("parser_corrections").insert({
            session_id: isUuid(sessionId) ? sessionId : null,
            user_id: userId,
            location_id: isUuid(locationId) ? locationId : null,
            raw_token: rawToken,
            parser_suggested_item_id: isUuid(editing.original.item_id)
              ? editing.original.item_id
              : null,
            user_corrected_item_id: result.inventoryItem.id,
            user_corrected_qty: result.quantity,
            user_corrected_unit: trimmedUnit || null,
            correction_type: editing.original.unresolved
              ? "manual_item_match"
              : "unit",
          });
        } catch (error) {
          console.warn("[QuickOrder] Failed to log parser correction:", error);
        }
      }

      const nextParsedItems = updateParsedItem(parsedItems, editing.key, patch);
      const nextMessages = patchMessageItems(messages, editing.key, patch);

      setParsedItems((current) => updateParsedItem(current, editing.key, patch));
      setMessages((current) => patchMessageItems(current, editing.key, patch));
      setEditingState(null);
      loadQuantitySuggestions([result.itemId]);
      scheduleChatScrollToEnd("item-edit-saved", true, buildSendSnapDelays(), {
        active: true,
        afterInteractions: true,
      });

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, nextParsedItems);
        } catch (error) {
          console.warn("[QuickOrder] Failed to persist item edit:", error);
        }
      }
    },
    [
      editingState,
      locationId,
      messages,
      parsedItems,
      persistSession,
      scheduleChatScrollToEnd,
      sessionId,
      userId,
    ],
  );

  const handleRemoveEditedItem = useCallback(() => {
    const editing = editingState;
    if (!editing) return;

    Alert.alert(
      `Remove ${getParsedItemDisplayName(editing.original)}?`,
      "It will be taken off this order.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            const nextParsedItems = removeParsedItem(parsedItems, editing.key);
            const nextMessages = removeMessageItems(messages, editing.key);
            setParsedItems(nextParsedItems);
            setMessages(nextMessages);
            setEditingState(null);
            scheduleChatScrollToEnd(
              "item-removed",
              true,
              buildSendSnapDelays(),
              {
                active: true,
                afterInteractions: true,
              },
            );
            if (sessionId) {
              persistSession(sessionId, nextMessages, nextParsedItems).catch(
                (error) => {
                  console.warn(
                    "[QuickOrder] Failed to persist item removal:",
                    error,
                  );
                },
              );
            }
          },
        },
      ],
    );
  }, [
    editingState,
    messages,
    parsedItems,
    persistSession,
    scheduleChatScrollToEnd,
    sessionId,
  ]);

  /** Loads prior-order quantity suggestions for the given items and merges them in. */
  const loadQuantitySuggestions = useCallback(
    (itemIds: (string | null | undefined)[]) => {
      const ids = itemIds.filter((id): id is string =>
        Boolean(id && id.trim()),
      );
      if (ids.length === 0) return;
      void fetchPreviousQuantitySuggestions({
        userId,
        locationId,
        itemIds: ids,
      }).then((map) => {
        if (map.size === 0) return;
        setQuantitySuggestions((current) => {
          const next = new Map(current);
          map.forEach((value, key) => next.set(key, value));
          return next;
        });
      });
    },
    [locationId, userId],
  );

  /**
   * Row "fix" action for an item missing its quantity. Opens the focused
   * quantity sheet at the tapped item; when several rows need a quantity the
   * sheet becomes a multi-step "Item N of M" walk-through.
   */
  const handleResolveQuantity = useCallback(
    (item: ParsedQuickOrderItem) => {
      const queue = getQuantityFixQueue(parsedItems);
      const tappedKey = getParsedItemKey(item);
      if (queue.length === 0) {
        setEditingState({
          original: item,
          key: tappedKey,
          isSaving: false,
        });
        loadQuantitySuggestions([item.item_id]);
        loadInventoryItems().catch((error) => {
          console.warn("[QuickOrder] Failed to load editor inventory:", error);
        });
        return;
      }
      const index = Math.max(0, queue.indexOf(tappedKey));
      setQuantityFlow({ queue, index });
      loadQuantitySuggestions(
        queue.map(
          (key) => parsedItems.find((p) => getParsedItemKey(p) === key)?.item_id,
        ),
      );
      loadInventoryItems().catch((error) => {
        console.warn("[QuickOrder] Failed to load editor inventory:", error);
      });
    },
    [loadInventoryItems, loadQuantitySuggestions, parsedItems],
  );

  const quantityQueueItems = useMemo<
    (QuickOrderQuantitySheetItem | null)[]
  >(() => {
    if (!quantityFlow) return [];
    const inventoryById = new Map(
      inventoryItems.map((row) => [row.id, row] as const),
    );
    return quantityFlow.queue.map((key) => {
      const item = parsedItems.find((p) => getParsedItemKey(p) === key);
      if (!item) return null;
      const inventoryItem = item.item_id
        ? inventoryById.get(item.item_id) ?? null
        : null;
      const suggestion = item.item_id
        ? quantitySuggestions.get(item.item_id) ?? null
        : null;
      return { item, inventoryItem, suggestion };
    });
  }, [quantityFlow, parsedItems, inventoryItems, quantitySuggestions]);

  const handleQuantityApply = useCallback(
    async (result: QuickOrderQuantityResult) => {
      const flow = quantityFlow;
      if (!flow) return;
      const key = flow.queue[flow.index];
      if (!key) return;
      setIsQuantitySaving(true);
      try {
        const trimmedUnit = result.unit.trim();
        const patch: Partial<ParsedQuickOrderItem> = {
          quantity: result.quantity,
          unit: trimmedUnit || null,
        };
        const nextParsed = updateParsedItem(parsedItems, key, patch);
        const nextMessages = patchMessageItems(messages, key, patch);
        setParsedItems(nextParsed);
        setMessages(nextMessages);
        const next = advanceQuantityFlow(flow);
        setQuantityFlow(next ? { ...flow, index: next.index } : null);
        scheduleChatScrollToEnd(
          "quantity-applied",
          true,
          buildSendSnapDelays(),
          {
            active: true,
            afterInteractions: true,
          },
        );
        if (sessionId) {
          try {
            await persistSession(sessionId, nextMessages, nextParsed);
          } catch (error) {
            console.warn(
              "[QuickOrder] Failed to persist quantity edit:",
              error,
            );
          }
        }
      } finally {
        setIsQuantitySaving(false);
      }
    },
    [
      messages,
      parsedItems,
      persistSession,
      quantityFlow,
      scheduleChatScrollToEnd,
      sessionId,
    ],
  );

  const handleQuantitySkip = useCallback(() => {
    setQuantityFlow((current) => {
      if (!current) return null;
      const next = advanceQuantityFlow(current);
      return next ? { ...current, index: next.index } : null;
    });
  }, []);

  const handleQuantityClose = useCallback(() => {
    if (isQuantitySaving) return;
    setQuantityFlow(null);
  }, [isQuantitySaving]);

  const appendErrorMessage = useCallback(
    async (
      baseMessages: QuickOrderMessage[],
      nextSessionId: string,
      errorCode?: string,
    ) => {
      const lastMsg = baseMessages[baseMessages.length - 1];
      const isRepeatError = lastMsg?.role === "error";

      const errorMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "error",
        text: isRepeatError
          ? "Still having trouble \u2014 tap to retry"
          : toFriendlyQuickOrderError(undefined, errorCode),
        createdAt: new Date().toISOString(),
        errorCode,
      };

      // Collapse consecutive identical errors
      const nextMessages = isRepeatError
        ? [...baseMessages.slice(0, -1), errorMessage]
        : [...baseMessages, errorMessage];

      setMessages(nextMessages);
      scheduleChatScrollToEnd(
        "error-message-appended",
        true,
        buildSendSnapDelays(),
        {
          active: true,
          afterInteractions: true,
        },
      );

      try {
        await persistSession(nextSessionId, nextMessages, parsedItems);
      } catch (error) {
        console.warn("[QuickOrder] Failed to persist error message:", error);
      }
    },
    [parsedItems, persistSession, scheduleChatScrollToEnd],
  );

  const handleSubmitMore = useCallback(
    async (
      rawTextInput: string,
      source: QuickOrderMessageSource = "typed",
      voiceMetadata?: {
        raw_transcript?: string;
        transcript_confidence?: number;
        language?: string;
      },
    ) => {
      // If the user typed a bare quantity ("1pk", "2 cases") and the most
      // recent item in the order is still missing a quantity, prepend that
      // item's name so the parser applies the quantity to the right line.
      const rawText = rewriteBareQuantityWithContext(
        rawTextInput,
        parsedItems,
      );
      const trimmed = rawText.trim();
      if (!trimmed || isSendingRef.current || isSending) {
        return;
      }

      if (!userId || !locationId) {
        const errorMessage: QuickOrderMessage = {
          id: createMessageId(),
          role: "error",
          text: "Choose a location before using Quick Order.",
          createdAt: new Date().toISOString(),
        };
        setMessages((current) => [...current, errorMessage]);
        scheduleChatScrollToEnd(
          "missing-location-error",
          true,
          buildSendSnapDelays(),
          {
            active: true,
            afterInteractions: true,
          },
        );
        return;
      }

      let netConnected = true;
      try {
        const netState = await NetInfo.fetch();
        netConnected = netState.isConnected !== false;
      } catch {
        netConnected = true;
      }

      if (!netConnected) {
        const offlineMessage: QuickOrderMessage = {
          id: createMessageId(),
          role: "error",
          text: "You're offline. Reconnect and try again.",
          createdAt: new Date().toISOString(),
          errorCode: "network_error",
        };
        setMessages((current) => [...current, offlineMessage]);
        scheduleChatScrollToEnd(
          "offline-error",
          true,
          buildSendSnapDelays(),
          {
            active: true,
            afterInteractions: true,
          },
        );
        return;
      }

      const requestGeneration = ++requestGenerationRef.current;
      isSendingRef.current = true;
      setIsSending(true);
      lastUserTextRef.current = rawText;

      // Cancel any pending nudge timer
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }

      const userMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "user",
        text: rawText,
        source,
        transcriptPreview: source === "voice" ? rawText : undefined,
        createdAt: new Date().toISOString(),
      };
      const optimisticMessages = [...messages, userMessage];
      setMessages(optimisticMessages);
      scheduleChatScrollToEnd(
        "send-optimistic-message",
        true,
        buildSendSnapDelays(),
        {
          active: true,
          afterInteractions: true,
        },
      );

      let activeSessionId = sessionId;

      try {
        activeSessionId = await ensureSession();
        await persistSession(activeSessionId, optimisticMessages, parsedItems);

        if (__DEV__) {
          console.log("[QuickOrder] Sending parse-order request", {
            message: devTextFingerprint(rawText),
            source,
            location_id: devIdFingerprint(locationId),
            session_id: devIdFingerprint(activeSessionId),
            user_id: devIdFingerprint(userId),
          });
        }

        const { data, error } = await supabase.functions.invoke("parse-order", {
          body: {
            source,
            message: rawText,
            raw_text: rawText,
            location_id: locationId,
            session_id: activeSessionId,
            user_id: userId,
            existing_items: parsedItems,
            recent_messages: optimisticMessages
              .slice(-12)
              .map(buildPersistedMessage)
              .filter(
                (message): message is PersistedQuickOrderMessage => message != null,
              ),
            voice_metadata:
              source === "voice"
                ? {
                    raw_transcript: voiceMetadata?.raw_transcript ?? rawText,
                    transcript_confidence:
                      voiceMetadata?.transcript_confidence,
                    language: voiceMetadata?.language ?? "en-US",
                  }
                : undefined,
          },
        });

        if (__DEV__) {
          console.log("[QuickOrder] Raw invoke result", {
            hasData: data != null,
            dataType: typeof data,
            hasError: error != null,
            errorMessage: error?.message,
            errorName: error?.name,
          });
        }

        if (error) {
          // Supabase functions.invoke returns FunctionsHttpError for non-2xx,
          // FunctionsRelayError for relay issues, FunctionsFetchError for network failures.
          const errorName = (error as { name?: string }).name ?? "";
          let errorCode = "ai_unavailable";
          if (errorName === "FunctionsHttpError") {
            // Try to extract the JSON body from the error response
            try {
              const errorBody =
                typeof error.context === "object" && error.context !== null
                  ? error.context
                  : typeof (error as { message?: string }).message === "string"
                    ? JSON.parse((error as { message: string }).message)
                    : null;
              if (
                errorBody &&
                typeof errorBody === "object" &&
                "code" in errorBody
              ) {
                errorCode = String((errorBody as Record<string, unknown>).code);
              }
            } catch {
              // Error body wasn't JSON — use default code
            }
          } else if (errorName === "FunctionsFetchError") {
            errorCode = "network_error";
          }
          console.warn(
            `[QuickOrder] parse-order invoke error: ${errorName}`,
          );
          if (activeSessionId) {
            if (requestGeneration === requestGenerationRef.current) {
              await appendErrorMessage(
                optimisticMessages,
                activeSessionId,
                errorCode,
              );
            }
          }
          return;
        }

        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }

        const response = normalizeQuickOrderParseResponse(data);

        if (__DEV__) {
          console.log("[QuickOrder] Normalized response", {
            status: response.status,
            parsedItems_length: response.parsedItems.length,
            pendingActions_length: response.pendingActions.length,
            flags_length: response.flags.length,
            stockUpdates_length: response.stockUpdates.length,
            recommendations_length: response.recommendations.length,
            safetyWarnings_length: response.safetyWarnings.length,
            blockedOperations_length: response.blockedOperations.length,
            assistantMessage: devTextFingerprint(response.assistantMessage),
            rawError: response.rawError,
            errorCode: response.errorCode,
            diagnostics: response.diagnostics,
          });
        }

        // Only short-circuit to error path if there are truly no items AND no actions AND no operations.
        // If the backend returned an error field but also returned parsed items or operations,
        // process them instead of discarding.
        if (
          response.rawError &&
          response.parsedItems.length === 0 &&
          response.pendingActions.length === 0 &&
          response.operations.length === 0
        ) {
          console.warn(
            `[QuickOrder] parse-order returned an error with no items: ${response.rawError}`,
          );
          const code = response.errorCode || "ai_unavailable";
          if (activeSessionId) {
            if (requestGeneration === requestGenerationRef.current) {
              await appendErrorMessage(optimisticMessages, activeSessionId, code);
            }
          }
          return;
        }

        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }

        // Apply operations first (remove/replace/update/clear).
        const operations = response.operations;
        const responseSuggestions = normalizeSuggestions(response.suggestions);
        // Auto-accept high-confidence single-alternative matches (e.g. "shrimp"
        // → "Shrimp (Frozen)") so the user doesn't have to confirm an obvious
        // suggestion. The matched item lands in the cart immediately and the
        // clarification card is dropped from the response.
        const autoResolved = autoResolveSingleAlternativeMatches(
          response.parsedItems,
          response.pendingActions,
        );
        const responseItems = autoResolved.items;
        const responseClarifications = autoResolved.clarifications;

        type ParseApplySnapshot = {
          nextParsedItems: ParsedQuickOrderItem[];
          assistantMessage: QuickOrderMessage;
          mergeResult: QuickOrderMergeResult;
          operationResult: QuickOrderOperationResult | null;
        };

        let applySnapshot: ParseApplySnapshot | undefined;

        setParsedItems((currentParsed) => {
          if (requestGeneration !== requestGenerationRef.current) {
            return currentParsed;
          }

          let operationResult: QuickOrderOperationResult | null = null;
          let operationBase = currentParsed;
          if (operations.length > 0) {
            operationResult = applyQuickOrderOperations(currentParsed, operations);
            operationBase = operationResult.items;
            if (__DEV__) {
              console.log("[QuickOrder] Operations applied", {
                operations_count: operations.length,
                applied: operationResult.appliedCount,
                removed: operationResult.removedCount,
                updated: operationResult.updatedCount,
                skipped: operationResult.skippedCount,
                items_after: operationBase.length,
              });
            }
          }

          const mergeResult = mergeQuickOrderParsedItemsDetailed(
            operationBase,
            responseItems,
          );

          if (__DEV__) {
            console.log("[QuickOrder] Merge result", {
              parsedItems_before: currentParsed.length,
              responseItems_count: responseItems.length,
              merge_added: mergeResult.addedCount,
              merge_updated: mergeResult.updatedCount,
              merge_review: mergeResult.reviewCount,
              nextParsedItems_count: mergeResult.items.length,
              pendingClarifications_count: responseClarifications.length,
            });
          }

          if (
            __DEV__ &&
            response.status === "ok" &&
            !hasQuickOrderStateChange(
              mergeResult,
              responseClarifications.length,
              operationResult,
            )
          ) {
            console.warn("[QuickOrder] Parser response produced no state change", {
              sessionId: devIdFingerprint(activeSessionId),
              locationId: devIdFingerprint(locationId),
              received: response.diagnostics.items_received,
              accepted: response.diagnostics.items_accepted,
              rejected: response.diagnostics.items_rejected,
            });
          }

          const assistantText = buildQuickOrderAssistantMessage({
            normalized: response,
            mergeResult,
            pendingCount: responseClarifications.length,
            operationResult,
          });
          const finalAssistantText =
            response.isBlocked ||
            response.isPartialSuccess ||
            response.stockUpdates.length > 0 ||
            response.recommendations.length > 0 ||
            response.safetyWarnings.length > 0 ||
            response.blockedOperations.length > 0
              ? response.displayMessage
              : assistantText;

          applySnapshot = {
            nextParsedItems: mergeResult.items,
            assistantMessage: {
              id: createMessageId(),
              role: "assistant",
              text: finalAssistantText,
              source,
              createdAt: new Date().toISOString(),
              parsedItems: responseItems,
              pendingClarifications: responseClarifications,
              flags: response.flags,
              suggestions: responseSuggestions,
              stockUpdates: response.stockUpdates,
              recommendations: response.recommendations,
              safetyWarnings: response.safetyWarnings,
              blockedOperations: response.blockedOperations,
            },
            mergeResult,
            operationResult,
          };

          return applySnapshot.nextParsedItems;
        });

        if (!applySnapshot || requestGeneration !== requestGenerationRef.current) {
          return;
        }

        const snapshot = applySnapshot;
        const {
          nextParsedItems,
          assistantMessage,
          mergeResult,
        } = snapshot;

        setPendingClarifications((currentPending) => {
          if (requestGeneration !== requestGenerationRef.current) {
            return currentPending;
          }
          return mergePendingClarificationsAfterParse(
            currentPending,
            mergeResult.updatedItems,
            responseClarifications,
          );
        });

        const nextMessages = [...optimisticMessages, assistantMessage];
        setMessages(nextMessages);
        scheduleChatScrollToEnd(
          "ai-response-appended",
          true,
          buildSendSnapDelays(),
          {
            active: true,
            afterInteractions: true,
          },
        );

        loadQuantitySuggestions(nextParsedItems.map((item) => item.item_id));

        if (__DEV__) {
          console.log("[QuickOrder] State updated", {
            parsedItems_count: nextParsedItems.length,
            pendingClarifications_count: responseClarifications.length,
            messages_count: nextMessages.length,
          });
        }

        try {
          await persistSession(activeSessionId, nextMessages, nextParsedItems);
        } catch (persistError) {
          console.warn("[QuickOrder] session_persist_failed:", persistError);
        }

        if (nextParsedItems.length > 0 && !nudgeSent) {
          if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
          const nudgePendingCount = responseClarifications.length;
          nudgeTimerRef.current = setTimeout(() => {
            const unresolvedCount =
              countUnresolvedItems(nextParsedItems) + nudgePendingCount;
            if (
              nextParsedItems.length > 0 &&
              unresolvedCount === 0 &&
              !nudgeSent
            ) {
              setNudgeSent(true);
              const nudgeMessage: QuickOrderMessage = {
                id: createMessageId(),
                role: "assistant",
                text: "Anything else, or ready to send?",
                createdAt: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, nudgeMessage]);
              scheduleChatScrollToEnd(
                "nudge-message",
                true,
                buildSendSnapDelays(),
                {
                  afterInteractions: true,
                },
              );
            }
          }, QUICK_ORDER_READY_NUDGE_DELAY_MS);
        }
      } catch (error) {
        console.warn("[QuickOrder] parse-order failed:", error);
        if (__DEV__) {
          console.error("[QuickOrder] Full error detail:", {
            name: (error as { name?: string })?.name,
            message: (error as { message?: string })?.message,
            stack: (error as { stack?: string })?.stack
              ?.split("\n")
              .slice(0, 5),
          });
        }
        if (activeSessionId) {
          if (requestGeneration === requestGenerationRef.current) {
            await appendErrorMessage(
              optimisticMessages,
              activeSessionId,
              "ai_unavailable",
            );
          }
        }
      } finally {
        if (requestGeneration === requestGenerationRef.current) {
          isSendingRef.current = false;
          setIsSending(false);
        }
      }
    },
    [
      appendErrorMessage,
      ensureSession,
      isSending,
      locationId,
      messages,
      nudgeSent,
      parsedItems,
      pendingClarifications,
      persistSession,
      scheduleChatScrollToEnd,
      sessionId,
      userId,
    ],
  );

  const handleRetry = useCallback(() => {
    const lastText = lastUserTextRef.current;
    if (!lastText || isSending) return;
    void handleSubmitMore(lastText);
  }, [handleSubmitMore, isSending]);

  useEffect(() => {
    const transcript = finalVoiceTranscript?.trim();
    if (!transcript) return;
    setFinalVoiceTranscript(null);
    void handleSubmitMore(transcript, "voice", {
      raw_transcript: transcript,
      transcript_confidence: 0.8,
      language: "en-US",
    });
  }, [finalVoiceTranscript, handleSubmitMore]);

  const handleStartVoice = useCallback(async () => {
    if (!voiceEnabled || !ExpoSpeechRecognitionModule || isSending) return;
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        setVoiceError("Microphone and speech recognition access are needed.");
        return;
      }
      setVoiceError(null);
      setLiveVoiceTranscript("");
      setFinalVoiceTranscript(null);
      void triggerSelectionHaptic();
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
        addsPunctuation: true,
      });
    } catch (error) {
      console.warn("[QuickOrder] Failed to start voice input:", error);
      setVoiceError("Voice input is unavailable right now.");
    }
  }, [isSending, voiceEnabled]);

  const handleStopVoice = useCallback(() => {
    if (!ExpoSpeechRecognitionModule) return;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Voice may already be stopped.
    }
    setIsVoiceListening(false);
  }, []);

  const handleClarificationAction = useCallback(
    async (
      clarification: PendingQuickOrderClarification,
      action: PendingQuickOrderClarification["actions"][number],
    ) => {
      const nextParsedItems = applyQuickOrderClarificationAction(
        parsedItems,
        clarification,
        action,
      );
      const nextPendingClarifications = pendingClarifications.filter(
        (entry) => entry.id !== clarification.id,
      );
      const confirmedLabel = buildClarificationConfirmedLabel(
        clarification,
        action,
      );
      const nextMessages = messages.map((message) => ({
        ...message,
        pendingClarifications: message.pendingClarifications?.map((entry) =>
          entry.id === clarification.id
            ? { ...entry, message: confirmedLabel, actions: [] }
            : entry,
        ),
      }));

      const followUpMessages: QuickOrderMessage[] = [];
      if (action.id !== "cancel" && clarification.item_id) {
        const updatedItem = nextParsedItems.find(
          (item) =>
            item.item_id === clarification.item_id ||
            (item.item_name && clarification.item_name &&
              item.item_name.toLowerCase() === clarification.item_name.toLowerCase()),
        );
        if (updatedItem) {
          const issue = getParsedItemIssue(updatedItem);
          const name = getParsedItemDisplayName(updatedItem);
          if (issue?.kind === "pick-quantity") {
            followUpMessages.push({
              id: createMessageId(),
              role: "assistant",
              text: `How many of ${name}?`,
              createdAt: new Date().toISOString(),
            });
          } else if (issue?.kind === "pick-unit" || issue?.kind === "fix-unit") {
            followUpMessages.push({
              id: createMessageId(),
              role: "assistant",
              text: `What unit for ${name}?`,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      const finalMessages = [...nextMessages, ...followUpMessages];

      setParsedItems(nextParsedItems);
      setPendingClarifications(nextPendingClarifications);
      setConfirmedClarifications((current) => ({
        ...current,
        [clarification.id]: confirmedLabel,
      }));
      setMessages(finalMessages);
      scheduleChatScrollToEnd(
        "clarification-action",
        true,
        buildSendSnapDelays(),
        {
          active: true,
          afterInteractions: true,
        },
      );

      const incoming = clarification.incoming_item;
      if (
        incoming &&
        action.id !== "cancel" &&
        isUuid(userId) &&
        isUuid(locationId)
      ) {
        try {
          await supabase.from("parser_corrections").insert({
            session_id: isUuid(sessionId) ? sessionId : null,
            user_id: userId,
            location_id: locationId,
            raw_token: (
              incoming.raw_token ||
              incoming.raw_text ||
              clarification.item_name
            ).trim(),
            parser_suggested_item_id: isUuid(incoming.item_id)
              ? incoming.item_id
              : null,
            user_corrected_item_id: isUuid(incoming.item_id)
              ? incoming.item_id
              : null,
            user_corrected_qty: incoming.quantity,
            user_corrected_unit: incoming.unit,
            correction_type:
              action.id === "add"
                ? "conflict_add"
                : action.id === "replace"
                  ? "conflict_replace"
                  : "conflict_keep_separate",
          });
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to log conflict correction:",
            error,
          );
        }
      }

      if (sessionId) {
        try {
          await persistSession(sessionId, finalMessages, nextParsedItems);
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to persist clarification action:",
            error,
          );
        }
      }
    },
    [
      locationId,
      messages,
      parsedItems,
      pendingClarifications,
      persistSession,
      scheduleChatScrollToEnd,
      sessionId,
      userId,
    ],
  );

  const handleAddSuggestion = useCallback(
    async (suggestion: QuickOrderSuggestion) => {
      const suggestionItems = getSuggestionItems(suggestion);
      if (suggestionItems.length === 0) return;

      const incoming: ParsedQuickOrderItem[] = suggestionItems.map(
        (item, index) => ({
          client_key: `suggestion_${Date.now().toString(36)}_${index}`,
          item_id: item.item_id,
          item_name: item.item_name,
          display_name: item.item_name,
          raw_token: item.item_name,
          raw_text: item.item_name,
          quantity: item.quantity,
          unit: item.unit,
          status: "valid",
          needs_clarification: false,
          unresolved: false,
          parse_source: "manual",
        }),
      );
      const mergeResult = mergeQuickOrderParsedItemsDetailed(
        parsedItems,
        incoming,
      );
      const nextParsedItems = mergeResult.items;
      const assistantText =
        suggestionItems.length === 1
          ? (() => {
              const item = suggestionItems[0];
              const qty = item.quantity ?? 1;
              const unit = item.unit ? ` ${item.unit}` : "";
              return `Added ${qty}${unit} of ${item.item_name}.`;
            })()
          : `Added ${mergeResult.addedCount + mergeResult.updatedCount || suggestionItems.length} suggested items.`;
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: assistantText,
        createdAt: new Date().toISOString(),
        parsedItems: incoming,
      };

      const followUpMessages: QuickOrderMessage[] = [];
      for (const incomingItem of incoming) {
        const updatedItem = nextParsedItems.find(
          (item) =>
            item.item_id === incomingItem.item_id ||
            item.client_key === incomingItem.client_key,
        );
        if (!updatedItem) continue;
        const issue = getParsedItemIssue(updatedItem);
        const name = getParsedItemDisplayName(updatedItem);
        if (issue?.kind === "pick-quantity") {
          followUpMessages.push({
            id: createMessageId(),
            role: "assistant",
            text: `How many of ${name}?`,
            createdAt: new Date().toISOString(),
          });
        } else if (issue?.kind === "pick-unit" || issue?.kind === "fix-unit") {
          followUpMessages.push({
            id: createMessageId(),
            role: "assistant",
            text: `What unit for ${name}?`,
            createdAt: new Date().toISOString(),
          });
        }
      }

      const nextMessages = [...messages, assistantMessage, ...followUpMessages];

      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      scheduleChatScrollToEnd("suggestion-added", true, buildSendSnapDelays(), {
        active: true,
        afterInteractions: true,
      });

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, nextParsedItems);
        } catch (error) {
          console.warn("[QuickOrder] Failed to persist suggestion add:", error);
        }
      }
    },
    [messages, parsedItems, persistSession, scheduleChatScrollToEnd, sessionId],
  );

  const handleRejectSuggestion = useCallback(
    async (_suggestion: QuickOrderSuggestion) => {
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: "Got it — try saying it differently.",
        createdAt: new Date().toISOString(),
      };
      const nextMessages = [...messages, assistantMessage];
      setMessages(nextMessages);
      scheduleChatScrollToEnd(
        "suggestion-rejected",
        true,
        buildSendSnapDelays(),
        { active: true, afterInteractions: true },
      );

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, parsedItems);
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to persist suggestion reject:",
            error,
          );
        }
      }
    },
    [messages, parsedItems, persistSession, scheduleChatScrollToEnd, sessionId],
  );

  const handleRejectClarification = useCallback(
    async (clarification: PendingQuickOrderClarification) => {
      const nextPendingClarifications = pendingClarifications.filter(
        (entry) => entry.id !== clarification.id,
      );
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: "Got it — try saying it differently.",
        createdAt: new Date().toISOString(),
      };
      const nextMessages = [...messages, assistantMessage];

      setDismissedClarifications((current) => ({
        ...current,
        [clarification.id]: true,
      }));
      setPendingClarifications(nextPendingClarifications);
      setMessages(nextMessages);
      scheduleChatScrollToEnd(
        "clarification-rejected",
        true,
        buildSendSnapDelays(),
        { active: true, afterInteractions: true },
      );

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, parsedItems);
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to persist clarification reject:",
            error,
          );
        }
      }
    },
    [
      messages,
      parsedItems,
      pendingClarifications,
      persistSession,
      scheduleChatScrollToEnd,
      sessionId,
    ],
  );

  const handleAddRecommendations = useCallback(
    async (recommendations: QuickOrderRecommendation[]) => {
      const incoming: ParsedQuickOrderItem[] = recommendations.map(
        (item, index) => ({
          client_key: `recommendation_${Date.now().toString(36)}_${index}`,
          item_id: item.item_id,
          item_name: item.item_name,
          display_name: item.item_name,
          raw_token: item.item_name,
          raw_text: item.item_name,
          quantity: item.suggested_quantity,
          unit: item.unit,
          status: "valid",
          needs_clarification: false,
          unresolved: false,
          parse_source: "manual",
        }),
      );
      if (incoming.length === 0) return;

      const mergeResult = mergeQuickOrderParsedItemsDetailed(
        parsedItems,
        incoming,
      );
      const nextParsedItems = mergeResult.items;
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: `Added ${incoming.length} suggested item${incoming.length === 1 ? "" : "s"}.`,
        createdAt: new Date().toISOString(),
        parsedItems: incoming,
      };
      const nextMessages = [...messages, assistantMessage];

      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      scheduleChatScrollToEnd(
        "recommendation-added",
        true,
        buildSendSnapDelays(),
        {
          active: true,
          afterInteractions: true,
        },
      );

      if (sessionId) {
        try {
          await persistSession(sessionId, nextMessages, nextParsedItems);
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to persist recommendation add:",
            error,
          );
        }
      }
    },
    [messages, parsedItems, persistSession, scheduleChatScrollToEnd, sessionId],
  );

  const handleConfirmOrder = useCallback(async () => {
    if (
      parsedItems.length === 0 ||
      issueCount > 0 ||
      isConfirmingRef.current ||
      isConfirming ||
      isSending ||
      !areQuickOrderItemsCartReady(parsedItems)
    ) {
      return;
    }

    if (!userId || !locationId) {
      Alert.alert(
        "Choose a location",
        "Choose a location before confirming this order.",
      );
      return;
    }

    Keyboard.dismiss();
    isConfirmingRef.current = true;
    setIsConfirming(true);

    const sessionToClose = sessionId;

    try {
      const loadedInventory = await loadInventoryItems();
      const inventoryById = new Map<string, QuickOrderInventoryItem>(
        loadedInventory.map((item) => [item.id, item]),
      );
      const cartAdds = quickOrderItemsToCartAdds(parsedItems, inventoryById);

      for (const add of cartAdds) {
        addToCart(locationId, add.inventoryItemId, add.quantity, add.unitType, {
          inputMode: "quantity",
          quantityRequested: add.quantity,
          note: add.note ?? undefined,
        });
      }

      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
        nudgeTimerRef.current = null;
      }

      setMessages([]);
      setConfirmedClarifications({});
      setDismissedClarifications({});
      setParsedItems([]);
      setPendingClarifications([]);
      setEditingState(null);
      setQuantityFlow(null);
      setQuantitySuggestions(new Map());
      setLiveVoiceTranscript("");
      setFinalVoiceTranscript(null);
      setVoiceError(null);
      setIsVoiceListening(false);
      setSessionId(null);
      setNudgeSent(false);
      quickOrderPendingOrderIdRef.current = null;

      if (sessionToClose) {
        try {
          await supabase
            .from("quick_order_sessions")
            .update({
              status: "abandoned",
              messages: [],
              parsed_items: [],
            })
            .eq("id", sessionToClose);
        } catch (closeError) {
          console.warn(
            "[QuickOrder] Failed to close session after confirm:",
            closeError,
          );
        }
      }

      router.push("/(tabs)/cart" as never);
    } catch (error) {
      console.warn("[QuickOrder] Failed to add items to cart:", error);
      Alert.alert(
        "Could not open cart",
        error instanceof Error
          ? error.message
          : "Couldn't add these items to your cart. Please try again.",
      );
    } finally {
      isConfirmingRef.current = false;
      setIsConfirming(false);
    }
  }, [
    addToCart,
    isConfirming,
    isSending,
    issueCount,
    loadInventoryItems,
    locationId,
    parsedItems,
    router,
    sessionId,
    userId,
  ]);

  const renderChatMessage = useCallback(
    ({ item: message }: { item: QuickOrderMessage }) => {
      const layoutHandler =
        message.id === displayMessages[displayMessages.length - 1]?.id
          ? handleMessageLayout
          : undefined;

      if (isQuickOrderWelcomeMessage(message)) {
        return <QuickOrderWelcomeMessageCard onLayout={layoutHandler} />;
      }

      if (message.role === "assistant") {
        const renderableClarifications = (message.pendingClarifications ?? []).filter(
          (clarification) =>
            clarification.actions.length > 0 ||
            Boolean(confirmedClarifications[clarification.id]) ||
            Boolean(dismissedClarifications[clarification.id]),
        );
        const clarificationItemKeys = new Set(
          renderableClarifications
            .map((c) => c.item_id ?? c.item_name?.toLowerCase() ?? "")
            .filter((key) => key.length > 0),
        );
        const filteredSafetyWarnings = (message.safetyWarnings ?? []).filter(
          (warning) => {
            const key =
              warning.item_id ?? warning.item_name?.toLowerCase() ?? "";
            return key.length === 0 || !clarificationItemKeys.has(key);
          },
        );
        const suppressAssistantPill =
          renderableClarifications.length > 0 ||
          filteredSafetyWarnings.length > 0;
        const showInfoCard = isQaAnswerMessage(message);
        return (
          <View>
            {suppressAssistantPill ? null : showInfoCard ? (
              <InfoCard text={message.text} onLayout={layoutHandler} />
            ) : (
              <AIResponsePill message={message} onLayout={layoutHandler} />
            )}
            {message.blockedOperations?.map((operation, index) => (
              <BlockedOperationCard
                key={`${message.id}:blocked:${index}`}
                operation={operation}
                onLayout={layoutHandler}
              />
            ))}
            {filteredSafetyWarnings.map((warning, index) => (
              <SafetyWarningCard
                key={`${message.id}:warning:${index}`}
                warning={warning}
                onLayout={layoutHandler}
              />
            ))}
            {message.stockUpdates?.length ? (
              <StockUpdateCard
                updates={message.stockUpdates}
                onLayout={layoutHandler}
              />
            ) : null}
            {renderableClarifications.map((clarification) => (
              <ClarificationCard
                key={clarification.id}
                clarification={clarification}
                confirmed={Boolean(confirmedClarifications[clarification.id])}
                dismissed={Boolean(dismissedClarifications[clarification.id])}
                confirmedLabel={confirmedClarifications[clarification.id]}
                onAction={handleClarificationAction}
                onReject={handleRejectClarification}
                onLayout={layoutHandler}
              />
            ))}
            {(message.suggestions ?? []).map((suggestion, index) => (
              <SuggestionCard
                key={`${message.id}:suggestion:${index}`}
                suggestion={suggestion}
                onAdd={handleAddSuggestion}
                onReject={handleRejectSuggestion}
                onLayout={layoutHandler}
              />
            ))}
            {message.recommendations?.length ? (
              <RecommendationCard
                recommendations={message.recommendations}
                onAdd={handleAddRecommendations}
                onLayout={layoutHandler}
              />
            ) : null}
          </View>
        );
      }

      if (message.role === "error") {
        const canRetry =
          message.errorCode !== "feature_disabled" &&
          message.errorCode !== "rate_limit_user_daily" &&
          message.errorCode !== "rate_limit_org_monthly";
        // Defensive: never render a raw technical string even if one slipped in.
        const errorText = toFriendlyQuickOrderError(
          message.text,
          message.errorCode,
        );

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
            <Text style={[styles.errorText, { fontSize: ds.fontSize(15) }]}>
              {errorText}
            </Text>
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
                <Text style={[styles.retryText, { fontSize: ds.fontSize(14) }]}>
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      }

      return (
        <QuickOrderUserMessage
          text={message.text}
          source={message.source === "voice" ? "voice" : "typed"}
          onLayout={layoutHandler}
        />
      );
    },
    [
      ds,
      displayMessages,
      handleAddSuggestion,
      handleRejectSuggestion,
      handleAddRecommendations,
      handleClarificationAction,
      handleRejectClarification,
      handleMessageLayout,
      handleRetry,
      confirmedClarifications,
      dismissedClarifications,
    ],
  );

  const keyExtractor = useCallback((item: QuickOrderMessage) => item.id, []);

  const handleComposerHeightChange = useCallback((next: number) => {
    setComposerHeight((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  }, []);

  const handleComposerBottomOffsetChange = useCallback((next: number) => {
    const safeNext = Number.isFinite(next) ? Math.max(0, next) : 0;
    setComposerBottomOffset((prev) =>
      Math.abs(prev - safeNext) < 1 ? prev : safeNext,
    );
  }, []);

  const handleComposerSubmit = useCallback(
    (text: string) => {
      void handleSubmitMore(text);
    },
    [handleSubmitMore],
  );

  const handleOrderCardHeightChange = useCallback(
    (height: number) => {
      setFloatingCardHeight(height);
      scheduleChatScrollToEnd(
        "order-card-measured",
        true,
        [0, 80, CARD_TIMING.duration + 80],
        {
          active: true,
          afterInteractions: true,
        },
      );
    },
    [scheduleChatScrollToEnd],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
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
            locationLabel={location?.name ?? ""}
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
            data={isLoadingSession ? [] : displayMessages}
            keyExtractor={keyExtractor}
            renderItem={renderChatMessage}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
            showsVerticalScrollIndicator={false}
            onScrollBeginDrag={handleChatScrollBeginDrag}
            onScrollEndDrag={handleChatScrollEndDrag}
            onMomentumScrollBegin={handleChatMomentumScrollBegin}
            onMomentumScrollEnd={handleChatMomentumScrollEnd}
            onScroll={handleChatScroll}
            scrollEventThrottle={16}
            onLayout={handleChatLayout}
            onContentSizeChange={handleChatContentSizeChange}
            removeClippedSubviews={Platform.OS === "android"}
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
              ) : sessionLoadError ? (
                <View
                  style={[
                    styles.sessionErrorCard,
                    {
                      borderRadius: ds.radius(16),
                      padding: ds.spacing(14),
                      marginTop: ds.spacing(10),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sessionErrorText,
                      { fontSize: ds.fontSize(15) },
                    ]}
                  >
                    {sessionLoadError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading session"
                    onPress={retrySessionLoad}
                    style={({ pressed }) => [
                      styles.retryButton,
                      {
                        marginTop: ds.spacing(10),
                        borderRadius: ds.radius(12),
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.retryText, { fontSize: ds.fontSize(14) }]}
                    >
                      Retry
                    </Text>
                  </Pressable>
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
                  <Text
                    style={[styles.typingText, { fontSize: ds.fontSize(15) }]}
                  >
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
            onHeightChange={handleOrderCardHeightChange}
          />
        </View>

        <QuickOrderComposerBar
          onSubmit={handleComposerSubmit}
          isSending={isSending}
          bottomInset={insets.bottom}
          tabBarHeight={tabBarHeight}
          onHeightChange={handleComposerHeightChange}
          onBottomOffsetChange={handleComposerBottomOffsetChange}
          voiceEnabled={voiceEnabled}
          isVoiceListening={isVoiceListening}
          voiceTranscript={liveVoiceTranscript}
          voiceError={voiceError}
          onStartVoice={handleStartVoice}
          onStopVoice={handleStopVoice}
        />

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

        <QuickOrderQuantitySheet
          visible={Boolean(quantityFlow)}
          queue={quantityQueueItems}
          index={quantityFlow?.index ?? 0}
          isSaving={isQuantitySaving}
          onClose={handleQuantityClose}
          onApply={(result) => void handleQuantityApply(result)}
          onSkip={handleQuantitySkip}
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
    alignItems: "center",
    paddingVertical: 32,
  },
  sessionErrorCard: {
    alignSelf: "stretch",
    backgroundColor: colors.statusRedBg,
    borderWidth: glassHairlineWidth,
    borderColor: colors.statusRed,
  },
  sessionErrorText: {
    color: colors.statusRed,
    fontWeight: "700",
    letterSpacing: 0,
  },
  errorCard: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    marginTop: 16,
    backgroundColor: colors.statusRedBg,
    borderWidth: glassHairlineWidth,
    borderColor: colors.statusRed,
  },
  errorText: {
    color: colors.statusRed,
    fontWeight: "700",
    letterSpacing: 0,
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.statusRedBg,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  retryText: {
    color: colors.statusRed,
    fontWeight: "800",
    letterSpacing: 0,
  },
  typingCard: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  typingText: {
    marginLeft: 10,
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  aiPill: {
    alignSelf: "flex-start",
    maxWidth: "88%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 1,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  aiPillCaution: {
    backgroundColor: colors.statusAmberBg,
    borderWidth: 0,
  },
  aiPillSuccess: {
    backgroundColor: colors.statusGreenBg,
    borderWidth: 0,
  },
  aiPillText: {
    flexShrink: 1,
    marginLeft: 10,
    color: colors.textPrimary,
    fontWeight: "600",
    letterSpacing: 0,
  },
  aiPillTextCaution: {
    color: colors.textPrimary,
    fontWeight: "500",
  },
  chatWhiteCard: {
    alignSelf: "flex-start",
    width: "94%",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  chatWhiteCardText: {
    color: colors.textPrimary,
    fontWeight: "500",
    letterSpacing: 0,
  },
  chatDismissedPillCard: {
    alignSelf: "flex-start",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  cardBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 4,
  },
  cardBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  clarificationCard: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    backgroundColor: "#FEF3C7",
    borderWidth: glassHairlineWidth,
    borderColor: "#FDE68A",
  },
  clarificationCardConfirmed: {
    backgroundColor: "#DCFCE7",
    borderColor: "#BBF7D0",
  },
  clarificationCardDismissed: {
    backgroundColor: colors.glassCircle,
    borderColor: glassColors.cardBorder,
  },
  clarificationHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  clarificationText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "500",
    letterSpacing: 0,
  },
  clarificationTextConfirmed: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  clarificationTextDismissed: {
    flex: 1,
    color: colors.textSecondary,
    fontWeight: "600",
    letterSpacing: 0,
  },
  clarificationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  clarificationPrimaryButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  clarificationPrimaryButtonText: {
    color: "#92400E",
    fontWeight: "800",
    letterSpacing: 0,
  },
  clarificationGhostButton: {
    backgroundColor: "transparent",
  },
  clarificationGhostButtonText: {
    color: "#92400E",
    fontWeight: "700",
    letterSpacing: 0,
  },
  noticeCard: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: glassHairlineWidth,
  },
  noticeText: {
    flex: 1,
    marginLeft: 8,
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  warningCard: {
    backgroundColor: colors.statusAmberBg,
    borderColor: colors.statusAmber,
  },
  blockedCard: {
    backgroundColor: colors.statusRedBg,
    borderColor: colors.statusRed,
  },
  stockCard: {
    backgroundColor: colors.white,
    borderColor: glassColors.cardBorder,
  },
  stockTextCluster: {
    flex: 1,
  },
  stockTitle: {
    color: colors.textSecondary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  stockRowText: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  stockMoreText: {
    color: colors.textMuted,
    fontWeight: "700",
    letterSpacing: 0,
  },
  recommendationCard: {
    alignSelf: "flex-start",
    width: "94%",
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  suggestionCard: {
    alignSelf: "flex-start",
    width: "94%",
    backgroundColor: "#FEF3C7",
    borderWidth: glassHairlineWidth,
    borderColor: "#FDE68A",
  },
  suggestionCardAdded: {
    width: "auto",
    maxWidth: "94%",
    backgroundColor: "#DCFCE7",
    borderColor: "#BBF7D0",
  },
  suggestionCardDismissed: {
    width: "auto",
    maxWidth: "94%",
    backgroundColor: colors.glassCircle,
    borderColor: glassColors.cardBorder,
  },
  suggestionDismissedText: {
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  suggestionButtonRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  suggestionPrimaryButton: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  suggestionPrimaryButtonText: {
    color: "#92400E",
    fontWeight: "800",
    letterSpacing: 0,
  },
  suggestionGhostButton: {
    backgroundColor: "transparent",
  },
  suggestionGhostButtonText: {
    color: "#92400E",
    fontWeight: "700",
    letterSpacing: 0,
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  suggestionTextCluster: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
  },
  suggestionTitle: {
    color: colors.textPrimary,
    fontWeight: "500",
    letterSpacing: 0,
  },
  suggestionMessage: {
    marginTop: 2,
    color: colors.textSecondary,
    fontWeight: "400",
    letterSpacing: 0,
  },
  suggestionItems: {
    backgroundColor: colors.glassCircle,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  suggestionItemText: {
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  suggestionButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.primaryLight,
  },
  suggestionButtonText: {
    color: colors.primary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  suggestionAddedRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  suggestionAddedCheck: {
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionAddedText: {
    marginLeft: 8,
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
});
