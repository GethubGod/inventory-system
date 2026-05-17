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
import { router } from "expo-router";
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
import {
  triggerConfirmationHaptic,
  triggerSelectionHaptic,
} from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuthStore, useOrderStore } from "@/store";
import {
  areQuickOrderItemsCartReady,
  quickOrderItemsToCartAdds,
} from "@/store/helpers";
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
  for (const clarification of [...retained, ...incoming]) {
    byId.set(clarification.id, clarification);
  }
  return [...byId.values()];
}

function mapPersistedMessages(
  messages: PersistedQuickOrderMessage[],
): QuickOrderMessage[] {
  return messages
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
        id: createMessageId(),
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
): PersistedQuickOrderMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      reply_text: message.text,
      text: message.text,
      parsed_items: message.parsedItems ?? [],
      pending_clarifications: message.pendingClarifications ?? [],
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

function getAssistantPill(message: QuickOrderMessage) {
  const flags = message.flags ?? [];
  const items = message.parsedItems ?? [];
  const pendingCount = message.pendingClarifications?.length ?? 0;
  const flaggedItem = items.find((item) => getParsedItemIssue(item));
  const addedItem = items.find((item) => !getParsedItemIssue(item));

  if (
    pendingCount > 0 ||
    flaggedItem ||
    (flags.length > 0 && items.length === 0)
  ) {
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
      icon: "alert-circle-outline" as const,
      color: colors.statusAmber,
      text: text ?? message.text,
    };
  }

  if (addedItem) {
    return {
      icon: "checkmark" as const,
      color: colors.statusGreen,
      text:
        message.text ||
        `Added ${getParsedItemDisplayName(addedItem)} · ${formatParsedItemQuantity(addedItem)}`,
    };
  }

  const looksLikeNoChange =
    /^those items are already|^that item is already/i.test(message.text);
  return {
    icon: looksLikeNoChange
      ? ("checkmark" as const)
      : ("alert-circle-outline" as const),
    color: looksLikeNoChange ? colors.statusGreen : colors.statusAmber,
    text: message.text,
  };
}

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
        {
          borderRadius: ds.radius(20),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(10),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons name={pill.icon} size={16} color={pill.color} />
      <Text style={[styles.aiPillText, { fontSize: ds.fontSize(16) }]}>
        {text}
      </Text>
    </Animated.View>
  );
});

type ClarificationCardProps = {
  clarification: PendingQuickOrderClarification;
  onAction: (
    clarification: PendingQuickOrderClarification,
    action: PendingQuickOrderClarification["actions"][number],
  ) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

const ClarificationCard = React.memo(function ClarificationCard({
  clarification,
  onAction,
  onLayout,
}: ClarificationCardProps) {
  const ds = useScaledStyles();

  return (
    <View
      onLayout={onLayout}
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
        <Ionicons
          name="help-circle-outline"
          size={ds.icon(18)}
          color={colors.statusAmber}
        />
        <Text
          style={[
            styles.clarificationText,
            { fontSize: ds.fontSize(15), marginLeft: ds.spacing(8) },
          ]}
        >
          {clarification.message}
        </Text>
      </View>
      <View
        style={[
          styles.clarificationActions,
          { gap: ds.spacing(8), marginTop: ds.spacing(10) },
        ]}
      >
        {clarification.actions.map((action) => (
          <Pressable
            key={`${clarification.id}:${action.id}:${action.existing_item_key ?? ""}`}
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
            <Text
              style={[
                styles.clarificationButtonText,
                { fontSize: ds.fontSize(13) },
              ]}
              numberOfLines={1}
            >
              {action.preview
                ? `${action.label} — ${action.preview}`
                : action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

type SuggestionCardProps = {
  suggestion: QuickOrderSuggestion;
  onAdd: (suggestion: QuickOrderSuggestion) => void | Promise<void>;
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

const SuggestionCard = React.memo(function SuggestionCard({
  suggestion,
  onAdd,
  onLayout,
}: SuggestionCardProps) {
  const ds = useScaledStyles();
  const [isAdded, setIsAdded] = useState(false);
  const items = getSuggestionItems(suggestion);
  const title = suggestion.title ?? suggestion.item_name ?? "Suggestion";
  const addedTitle = items.length === 1 ? items[0].item_name : title;
  const message =
    suggestion.message ??
    suggestion.reason ??
    items
      .map((item) => item.item_name)
      .slice(0, 3)
      .join(", ");

  const handleAdd = useCallback(() => {
    if (isAdded) return;
    void triggerSelectionHaptic();
    setIsAdded(true);
    void onAdd(suggestion);
  }, [isAdded, onAdd, suggestion]);

  return (
    <Animated.View
      layout={LinearTransition.duration(220).easing(Easing.out(Easing.cubic))}
      onLayout={onLayout}
      style={[
        styles.suggestionCard,
        isAdded && styles.suggestionCardAdded,
        {
          borderRadius: ds.radius(16),
          paddingVertical: isAdded ? ds.spacing(9) : ds.spacing(12),
          paddingHorizontal: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      {isAdded ? (
        <View style={styles.suggestionAddedRow}>
          <View
            style={[
              styles.suggestionAddedCheck,
              {
                width: ds.spacing(24),
                height: ds.spacing(24),
                borderRadius: ds.radius(12),
              },
            ]}
          >
            <Ionicons
              name="checkbox"
              size={ds.icon(22)}
              color={colors.statusGreen}
            />
          </View>
          <Text
            style={[styles.suggestionAddedText, { fontSize: ds.fontSize(14) }]}
            numberOfLines={1}
          >
            {addedTitle}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.suggestionHeader}>
            <Ionicons
              name="sparkles-outline"
              size={ds.icon(18)}
              color={colors.primary}
            />
            <View style={styles.suggestionTextCluster}>
              <Text
                style={[styles.suggestionTitle, { fontSize: ds.fontSize(15) }]}
              >
                {title}
              </Text>
              <Text
                style={[
                  styles.suggestionMessage,
                  { fontSize: ds.fontSize(13) },
                ]}
              >
                {message}
              </Text>
            </View>
          </View>
          <View style={[styles.suggestionItems, { marginTop: ds.spacing(8) }]}>
            <Text
              style={[
                styles.suggestionItemText,
                { fontSize: ds.fontSize(12) },
              ]}
            >
              {items
                .slice(0, 4)
                .map(
                  (item) =>
                    `${item.item_name} ${item.quantity}${item.unit ? ` ${item.unit}` : ""}`,
                )
                .join(" · ")}
              {items.length > 4 ? ` · +${items.length - 4} more` : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${title}`}
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
            <Text
              style={[
                styles.suggestionButtonText,
                { fontSize: ds.fontSize(13) },
              ]}
            >
              Add to order
            </Text>
          </Pressable>
        </>
      )}
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
  const text = updates
    .slice(0, 4)
    .map((update) => `${update.item_name} ${update.quantity}${update.unit ? ` ${update.unit}` : ""}`)
    .join(" · ");
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
      <Text style={[styles.noticeText, { fontSize: ds.fontSize(14) }]}>
        {text}
        {updates.length > 4 ? ` · +${updates.length - 4} more` : ""}
      </Text>
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
  const { location } = useResolvedActiveLocation();
  const tabBarHeight = 60 + getTabBarBottomInset(insets.bottom);

  const addToCart = useOrderStore((state) => state.addToCart);

  const [composerHeight, setComposerHeight] = useState(0);
  const [composerBottomOffset, setComposerBottomOffset] =
    useState(tabBarHeight);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QuickOrderMessage[]>([]);
  const [parsedItems, setParsedItems] = useState<ParsedQuickOrderItem[]>([]);
  const [pendingClarifications, setPendingClarifications] = useState<
    PendingQuickOrderClarification[]
  >([]);
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
          ),
        );
      } catch (error) {
        console.warn("[QuickOrder] Failed to load active session:", error);
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
      scheduleChatScrollToEnd("layout-state-change", true, [0, 80], {
        afterInteractions: true,
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [
    isSending,
    composerBottomOffset,
    composerHeight,
    messages.length,
    parsedItems,
    floatingCardHeight,
    scheduleChatScrollToEnd,
  ]);

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
          messages: nextMessages.map(buildPersistedMessage),
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
    setLocationDropdownOpen((current) => !current);
  }, []);

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
      if (next.id === location?.id) return;
      setAuthLocation(next);
    },
    [location?.id, setAuthLocation],
  );

  const handleClear = useCallback(async () => {
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
    setMessages([]);
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
  }, [handleClear]);

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

      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      setEditingState(null);
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
        loadInventoryItems().catch((error) => {
          console.warn("[QuickOrder] Failed to load editor inventory:", error);
        });
        return;
      }
      const index = Math.max(0, queue.indexOf(tappedKey));
      setQuantityFlow({ queue, index });
      loadInventoryItems().catch((error) => {
        console.warn("[QuickOrder] Failed to load editor inventory:", error);
      });
    },
    [loadInventoryItems, parsedItems],
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
      rawText: string,
      source: QuickOrderMessageSource = "typed",
      voiceMetadata?: {
        raw_transcript?: string;
        transcript_confidence?: number;
        language?: string;
      },
    ) => {
      const trimmed = rawText.trim();
      if (!trimmed || isSending) {
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
            message: rawText,
            source,
            location_id: locationId,
            session_id: activeSessionId,
            user_id: userId,
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
            recent_messages: messages.slice(-12).map(buildPersistedMessage),
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
            error,
          );
          if (activeSessionId) {
            await appendErrorMessage(
              optimisticMessages,
              activeSessionId,
              errorCode,
            );
          }
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
            assistantMessage: response.assistantMessage.slice(0, 80),
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
            await appendErrorMessage(optimisticMessages, activeSessionId, code);
          }
          return;
        }

        // Apply operations first (remove/replace/update/clear).
        const operations = response.operations;
        let operationBase = parsedItems;
        let operationResult = null;
        if (operations.length > 0) {
          operationResult = applyQuickOrderOperations(parsedItems, operations);
          operationBase = operationResult.items;
          if (__DEV__) {
            console.log("[QuickOrder] Operations applied", {
              operations_count: operations.length,
              applied: operationResult.appliedCount,
              removed: operationResult.removedCount,
              updated: operationResult.updatedCount,
              skipped: operationResult.skippedCount,
              skippedReasons: operationResult.skippedReasons,
              items_after: operationBase.length,
            });
          }
        }

        // Then merge any new parsed items onto the post-operation state.
        const responseItems = response.parsedItems;
        const responseSuggestions = normalizeSuggestions(response.suggestions);
        const responseClarifications = response.pendingActions;
        const mergeResult = mergeQuickOrderParsedItemsDetailed(
          operationBase,
          responseItems,
        );
        const nextParsedItems = mergeResult.items;
        const nextPendingClarifications = mergePendingClarificationsAfterParse(
          pendingClarifications,
          mergeResult.updatedItems,
          responseClarifications,
        );
        const assistantText = buildQuickOrderAssistantMessage({
          normalized: response,
          mergeResult,
          pendingCount: responseClarifications.length,
          operationResult,
        });
        const finalAssistantText =
          response.stockUpdates.length > 0 ||
          response.recommendations.length > 0 ||
          response.safetyWarnings.length > 0 ||
          response.blockedOperations.length > 0
            ? response.displayMessage
            : assistantText;

        if (__DEV__) {
          console.log("[QuickOrder] Merge result", {
            parsedItems_before: parsedItems.length,
            responseItems_count: responseItems.length,
            merge_added: mergeResult.addedCount,
            merge_updated: mergeResult.updatedCount,
            merge_review: mergeResult.reviewCount,
            merge_unchanged: mergeResult.unchangedCount,
            merge_rejected_reasons: mergeResult.rejectedReasons,
            nextParsedItems_count: nextParsedItems.length,
            pendingClarifications_count: responseClarifications.length,
            assistantText: finalAssistantText.slice(0, 80),
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
          console.warn(
            "[QuickOrder] Parser response produced no state change",
            {
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
            },
          );
        }

        const assistantMessage: QuickOrderMessage = {
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
        };
        const nextMessages = [...optimisticMessages, assistantMessage];

        setParsedItems(nextParsedItems);
        setPendingClarifications(nextPendingClarifications);
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

        if (__DEV__) {
          console.log("[QuickOrder] State updated", {
            parsedItems_count: nextParsedItems.length,
            pendingClarifications_count: nextPendingClarifications.length,
            messages_count: nextMessages.length,
          });
        }

        try {
          await persistSession(activeSessionId, nextMessages, nextParsedItems);
          if (__DEV__) {
            console.log("[QuickOrder] Session persisted successfully");
          }
        } catch (persistError) {
          // Session persistence failure should NOT clear local state
          console.warn("[QuickOrder] session_persist_failed:", persistError);
        }

        // Start nudge timer after a successful parse with items
        if (nextParsedItems.length > 0 && !nudgeSent) {
          if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
          nudgeTimerRef.current = setTimeout(() => {
            const unresolvedCount =
              countUnresolvedItems(nextParsedItems) +
              nextPendingClarifications.length;
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
          }, 30_000);
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
          await appendErrorMessage(
            optimisticMessages,
            activeSessionId,
            "ai_unavailable",
          );
        }
      } finally {
        setIsSending(false);
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
      const nextMessages = messages.map((message) => ({
        ...message,
        pendingClarifications: message.pendingClarifications?.filter(
          (entry) => entry.id !== clarification.id,
        ),
      }));

      setParsedItems(nextParsedItems);
      setPendingClarifications(nextPendingClarifications);
      setMessages(nextMessages);
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
          await persistSession(sessionId, nextMessages, nextParsedItems);
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
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: `Added ${mergeResult.addedCount + mergeResult.updatedCount || suggestionItems.length} suggested item${suggestionItems.length === 1 ? "" : "s"}.`,
        createdAt: new Date().toISOString(),
        parsedItems: incoming,
      };
      const nextMessages = [...messages, assistantMessage];

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
      Alert.alert(
        "Choose a location",
        "Choose a location before confirming this order.",
      );
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
          inputMode: "quantity",
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
            .from("quick_order_sessions")
            .update({ status: "abandoned", messages: [], parsed_items: [] })
            .eq("id", closingSessionId);
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to close session after confirm:",
            error,
          );
        }
      }

      setMessages([]);
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

      router.push(mode.cartRoute as never);
    } catch (error) {
      console.warn("[QuickOrder] Failed to move order to cart:", error);
      Alert.alert(
        "Could not confirm order",
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
      const layoutHandler =
        message.id === messages[messages.length - 1]?.id
          ? handleMessageLayout
          : undefined;

      if (message.role === "assistant") {
        return (
          <View>
            <AIResponsePill message={message} onLayout={layoutHandler} />
            {message.blockedOperations?.map((operation, index) => (
              <BlockedOperationCard
                key={`${message.id}:blocked:${index}`}
                operation={operation}
                onLayout={layoutHandler}
              />
            ))}
            {message.safetyWarnings?.map((warning, index) => (
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
            {(message.pendingClarifications ?? []).map((clarification) => (
              <ClarificationCard
                key={clarification.id}
                clarification={clarification}
                onAction={handleClarificationAction}
                onLayout={layoutHandler}
              />
            ))}
            {(message.suggestions ?? []).map((suggestion, index) => (
              <SuggestionCard
                key={`${message.id}:suggestion:${index}`}
                suggestion={suggestion}
                onAdd={handleAddSuggestion}
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
          source={message.source}
          onLayout={layoutHandler}
        />
      );
    },
    [
      ds,
      handleAddSuggestion,
      handleAddRecommendations,
      handleClarificationAction,
      handleMessageLayout,
      handleRetry,
      messages,
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
            data={isLoadingSession ? [] : messages}
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
  aiPillText: {
    flex: 1,
    marginLeft: 10,
    color: colors.textPrimary,
    fontWeight: "600",
    letterSpacing: 0,
  },
  clarificationCard: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    backgroundColor: colors.statusAmberBg,
    borderWidth: glassHairlineWidth,
    borderColor: colors.statusAmber,
  },
  clarificationHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  clarificationText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  clarificationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  clarificationButton: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  clarificationButtonText: {
    color: colors.primary,
    fontWeight: "800",
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
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  suggestionCardAdded: {
    width: "auto",
    maxWidth: "94%",
    backgroundColor: colors.glassCircle,
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
    fontWeight: "800",
    letterSpacing: 0,
  },
  suggestionMessage: {
    marginTop: 2,
    color: colors.textSecondary,
    fontWeight: "600",
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
