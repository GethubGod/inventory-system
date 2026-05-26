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
  AppState,
  FlatList,
  InteractionManager,
  Keyboard,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
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
import { ConfirmLocationBottomSheet } from "@/components";
import { getTabBarBottomInset } from "@/components/navigation";
import {
  formatOrderConfirmationSummary,
  type OrderConfirmationPayload,
} from "@/features/cart/orderConfirmation";
import { OrderSubmissionConfirmationOverlay } from "@/features/cart/OrderSubmissionConfirmationOverlay";
import { useResolvedActiveLocation } from "@/hooks/useResolvedActiveLocation";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import {
  triggerConfirmationHaptic,
  triggerSelectionHaptic,
} from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuthStore, useSettingsStore } from "@/store";
import {
  areQuickOrderItemsCartReady,
  quickOrderItemsToCartAdds,
} from "@/store/helpers";
import { submitOrder as submitOrderService } from "@/services/orderSubmission";
import {
  OrderSubmissionError,
  type OrderItemPayload,
} from "@/services/orderValidation";
import { resolveActiveLocationReminders } from "@/services/locationReminderService";
import { completePendingRemindersForUser } from "@/services/notificationService";
import {
  colors,
  glassColors,
  glassHairlineWidth,
  quickOrderAccent,
  quickOrderAccentLight,
  quickOrderAccentPale,
  quickOrderAssistantPillBackground,
} from "@/theme/design";
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
import { buildComposerItemNameList, buildComposerOrderText } from "./orderPreview";
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
  shouldDiscardQuickOrderResponseAsError,
  type QuickOrderAssistantAction,
  type QuickOrderBlockedOperation,
  type QuickOrderMessageSource,
  type QuickOrderRecommendation,
  type QuickOrderSafetyWarning,
  type QuickOrderStockUpdate,
} from "./quickOrderResponse";
import {
  buildQuickOrderContextNotes,
  getQuickOrderContextNotesHeader,
  type QuickOrderContextNote,
} from "./quickOrderContextNotes";
import {
  getComposerPlaceholder,
  type ComposerMode,
} from "./quickOrderComposer";
import {
  cleanupQuickOrderVoiceFile,
  isQuickOrderVoiceTooShort,
  reduceQuickOrderVoiceState,
  transcribeQuickOrderVoiceFile,
  type QuickOrderVoiceErrorCode,
  type QuickOrderVoiceEvent,
  type QuickOrderVoiceStatus,
  type VoiceParsedAction,
  type VoiceUnresolvedAction,
} from "./quickOrderVoice";
import {
  countUnresolvedItems,
  applyQuickOrderClarificationAction,
  applyQuickOrderOperations,
  createQuickOrderClientKey,
  formatQuickOrderQuantity,
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

type ResponseLike = {
  status?: unknown;
  clone?: () => ResponseLike;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

type QuickOrderFunctionErrorDetails = {
  code: string;
  status?: number;
  body?: unknown;
};

type QuickOrderInvokeResult = {
  data: unknown;
  error: unknown;
  attempts: number;
  errorDetails?: QuickOrderFunctionErrorDetails;
};

const QUICK_ORDER_RETRY_DELAYS_MS = [700, 1_400, 2_800, 5_600] as const;
const QUICK_ORDER_MAX_RECORDING_MS = 30_000;
const QUICK_ORDER_VOICE_SESSION_TIMEOUT_MS = 10_000;
const QUICK_ORDER_VOICE_SESSION_TIMEOUT_MESSAGE = "VOICE_SESSION_TIMEOUT";
const QUICK_ORDER_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  bitRate: 64_000,
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asResponseLike(value: unknown): ResponseLike | null {
  if (!isObjectRecord(value)) return null;
  if (
    "status" in value ||
    "json" in value ||
    "text" in value ||
    "clone" in value
  ) {
    return value as ResponseLike;
  }
  return null;
}

function getResponseStatus(response: ResponseLike | null): number | undefined {
  const status = response?.status;
  return typeof status === "number" && Number.isFinite(status)
    ? status
    : undefined;
}

function getErrorCodeFromBody(body: unknown): string | undefined {
  if (!isObjectRecord(body)) return undefined;
  const code = body.code ?? body.error_code ?? body.errorCode;
  return typeof code === "string" && code.trim().length > 0
    ? code.trim()
    : undefined;
}

async function readFunctionErrorBody(response: ResponseLike | null): Promise<unknown> {
  if (!response) return null;
  const readable = typeof response.clone === "function"
    ? response.clone()
    : response;
  if (typeof readable.json === "function") {
    try {
      return await readable.json();
    } catch {
      // Fall through to text parsing below.
    }
  }
  if (typeof readable.text === "function") {
    try {
      const text = await readable.text();
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function codeFromHttpStatus(status?: number): string {
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "quick_order_busy";
  if (status === 503) return "ai_unavailable";
  return "ai_unavailable";
}

async function getQuickOrderFunctionErrorDetails(
  error: unknown,
): Promise<QuickOrderFunctionErrorDetails> {
  const errorName = (error as { name?: string }).name ?? "";
  if (errorName === "FunctionsFetchError") {
    return { code: "network_error" };
  }
  if (errorName !== "FunctionsHttpError") {
    return { code: "ai_unavailable" };
  }

  const response = asResponseLike((error as { context?: unknown }).context);
  const status = getResponseStatus(response);
  const body = await readFunctionErrorBody(response);
  const bodyCode = getErrorCodeFromBody(body);
  return {
    code: bodyCode ?? codeFromHttpStatus(status),
    status,
    body,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withPromiseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function generateQuickOrderSubmitId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isRetryableQuickOrderFunctionError(
  details: QuickOrderFunctionErrorDetails,
): boolean {
  if (details.status === 429) {
    return details.code !== "rate_limit_user_daily" &&
      details.code !== "rate_limit_org_monthly";
  }
  return details.status === 503 || details.status === 504;
}

function retryDelayWithJitter(attemptIndex: number): number {
  const baseDelay =
    QUICK_ORDER_RETRY_DELAYS_MS[
      Math.min(attemptIndex, QUICK_ORDER_RETRY_DELAYS_MS.length - 1)
    ];
  return baseDelay + Math.floor(Math.random() * 250);
}

async function invokeParseOrderWithRetry(input: {
  body: Record<string, unknown>;
  label: string;
  maxRetries?: number;
}): Promise<QuickOrderInvokeResult> {
  const maxRetries = input.maxRetries ?? QUICK_ORDER_RETRY_DELAYS_MS.length;

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    const { data, error } = await supabase.functions.invoke("parse-order", {
      body: input.body,
    });
    if (!error) {
      return { data, error: null, attempts: attemptIndex + 1 };
    }

    const errorDetails = await getQuickOrderFunctionErrorDetails(error);
    const shouldRetry =
      attemptIndex < maxRetries &&
      isRetryableQuickOrderFunctionError(errorDetails);
    if (!shouldRetry) {
      return {
        data,
        error,
        attempts: attemptIndex + 1,
        errorDetails,
      };
    }

    const delayMs = retryDelayWithJitter(attemptIndex);
    if (__DEV__) {
      console.warn("[QuickOrder] parse-order retry scheduled", {
        label: input.label,
        attempt: attemptIndex + 1,
        nextAttempt: attemptIndex + 2,
        delayMs,
        status: errorDetails.status,
        code: errorDetails.code,
      });
    }
    await sleep(delayMs);
  }

  return { data: null, error: null, attempts: maxRetries + 1 };
}

type MissingItemSuggestion = {
  itemId: string;
  itemName: string;
  suggestedQuantity: number;
  unit: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  source: "last_week" | "same_weekday" | "usual_pattern" | "imported_history";
  occurrenceCount: number;
  sampleSize: number;
};

type SmartMissingCheck = {
  status: "idle" | "checking" | "ready" | "error";
  checkedAt?: string;
  locationId?: string | null;
  supplierId?: string | null;
  cartHash?: string;
  suggestions: MissingItemSuggestion[];
  ignoredItemIds: string[];
  source: "proactive" | "manual";
};

type VoiceReviewState = {
  rawTranscript: string;
  normalizedText: string;
  modelUsed: string;
  confidence: number;
  voiceEventId: string | null;
  detectedLanguages: string[];
  actions: VoiceParsedAction[];
  unresolved: VoiceUnresolvedAction[];
  warnings: string[];
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
  /**
   * Present on inventory-mode replies: the counted-vs-ordered rows shown in the
   * "Updated" card. When set, the assistant text pill is suppressed in favor of
   * this card (problems still surface as their own warning/clarification cards).
   */
  inventoryUpdates?: QuickOrderInventoryUpdate[];
  safetyWarnings?: QuickOrderSafetyWarning[];
  blockedOperations?: QuickOrderBlockedOperation[];
  actions?: QuickOrderAssistantAction[];
  contextPatch?: Record<string, unknown> | null;
  mutationId?: string | null;
  reverted?: boolean;
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
  inventory_updates?: QuickOrderInventoryUpdate[];
  safety_warnings?: QuickOrderSafetyWarning[];
  blocked_operations?: QuickOrderBlockedOperation[];
  actions?: QuickOrderAssistantAction[];
  context_patch?: Record<string, unknown> | null;
  contextPatch?: Record<string, unknown> | null;
  mutation_id?: string | null;
  mutationId?: string | null;
  reverted?: boolean;
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
const MISSING_ITEM_THROTTLE_COOLDOWN_MS = 120_000;
const ORDER_SUBMIT_UI_TIMEOUT_MS = 20_000;

/** Quick-action pills shown above the composer input. */
const COMPOSER_SUGGESTION_PILLS: {
  id: "last_week" | "recent" | "usual";
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: boolean;
}[] = [
  { id: "usual", label: "Usual", icon: "sparkles", accent: true },
  { id: "recent", label: "Recent", icon: "time-outline" },
  { id: "last_week", label: "Last week", icon: "calendar-outline" },
];

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

function normalizeMissingItemSuggestions(value: unknown): MissingItemSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): MissingItemSuggestion | null => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const itemId = typeof row.itemId === "string" ? row.itemId : typeof row.item_id === "string" ? row.item_id : null;
      const itemName = typeof row.itemName === "string" ? row.itemName : typeof row.item_name === "string" ? row.item_name : null;
      const quantity = typeof row.suggestedQuantity === "number"
        ? row.suggestedQuantity
        : typeof row.suggested_quantity === "number"
          ? row.suggested_quantity
          : Number(row.suggestedQuantity ?? row.suggested_quantity);
      if (!itemId || !itemName || !Number.isFinite(quantity) || quantity <= 0) return null;
      const confidence = row.confidence === "high" || row.confidence === "medium" || row.confidence === "low"
        ? row.confidence
        : "low";
      const source = row.source === "last_week" || row.source === "same_weekday" || row.source === "usual_pattern" || row.source === "imported_history"
        ? row.source
        : "usual_pattern";
      return {
        itemId,
        itemName,
        suggestedQuantity: quantity,
        unit: typeof row.unit === "string" ? row.unit : null,
        confidence,
        reason: typeof row.reason === "string" ? row.reason : "Usually appears in similar orders.",
        source,
        occurrenceCount: Number(row.occurrenceCount ?? row.occurrence_count ?? 0) || 0,
        sampleSize: Number(row.sampleSize ?? row.sample_size ?? 0) || 0,
      };
    })
    .filter((entry): entry is MissingItemSuggestion => Boolean(entry));
}

function buildQuickOrderCartHash(items: ParsedQuickOrderItem[]): string {
  return items
    .filter((item) => item.item_id && item.quantity != null)
    .map((item) => `${item.item_id}:${Number(item.quantity ?? 0).toFixed(4)}:${String(item.unit ?? "").trim().toLowerCase()}`)
    .sort()
    .join("|");
}

function missingSuggestionToQuickOrderSuggestion(suggestion: MissingItemSuggestion): QuickOrderSuggestion {
  return {
    type: "missing_item",
    title: suggestion.itemName,
    message: suggestion.reason,
    item_id: suggestion.itemId,
    item_name: suggestion.itemName,
    suggested_qty: suggestion.suggestedQuantity,
    unit: suggestion.unit,
    unit_type: null,
    confidence: suggestion.confidence === "high" ? 0.92 : suggestion.confidence === "medium" ? 0.74 : 0.55,
    reason: suggestion.reason,
    action: "add",
    items: [{
      item_id: suggestion.itemId,
      item_name: suggestion.itemName,
      quantity: suggestion.suggestedQuantity,
      unit: suggestion.unit,
      unit_type: null,
    }],
  };
}

function recommendationsToParsedItems(
  recommendations: QuickOrderRecommendation[],
): ParsedQuickOrderItem[] {
  return recommendations.map((item, index) => ({
    line_id: `recommendation:${item.item_id}:${item.unit ?? "unit"}:${index}`,
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
    source: "remaining_recommendation",
    isSuggested: true,
    suggestionReason: item.reason,
    suggestionSource: "remaining_inventory",
    resolution: item.resolution,
    reason_codes: item.reason_codes,
    resolution_trace: item.resolution_trace,
    user_visible_note: item.user_visible_note,
  }));
}

/**
 * One row of the inventory-mode "Updated" card: the item the user counted, its
 * current on-hand quantity, and the quantity the system chose to order
 * (`new_quantity`). `new_quantity` is null when no order was suggested for it.
 */
type QuickOrderInventoryUpdate = {
  item_id: string;
  item_name: string;
  current_quantity: number | null;
  current_unit: string | null;
  new_quantity: number | null;
  new_unit: string | null;
  no_order_reason?: string | null;
};

/**
 * Joins recorded stock counts with the order quantities the assistant suggested
 * for the same items, producing the rows shown in the inventory "Updated" card.
 * Each row keeps the counted quantity and, when a matching recommendation
 * exists, the suggested order quantity to display after the arrow.
 */
function buildInventoryUpdateRows(
  stockUpdates: QuickOrderStockUpdate[],
  recommendations: QuickOrderRecommendation[],
  safetyWarnings: QuickOrderSafetyWarning[] = [],
): QuickOrderInventoryUpdate[] {
  const recommendationByItemId = new Map<string, QuickOrderRecommendation>();
  for (const recommendation of recommendations) {
    if (!recommendation.item_id) continue;
    if (!recommendationByItemId.has(recommendation.item_id)) {
      recommendationByItemId.set(recommendation.item_id, recommendation);
    }
  }
  const noOrderReasonByItemKey = new Map<string, string>();
  for (const warning of safetyWarnings) {
    if (warning.type !== "no_order_needed" || !warning.message) continue;
    const key = warning.item_id ?? warning.item_name?.trim().toLowerCase();
    if (key && !noOrderReasonByItemKey.has(key)) {
      noOrderReasonByItemKey.set(key, warning.message);
    }
  }
  const rows: QuickOrderInventoryUpdate[] = stockUpdates.map((update) => {
    const recommendation = update.item_id
      ? recommendationByItemId.get(update.item_id)
      : undefined;
    const noOrderReason = recommendation
      ? null
      : noOrderReasonByItemKey.get(update.item_id) ??
        noOrderReasonByItemKey.get(update.item_name.trim().toLowerCase()) ??
        null;
    return {
      item_id: update.item_id,
      item_name: update.item_name,
      current_quantity: update.quantity,
      current_unit: update.unit,
      new_quantity: recommendation ? recommendation.suggested_quantity : null,
      new_unit: recommendation ? recommendation.unit : update.unit,
      no_order_reason: noOrderReason,
    };
  });
  const existingKeys = new Set(
    rows.map((row) => row.item_id || row.item_name.trim().toLowerCase()),
  );
  for (const warning of safetyWarnings) {
    if (warning.type !== "no_order_needed") continue;
    const itemName = warning.item_name?.trim();
    if (!itemName) continue;
    const key = warning.item_id || itemName.toLowerCase();
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    rows.push({
      item_id: warning.item_id ?? key,
      item_name: itemName,
      current_quantity: null,
      current_unit: null,
      new_quantity: null,
      new_unit: warning.unit ?? null,
      no_order_reason: warning.message,
    });
  }
  return rows;
}

/**
 * Builds the concise gray "why" notes for a reply (inventory rules, personal
 * aliases, spelling corrections, inferred units, …). See
 * {@link buildQuickOrderContextNotes} — this thin wrapper just feeds it the
 * message's structured fields.
 */
function deriveContextNotes(message: QuickOrderMessage): QuickOrderContextNote[] {
  return buildQuickOrderContextNotes({
    parsedItems: message.parsedItems,
    stockUpdates: message.stockUpdates,
    recommendations: message.recommendations,
    safetyWarnings: message.safetyWarnings,
    inventoryUpdates: message.inventoryUpdates,
  });
}

/**
 * The gray disclosure above a reply that explains a non-obvious decision. The
 * heading names what happened (e.g. "Inventory rules", "Personal context") and
 * "Show more" reveals the one-line reasons — so a surprising result like
 * "Salmon — 0" comes with the rule that produced it ("a lot" → no order).
 */
const ContextNotesDisclosure = React.memo(function ContextNotesDisclosure({
  notes,
}: {
  notes: QuickOrderContextNote[];
}) {
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => {
    void triggerSelectionHaptic();
    setExpanded((prev) => !prev);
  }, []);

  if (notes.length === 0) return null;
  const header = getQuickOrderContextNotesHeader(notes);

  return (
    <View style={styles.personalContextDisclosure}>
      <Text style={styles.personalContextNote}>
        {header}
      </Text>
      {expanded ? (
        <Text style={styles.personalContextNote}>
          {notes.map((note) => note.text).join("\n")}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? `Hide ${header}` : `Show ${header}`}
        onPress={handleToggle}
        hitSlop={8}
      >
        <Text style={styles.personalContextToggle}>
          {expanded ? "Show less" : "Show more"}
        </Text>
      </Pressable>
    </View>
  );
});

function markHumanOrderItems(items: ParsedQuickOrderItem[]): ParsedQuickOrderItem[] {
  return items.map((item) => ({
    ...item,
    source: "manual",
    isSuggested: false,
    suggestionReason: undefined,
    suggestionSource: undefined,
  }));
}

function voiceActionToParsedItem(
  action: VoiceParsedAction,
  review: VoiceReviewState,
): ParsedQuickOrderItem | null {
  if (
    action.type !== "add" ||
    !action.itemId ||
    action.quantity == null ||
    !Number.isFinite(action.quantity) ||
    action.quantity <= 0 ||
    !action.unit?.trim()
  ) {
    return null;
  }

  const itemName = action.canonicalItemName ?? action.itemName;
  return {
    item_id: action.itemId,
    item_name: itemName,
    display_name: itemName,
    item_text: itemName,
    raw_token: action.sourceText || action.spokenItemName || itemName,
    raw_text: action.sourceText || review.normalizedText,
    quantity: action.quantity,
    unit: action.unit,
    confidence: action.confidence,
    needs_clarification: false,
    unresolved: false,
    status: "valid",
    action: null,
    notes: null,
    parse_source: "llm",
    source: "voice",
    isSuggested: false,
    client_key: createQuickOrderClientKey("voice"),
    voiceSessionId: review.voiceEventId,
    rawTranscript: review.rawTranscript,
    normalizedText: review.normalizedText,
    modelUsed: review.modelUsed,
    voiceConfidence: review.confidence,
  };
}

function voiceSafeAddActions(review: VoiceReviewState | null): VoiceParsedAction[] {
  if (!review) return [];
  return review.actions.filter((action) =>
    action.type === "add" &&
    Boolean(action.itemId) &&
    action.quantity != null &&
    Number.isFinite(action.quantity) &&
    action.quantity > 0 &&
    Boolean(action.unit?.trim())
  );
}

function formatVoiceReviewAction(action: VoiceParsedAction): string {
  const name = action.canonicalItemName ?? action.itemName;
  if (action.quantity == null || !action.unit) return name;
  return `${name} - ${formatQuickOrderQuantity(action.quantity, action.unit)}`;
}

function voiceUnresolvedLabel(entry: VoiceUnresolvedAction): string {
  const source = entry.sourceText || entry.spokenItemName || "voice input";
  switch (entry.reason) {
    case "missing_quantity":
      return `"${source}" - add quantity`;
    case "missing_unit":
      return `"${source}" - choose unit`;
    case "ambiguous_item":
      return `"${source}" - choose item`;
    case "low_confidence":
      return `"${source}" - low confidence`;
    case "unsupported_command":
      return `"${source}" - not an order`;
    case "unknown_item":
    default:
      return `"${source}" - unknown item`;
  }
}

const VoiceReviewCard = React.memo(function VoiceReviewCard({
  review,
  status,
  onAdd,
  onEditText,
  onRetry,
  onDiscard,
}: {
  review: VoiceReviewState;
  status: QuickOrderVoiceStatus;
  onAdd: () => void;
  onEditText: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const ds = useScaledStyles();
  const safeActions = voiceSafeAddActions(review);
  const isAdding = status === "adding_to_order";
  const canAdd = safeActions.length > 0 && !isAdding;

  return (
    <View
      style={[
        styles.voiceReviewCard,
        {
          borderRadius: ds.radius(18),
          padding: ds.spacing(14),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <View style={styles.voiceReviewHeader}>
        <Ionicons name="mic-circle" size={ds.icon(20)} color={quickOrderAccent} />
        <Text style={[styles.voiceReviewTitle, { fontSize: ds.fontSize(16) }]}>
          Suggested from voice
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard voice suggestion"
          onPress={onDiscard}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="close" size={ds.icon(18)} color={colors.textMuted} />
        </Pressable>
      </View>

      {safeActions.length > 0 ? (
        <View style={{ marginTop: ds.spacing(10), gap: ds.spacing(7) }}>
          {safeActions.map((action, index) => (
            <View key={`${action.itemId}:${action.unit}:${index}`} style={styles.voiceReviewRow}>
              <Ionicons name="checkmark-circle" size={ds.icon(17)} color={colors.statusGreen} />
              <Text style={[styles.voiceReviewRowText, { fontSize: ds.fontSize(15) }]} numberOfLines={1}>
                {formatVoiceReviewAction(action)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.voiceReviewMutedText, { fontSize: ds.fontSize(14), marginTop: ds.spacing(8) }]}>
          I cleaned the voice input, but could not safely match an item yet.
        </Text>
      )}

      {review.unresolved.length > 0 ? (
        <View style={[styles.voiceReviewUnresolved, { marginTop: ds.spacing(12), padding: ds.spacing(10), borderRadius: ds.radius(12) }]}>
          <Text style={[styles.voiceReviewSectionLabel, { fontSize: ds.fontSize(12) }]}>
            Needs review
          </Text>
          {review.unresolved.slice(0, 4).map((entry, index) => (
            <Text key={`${entry.reason}:${index}`} style={[styles.voiceReviewWarningText, { fontSize: ds.fontSize(13) }]}>
              {voiceUnresolvedLabel(entry)}
              {entry.alternatives?.length ? ` - did you mean ${entry.alternatives.map((alt) => alt.itemName).join(" or ")}?` : ""}
            </Text>
          ))}
        </View>
      ) : null}

      {review.warnings.length > 0 && review.unresolved.length === 0 ? (
        <Text style={[styles.voiceReviewMutedText, { fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }]} numberOfLines={2}>
          {review.warnings.join(" ")}
        </Text>
      ) : null}

      <View style={[styles.voiceReviewActions, { marginTop: ds.spacing(12), gap: ds.spacing(8) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add voice items to order"
          disabled={!canAdd}
          onPress={onAdd}
          style={({ pressed }) => [
            styles.voiceReviewPrimaryButton,
            {
              borderRadius: ds.radius(12),
              paddingVertical: ds.spacing(10),
              opacity: !canAdd ? 0.45 : pressed ? 0.82 : 1,
            },
          ]}
        >
          {isAdding ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Text style={[styles.voiceReviewPrimaryText, { fontSize: ds.fontSize(14) }]}>
              Add to order
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit voice text"
          onPress={onEditText}
          style={({ pressed }) => [
            styles.voiceReviewSecondaryButton,
            {
              borderRadius: ds.radius(12),
              paddingVertical: ds.spacing(10),
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text style={[styles.voiceReviewSecondaryText, { fontSize: ds.fontSize(14) }]}>
            Edit text
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry voice recording"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.voiceReviewSecondaryButton,
            {
              borderRadius: ds.radius(12),
              paddingVertical: ds.spacing(10),
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <Text style={[styles.voiceReviewSecondaryText, { fontSize: ds.fontSize(14) }]}>
            Retry
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

function isInventoryCountReviewItem(item: ParsedQuickOrderItem | null | undefined): boolean {
  return item?.source === "remaining_inventory" ||
    item?.source === "remaining_recommendation" ||
    item?.suggestionSource === "remaining_inventory";
}

function orderInventoryModeItemsByMessage(input: {
  rawText: string;
  reviewItems: ParsedQuickOrderItem[];
  recommendationItems: ParsedQuickOrderItem[];
  stockUpdates: QuickOrderStockUpdate[];
}): ParsedQuickOrderItem[] {
  const reviewQueue = [...input.reviewItems];
  const recommendationByItemId = new Map<string, ParsedQuickOrderItem[]>();
  for (const item of input.recommendationItems) {
    if (!item.item_id) continue;
    const current = recommendationByItemId.get(item.item_id) ?? [];
    current.push(item);
    recommendationByItemId.set(item.item_id, current);
  }

  const stockByText = new Map<string, QuickOrderStockUpdate[]>();
  for (const update of input.stockUpdates) {
    const key = normalizeInventoryLineKey(update.original_text);
    if (!key) continue;
    const current = stockByText.get(key) ?? [];
    current.push(update);
    stockByText.set(key, current);
  }

  const ordered: ParsedQuickOrderItem[] = [];
  const consumedReviews = new Set<ParsedQuickOrderItem>();
  const consumedRecommendations = new Set<ParsedQuickOrderItem>();
  const lines = splitInventoryInputLines(input.rawText);

  for (const line of lines) {
    const lineKey = normalizeInventoryLineKey(line);
    const reviewIndex = reviewQueue.findIndex((item) =>
      normalizeInventoryLineKey(item.raw_text ?? item.raw_token ?? "") === lineKey ||
      normalizeInventoryLineKey(item.item_name ?? item.display_name ?? "") === lineKey
    );
    if (reviewIndex >= 0) {
      const [review] = reviewQueue.splice(reviewIndex, 1);
      consumedReviews.add(review);
      ordered.push(review);
      continue;
    }

    const stockQueue = stockByText.get(lineKey);
    const stock = stockQueue?.shift();
    if (!stock?.item_id) continue;
    const recommendationQueue = recommendationByItemId.get(stock.item_id);
    const recommendation = recommendationQueue?.shift();
    if (!recommendation) continue;
    consumedRecommendations.add(recommendation);
    ordered.push(recommendation);
  }

  for (const item of input.reviewItems) {
    if (!consumedReviews.has(item)) ordered.push(item);
  }
  for (const item of input.recommendationItems) {
    if (!consumedRecommendations.has(item)) ordered.push(item);
  }
  return ordered;
}

function splitInventoryInputLines(value: string): string[] {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split(/\n|,|;/)
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean);
}

function normalizeInventoryLineKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[ \t]+/g, " ")
    .toLowerCase();
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

function normalizeAssistantActions(value: unknown): QuickOrderAssistantAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as QuickOrderAssistantAction)
        : null,
    )
    .filter((entry): entry is QuickOrderAssistantAction =>
      Boolean(entry?.id && entry.type && entry.label),
    );
}

function normalizeContextPatch(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getContextPatchParsedItems(
  contextPatch: Record<string, unknown> | null | undefined,
): ParsedQuickOrderItem[] | null {
  if (!contextPatch) return null;
  const value = contextPatch.parsed_items ?? contextPatch.parsedItems;
  return Array.isArray(value) ? normalizeParsedItems(value) : null;
}

function getRevertAction(message: QuickOrderMessage): QuickOrderAssistantAction | null {
  if (message.role !== "assistant" || !message.mutationId) return null;
  const explicit = (message.actions ?? []).find((action) => {
    const key = `${action.type} ${action.operation ?? ""} ${action.id}`.toLowerCase();
    return key.includes("revert") && (action.mutationId ?? message.mutationId);
  });
  return explicit ?? {
    id: `revert:${message.mutationId}`,
    type: "revert",
    operation: "revert",
    label: "Revert",
    mutationId: message.mutationId,
  };
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
        inventoryUpdates: Array.isArray(message.inventory_updates)
          ? message.inventory_updates
          : [],
        safetyWarnings: Array.isArray(message.safety_warnings)
          ? message.safety_warnings
          : [],
        blockedOperations: Array.isArray(message.blocked_operations)
          ? message.blocked_operations
          : [],
        actions: normalizeAssistantActions(message.actions),
        contextPatch: normalizeContextPatch(
          message.context_patch ?? message.contextPatch,
        ),
        mutationId:
          typeof message.mutation_id === "string"
            ? message.mutation_id
            : typeof message.mutationId === "string"
              ? message.mutationId
              : null,
        reverted: Boolean(message.reverted),
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
      inventory_updates: message.inventoryUpdates ?? [],
      safety_warnings: message.safetyWarnings ?? [],
      blocked_operations: message.blockedOperations ?? [],
      actions: message.actions ?? [],
      context_patch: message.contextPatch ?? null,
      mutation_id: message.mutationId ?? null,
      reverted: Boolean(message.reverted),
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
  // A confirmation like "Added …", "Updated …" or "Removed …" is a success even
  // when the parsed items aren't carried on the message (e.g. a cart mutation)
  // or when a benign parser flag rode along. Anything ending in a question is a
  // prompt, not a confirmation.
  const looksLikeSuccess =
    /^\s*(added|updated|removed|set|cleared|reverted|done)\b/i.test(message.text ?? "") &&
    !(message.text ?? "").includes("?");
  // A genuine "the user must fix something" signal. Benign flags alone don't
  // count when the message already reads as a success confirmation.
  const hasBlockingIssue =
    pendingCount > 0 ||
    Boolean(flaggedItem) ||
    Boolean(message.safetyWarnings?.length) ||
    Boolean(message.blockedOperations?.length);
  const hasUserFix =
    hasBlockingIssue ||
    (flags.length > 0 && items.length === 0 && !looksLikeSuccess);

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

  if (addedItem || looksLikeSuccess || message.mutationId) {
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
    color: looksLikeNoChange ? colors.statusGreen : quickOrderAccent,
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
        <Text
          key={index}
          style={{
            fontWeight: "800",
            ...(Platform.OS === "android" ? { backgroundColor: "transparent" } : null),
          }}
        >
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

type CardBadgeTone =
  | "needs-input"
  | "added"
  | "info"
  | "dismissed"
  | "voided"
  | "reverted";

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
  voided: {
    label: "VOIDED",
    icon: "close-circle",
    background: "#F3F4F6",
    foreground: "#6B7280",
  },
  reverted: {
    label: "REVERTED",
    icon: "arrow-undo",
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
        Platform.OS === "android" ? styles.aiPillTextAndroid : null,
      ]}>
        {renderInlineMarkdown(text)}
      </Text>
    </Animated.View>
  );
});

type InlineRevertButtonProps = {
  reverting: boolean;
  reverted: boolean;
  disabled?: boolean;
  label?: string;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

/**
 * Subtle "Revert" affordance that sits beneath a successful cart-mutation
 * bubble — the assistant-side mirror of the "Copy" control under user messages.
 * Becomes a non-interactive green "Reverted" state once the undo runs.
 */
const InlineRevertButton = React.memo(function InlineRevertButton({
  reverting,
  reverted,
  disabled,
  label,
  onPress,
  onLayout,
}: InlineRevertButtonProps) {
  const ds = useScaledStyles();
  const isDisabled = reverting || reverted || disabled;
  const text = reverted ? "Reverted" : reverting ? "Reverting…" : label || "Revert";
  const tint = reverted
    ? colors.statusGreen
    : isDisabled
      ? colors.textMuted
      : quickOrderAccent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      disabled={isDisabled}
      hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
      onLayout={onLayout}
      onPress={onPress}
      style={({ pressed }) => [
        styles.revertAffordance,
        { marginTop: ds.spacing(4), opacity: pressed ? 0.5 : 1 },
      ]}
    >
      <View style={[styles.revertAffordanceRow, { gap: ds.spacing(6) }]}>
        <Ionicons
          name={reverted ? "checkmark" : "arrow-undo"}
          size={ds.icon(13)}
          color={tint}
        />
        <Text
          style={[
            styles.revertAffordanceText,
            { fontSize: ds.fontSize(12), color: tint },
          ]}
        >
          {text}
        </Text>
      </View>
    </Pressable>
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
    return null;
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
  /** Instant-add path for single-item suggestions ("Use this"). */
  onAdd: (suggestion: QuickOrderSuggestion) => void | Promise<void>;
  onReject: (suggestion: QuickOrderSuggestion) => void | Promise<void>;
  /** Drop a multi-item reorder into the composer for inline editing. */
  onPreview: (suggestion: QuickOrderSuggestion) => void;
  /** Clear any previewed text back out of the composer. */
  onDiscard: (suggestion: QuickOrderSuggestion) => void;
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

type SuggestionDecision = "pending" | "accepted" | "rejected" | "voided";

const SuggestionCard = React.memo(function SuggestionCard({
  suggestion,
  onAdd,
  onReject,
  onPreview,
  onDiscard,
  onLayout,
}: SuggestionCardProps) {
  const ds = useScaledStyles();
  const [decision, setDecision] = useState<SuggestionDecision>("pending");

  const items = getSuggestionItems(suggestion);
  // Multi-item (history reorder) suggestions drop into the composer for inline
  // editing; single-item suggestions keep the lightweight instant-add behavior.
  const usesPreviewFlow = items.length > 1;
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

  const handlePreview = useCallback(() => {
    void triggerSelectionHaptic();
    onPreview(suggestion);
  }, [onPreview, suggestion]);

  const handleDiscard = useCallback(() => {
    void triggerSelectionHaptic();
    onDiscard(suggestion);
    setDecision("voided");
  }, [onDiscard, suggestion]);

  // ----- single-item legacy states -----
  if (decision === "accepted") {
    return null;
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

  if (decision === "voided") {
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
        <CardBadge tone="voided" />
        <Text
          style={[
            styles.chatWhiteCardText,
            { fontSize: ds.fontSize(15), marginTop: ds.spacing(8) },
          ]}
        >
          Suggestion discarded.
        </Text>
      </Animated.View>
    );
  }

  const messageWithBold = boldifyTerm(message, addedTitle);

  // ----- pending -----
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
      {usesPreviewFlow ? (
        <NeedsInputActionButtons
          primaryActions={[
            {
              key: `${suggestion.item_id ?? title}:preview`,
              label: "Preview",
              accessibilityLabel: `Preview ${title}`,
              onPress: handlePreview,
            },
          ]}
          onReject={handleDiscard}
          rejectLabel="Discard"
          rejectAccessibilityLabel={`Discard ${title}`}
        />
      ) : (
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
  const info = warning.severity === "info";
  const noOrderNeeded = warning.type === "no_order_needed";
  const iconName = blocked
    ? "ban-outline"
    : noOrderNeeded
      ? "checkmark-circle-outline"
      : info
        ? "information-circle-outline"
        : "warning-outline";
  const iconColor = blocked
    ? colors.statusRed
    : noOrderNeeded
      ? colors.statusGreen
      : info
        ? quickOrderAccent
        : colors.statusAmber;
  const title = noOrderNeeded
    ? "No order needed"
    : info
      ? "Needs input"
      : null;
  return (
    <View
      onLayout={onLayout}
      style={[
        styles.noticeCard,
        blocked ? styles.blockedCard : info ? styles.stockCard : styles.warningCard,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons
        name={iconName}
        size={ds.icon(18)}
        color={iconColor}
      />
      <View style={{ flex: 1, gap: ds.spacing(2) }}>
        {title ? (
          <Text style={[styles.stockTitle, { fontSize: ds.fontSize(13) }]}>
            {title}
          </Text>
        ) : null}
        <Text style={[styles.noticeText, { fontSize: ds.fontSize(14) }]}>
          {warning.message}
        </Text>
      </View>
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
      <Ionicons name="clipboard-outline" size={ds.icon(18)} color={quickOrderAccent} />
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

const INVENTORY_UPDATE_COLLAPSED_COUNT = 4;

/**
 * Inventory-mode confirmation card. Replaces the older "Current stock" list and
 * the separate text reply: it shows each counted item as
 * `name  current → ordered`, making the system's chosen order quantity obvious
 * at a glance. When more than {@link INVENTORY_UPDATE_COLLAPSED_COUNT} items
 * came back, the extra rows collapse behind a tappable "+N more" toggle.
 */
const InventoryUpdateCard = React.memo(function InventoryUpdateCard({
  updates,
  onLayout,
}: {
  updates: QuickOrderInventoryUpdate[];
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => {
    void triggerSelectionHaptic();
    setExpanded((prev) => !prev);
  }, []);
  if (updates.length === 0) return null;
  const hasOverflow = updates.length > INVENTORY_UPDATE_COLLAPSED_COUNT;
  const visibleUpdates =
    expanded || !hasOverflow
      ? updates
      : updates.slice(0, INVENTORY_UPDATE_COLLAPSED_COUNT);
  const hiddenCount = updates.length - INVENTORY_UPDATE_COLLAPSED_COUNT;

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
      <Ionicons name="clipboard-outline" size={ds.icon(18)} color={quickOrderAccent} />
      <View style={[styles.stockTextCluster, { marginLeft: ds.spacing(8), gap: ds.spacing(4) }]}>
        <Text style={[styles.stockTitle, { fontSize: ds.fontSize(13) }]}>
          Updated
        </Text>
        {visibleUpdates.map((update, index) => (
          <View
            key={`${update.item_id}:${index}`}
            style={[styles.inventoryUpdateRow, { gap: ds.spacing(6) }]}
          >
            <Text style={[styles.stockRowText, { fontSize: ds.fontSize(14) }]}>
              {update.item_name}
              {update.current_quantity != null
                ? ` ${formatQuickOrderQuantity(update.current_quantity, update.current_unit)}`
                : ""}
            </Text>
            {update.new_quantity != null ? (
              <>
                <Ionicons
                  name="arrow-forward"
                  size={ds.icon(14)}
                  color={colors.textSecondary}
                />
                <Text style={[styles.inventoryUpdateNewText, { fontSize: ds.fontSize(14) }]}>
                  {formatQuickOrderQuantity(update.new_quantity, update.new_unit)}
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.inventoryUpdateDashText, { fontSize: ds.fontSize(14) }]}>
                  –
                </Text>
                <Text style={[styles.inventoryUpdateNotOrderedText, { fontSize: ds.fontSize(14) }]}>
                  {formatQuickOrderQuantity(0, update.new_unit ?? update.current_unit)}
                </Text>
              </>
            )}
          </View>
        ))}
        {hasOverflow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? "Show fewer items" : `Show ${hiddenCount} more items`
            }
            onPress={handleToggle}
            hitSlop={8}
          >
            <Text style={[styles.stockMoreText, { fontSize: ds.fontSize(12) }]}>
              {expanded ? "Show less" : `+${hiddenCount} more`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const RecommendationCard = React.memo(function RecommendationCard({
  recommendations,
  onAdd,
  onPreview,
  onLayout,
}: {
  recommendations: QuickOrderRecommendation[];
  onAdd: (recommendations: QuickOrderRecommendation[]) => void | Promise<void>;
  onPreview: (recommendations: QuickOrderRecommendation[]) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  const [decision, setDecision] = useState<"pending" | "added" | "ignored" | "previewed">("pending");
  const usesPreview = recommendations.length > 1;
  const firstRecommendation = recommendations[0];
  const firstCurrentStock =
    typeof firstRecommendation?.inputs?.current_stock === "number" &&
    Number.isFinite(firstRecommendation.inputs.current_stock)
      ? firstRecommendation.inputs.current_stock
      : null;
  const firstOrderLabel = firstRecommendation
    ? `Order ${formatQuickOrderQuantity(firstRecommendation.suggested_quantity, firstRecommendation.unit)}`
    : "Order suggestion";

  const handleAdd = useCallback(() => {
    if (decision !== "pending") return;
    void triggerSelectionHaptic();
    setDecision("added");
    void onAdd(recommendations);
  }, [decision, onAdd, recommendations]);

  const handlePreview = useCallback(() => {
    if (decision !== "pending") return;
    void triggerSelectionHaptic();
    setDecision("previewed");
    onPreview(recommendations);
  }, [decision, onPreview, recommendations]);

  const handleIgnore = useCallback(() => {
    if (decision !== "pending") return;
    void triggerSelectionHaptic();
    setDecision("ignored");
  }, [decision]);

  if (recommendations.length === 0) return null;
  if (decision === "ignored" || decision === "added") return null;

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.recommendationCard,
        decision === "previewed" && styles.suggestionCardAdded,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <View style={styles.suggestionHeader}>
        <Ionicons name="sparkles-outline" size={ds.icon(18)} color={quickOrderAccent} />
        <View style={styles.suggestionTextCluster}>
          <Text style={[styles.suggestionTitle, { fontSize: ds.fontSize(15) }]}>
            {usesPreview ? "Suggested order" : recommendations[0].item_name}
          </Text>
          {usesPreview ? (
            <Text style={[styles.suggestionMessage, { fontSize: ds.fontSize(13) }]}>
              {recommendations
                .slice(0, 4)
                .map((item) => `${item.item_name} ${formatQuickOrderQuantity(item.suggested_quantity, item.unit)}`)
                .join(" · ")}
            </Text>
          ) : (
            <>
              {firstCurrentStock != null ? (
                <Text style={[styles.suggestionMessage, { fontSize: ds.fontSize(13) }]}>
                  Current: {formatQuickOrderQuantity(firstCurrentStock, recommendations[0].unit)} remaining
                </Text>
              ) : null}
              <Text style={[styles.suggestionMessage, { fontSize: ds.fontSize(13) }]}>
                Suggested order: {formatQuickOrderQuantity(recommendations[0].suggested_quantity, recommendations[0].unit)}
              </Text>
              <Text style={[styles.suggestionMessage, { fontSize: ds.fontSize(13) }]}>
                Reason: {recommendations[0].reason}
              </Text>
            </>
          )}
        </View>
      </View>
      <NeedsInputActionButtons
        primaryActions={[
          {
            key: usesPreview ? "preview-recommendations" : "add-recommendation",
            label: decision === "previewed" ? "Previewed" : usesPreview ? "Preview suggestions" : firstOrderLabel,
            accessibilityLabel: usesPreview ? "Preview suggested order" : "Add suggested order",
            onPress: usesPreview ? handlePreview : handleAdd,
          },
        ]}
        onReject={handleIgnore}
        rejectLabel="Ignore"
        rejectAccessibilityLabel="Ignore suggested order"
      />
    </View>
  );
});

export function QuickOrderScreen({ mode }: QuickOrderScreenProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const chatListRef = useRef<FlatList<QuickOrderMessage> | null>(null);
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const allLocations = useAuthStore((state) => state.locations);
  const setAuthLocation = useAuthStore((state) => state.setLocation);
  const { location } = useResolvedActiveLocation();
  const tabBarHeight = 60 + getTabBarBottomInset(insets.bottom);
  const audioRecorder = useAudioRecorder(QUICK_ORDER_RECORDING_OPTIONS);
  const audioRecorderState = useAudioRecorderState(audioRecorder, 100);

  const [composerHeight, setComposerHeight] = useState(0);
  const [composerBottomOffset, setComposerBottomOffset] =
    useState(tabBarHeight);
  // Text pushed into the composer (e.g. from a reorder Preview tap). The nonce
  // forces the composer to re-apply even when the text is unchanged.
  const [composerPrefill, setComposerPrefill] = useState<{
    text: string;
    nonce: number;
  }>({ text: "", nonce: 0 });
  const composerMode = useSettingsStore((state) => state.quickOrderComposerMode);
  const setComposerMode = useSettingsStore((state) => state.setQuickOrderComposerMode);
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
  const [revertingMutationIds, setRevertingMutationIds] = useState<
    Record<string, true>
  >({});
  const [isConfirming, setIsConfirming] = useState(false);
  const [showConfirmLocationSheet, setShowConfirmLocationSheet] = useState(false);
  const [confirmLocationId, setConfirmLocationId] = useState<string | null>(null);
  const [orderConfirmation, setOrderConfirmation] =
    useState<OrderConfirmationPayload | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<QuickOrderVoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceReview, setVoiceReview] = useState<VoiceReviewState | null>(null);
  const [lastVoiceRecording, setLastVoiceRecording] = useState<{
    uri: string;
    durationMs: number;
  } | null>(null);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [smartMissingCheck, setSmartMissingCheck] = useState<SmartMissingCheck>({
    status: "idle",
    suggestions: [],
    ignoredItemIds: [],
    source: "proactive",
  });
  const [missingReviewVisible, setMissingReviewVisible] = useState(false);
  const [selectedMissingItemIds, setSelectedMissingItemIds] = useState<Record<string, true>>({});
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [floatingCardHeight, setFloatingCardHeight] = useState(() =>
    ds.spacing(INITIAL_CARD_HEIGHT_ESTIMATE),
  );
  const lastUserTextRef = useRef("");
  const requestGenerationRef = useRef(0);
  const isSendingRef = useRef(false);
  const voiceMachineRef = useRef({
    status: "idle" as QuickOrderVoiceStatus,
    uploadInFlight: false,
    errorCode: null as QuickOrderVoiceErrorCode | null,
  });
  const pendingVoiceDraftMetadataRef = useRef<{
    raw_transcript?: string;
    transcript_confidence?: number;
    language?: string;
  } | null>(null);
  const voiceReviewAddInFlightRef = useRef(false);
  const recordingStartTimeRef = useRef<number | null>(null);
  const maxRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVoiceStoppingRef = useRef(false);
  const isConfirmingRef = useRef(false);
  const quickOrderPendingOrderIdRef = useRef<string | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatScrollFrameRef = useRef<number | null>(null);
  const chatScrollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const missingCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missingCheckRequestRef = useRef(0);
  const missingCheckCooldownUntilRef = useRef(0);
  const skipMissingReviewOnceRef = useRef(false);
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

  useEffect(() => {
    setComposerMode("order");
  }, [mode.scope, setComposerMode]);

  const userId = user?.id ?? null;
  const locationId = location?.id ?? null;
  // The order-list header shows only the last word of the location name
  // ("Babytuna Sushi" → "Sushi") to keep the compact pill short.
  const locationShortLabel = useMemo(() => {
    const name = location?.name?.trim() ?? "";
    if (!name) return "";
    const parts = name.split(/\s+/);
    return parts[parts.length - 1];
  }, [location?.name]);
  const applyVoiceEvent = useCallback(
    (event: QuickOrderVoiceEvent, errorCode: QuickOrderVoiceErrorCode | null = null) => {
      const next = reduceQuickOrderVoiceState(voiceMachineRef.current, event, errorCode);
      voiceMachineRef.current = next;
      setVoiceStatus(next.status);
    },
    [],
  );
  const isOrderBusy =
    isSending ||
    isConfirming ||
    showConfirmLocationSheet ||
    orderConfirmation != null;
  const voiceEnabled =
    process.env.EXPO_PUBLIC_ENABLE_QUICK_ORDER_VOICE === "true";

  const submitLocationOptions = useMemo(() => {
    const optionsById = new Map<string, { id: string; name: string; shortCode?: string }>();
    const activeLocations = allLocations.filter((option) => option.active !== false);
    const sourceLocations = activeLocations.length > 0 ? activeLocations : allLocations;

    sourceLocations.forEach((option) => {
      optionsById.set(option.id, {
        id: option.id,
        name: option.name,
        shortCode: option.short_code,
      });
    });

    if (location && !optionsById.has(location.id)) {
      optionsById.set(location.id, {
        id: location.id,
        name: location.name,
        shortCode: location.short_code,
      });
    }

    return Array.from(optionsById.values());
  }, [allLocations, location]);

  const locationNameById = useMemo(() => {
    const next = new Map<string, string>();
    submitLocationOptions.forEach((option) => {
      next.set(option.id, option.name);
    });
    return next;
  }, [submitLocationOptions]);

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
      setRevertingMutationIds({});
      setConfirmedClarifications({});
      setDismissedClarifications({});
      setParsedItems([]);
      setPendingClarifications([]);
      setSmartMissingCheck({
        status: "idle",
        suggestions: [],
        ignoredItemIds: [],
        source: "proactive",
      });
      setMissingReviewVisible(false);
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
        setRevertingMutationIds({});
        setParsedItems(normalizeParsedItems(row?.parsed_items));
        setSmartMissingCheck({
          status: "idle",
          suggestions: [],
          ignoredItemIds: [],
          source: "proactive",
        });
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
          setRevertingMutationIds({});
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
        setRevertingMutationIds({});
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
      if (maxRecordingTimerRef.current) {
        clearTimeout(maxRecordingTimerRef.current);
      }
      if (audioRecorder.isRecording) {
        try {
          void audioRecorder.stop();
        } catch {
          // Recorder may already be stopped during unmount.
        }
      }
    },
    [audioRecorder],
  );

  useEffect(() => {
    if (!voiceEnabled) return undefined;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || !audioRecorder.isRecording) return;
      try {
        void audioRecorder.stop();
      } catch {
        // Recorder may already be stopped.
      }
      applyVoiceEvent("cancel");
      setVoiceReview(null);
      setVoiceError("Recording stopped when the app moved to the background.");
    });
    return () => {
      subscription.remove();
    };
  }, [applyVoiceEvent, audioRecorder, voiceEnabled]);

  const issueCount = useMemo(
    () => countUnresolvedItems(parsedItems) + pendingClarifications.length,
    [parsedItems, pendingClarifications.length],
  );

  const highConfidenceMissingSuggestions = useMemo(
    () =>
      smartMissingCheck.suggestions.filter(
        (suggestion) =>
          suggestion.confidence === "high" &&
          !smartMissingCheck.ignoredItemIds.includes(suggestion.itemId),
      ),
    [smartMissingCheck.ignoredItemIds, smartMissingCheck.suggestions],
  );

  const showWelcomeMessage = useMemo(
    () =>
      !isLoadingSession &&
      !sessionLoadError &&
      shouldShowQuickOrderWelcomeMessage(parsedItems.length, messages),
    [isLoadingSession, messages, parsedItems.length, sessionLoadError],
  );

  // Composer suggestion pills are independent of the (first-load-only) welcome
  // card: they reappear whenever the order list is empty, including after
  // sending an order or clearing it via the trash icon.
  const showComposerPills = useMemo(
    () => !isLoadingSession && !sessionLoadError && parsedItems.length === 0,
    [isLoadingSession, sessionLoadError, parsedItems.length],
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
    setRevertingMutationIds({});
    setConfirmedClarifications({});
      setDismissedClarifications({});
    setParsedItems([]);
    setPendingClarifications([]);
    setEditingState(null);
    setQuantityFlow(null);
    setQuantitySuggestions(new Map());
    setVoiceError(null);
    setVoiceReview(null);
    setLastVoiceRecording(null);
    applyVoiceEvent("reset");
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
  }, [applyVoiceEvent, isOrderBusy, sessionId]);

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

  const runMissingItemCheck = useCallback(
    async (source: "proactive" | "manual") => {
      if (!userId || !locationId) return null;
      if (
        source === "proactive" &&
        missingCheckCooldownUntilRef.current > Date.now()
      ) {
        return null;
      }
      const cartHash = buildQuickOrderCartHash(parsedItems);
      const ignoredItemIds = smartMissingCheck.ignoredItemIds;
      const requestId = ++missingCheckRequestRef.current;
      setSmartMissingCheck((current) => ({
        ...current,
        status: "checking",
        source,
        locationId,
        cartHash,
      }));
      try {
        const { data, error } = await invokeParseOrderWithRetry({
          label: `missing-items:${source}`,
          maxRetries: source === "manual" ? 2 : 1,
          body: {
            operation: "check_missing_items",
            source: "typed",
            message: "What am I missing?",
            raw_text: "What am I missing?",
            location_id: locationId,
            session_id: sessionId,
            user_id: userId,
            current_items: parsedItems,
            existing_items: parsedItems,
            ignored_item_ids: ignoredItemIds,
          },
        });
        if (error) throw error;
        if (requestId !== missingCheckRequestRef.current) return null;
        const response = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const suggestions = normalizeMissingItemSuggestions(response.missing_item_suggestions);
        const checkedAt = typeof response.checked_at === "string" ? response.checked_at : new Date().toISOString();
        const next: SmartMissingCheck = {
          status: "ready",
          checkedAt,
          locationId,
          supplierId: null,
          cartHash: typeof response.cart_hash === "string" ? response.cart_hash : cartHash,
          suggestions,
          ignoredItemIds,
          source,
        };
        setSmartMissingCheck(next);
        return next;
      } catch (error) {
        const errorDetails = await getQuickOrderFunctionErrorDetails(error);
        if (errorDetails.status === 429) {
          missingCheckCooldownUntilRef.current =
            Date.now() + MISSING_ITEM_THROTTLE_COOLDOWN_MS;
        }
        console.warn("[QuickOrder] Missing item check failed:", {
          error,
          status: errorDetails.status,
          code: errorDetails.code,
          bodyCode: getErrorCodeFromBody(errorDetails.body),
        });
        if (requestId === missingCheckRequestRef.current) {
          setSmartMissingCheck((current) => ({
            ...current,
            status: "error",
            source,
          }));
        }
        return null;
      }
    },
    [locationId, parsedItems, sessionId, smartMissingCheck.ignoredItemIds, userId],
  );

  useEffect(() => {
    if (!userId || !locationId || parsedItems.length === 0) {
      if (missingCheckTimerRef.current) {
        clearTimeout(missingCheckTimerRef.current);
        missingCheckTimerRef.current = null;
      }
      return;
    }
    if (missingCheckTimerRef.current) clearTimeout(missingCheckTimerRef.current);
    missingCheckTimerRef.current = setTimeout(() => {
      void runMissingItemCheck("proactive");
    }, 650);
    return () => {
      if (missingCheckTimerRef.current) {
        clearTimeout(missingCheckTimerRef.current);
        missingCheckTimerRef.current = null;
      }
    };
  }, [locationId, parsedItems, runMissingItemCheck, userId]);

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
      loadQuantitySuggestions,
      locationId,
      messages,
      parsedItems,
      persistSession,
      scheduleChatScrollToEnd,
      sessionId,
      userId,
    ],
  );

  /**
   * Swipe-to-delete from the Order List card. A row can map to several parsed
   * items (same item merged across units), so we strip every backing key in one
   * pass and persist the result. No confirmation prompt — the swipe + tap on
   * the revealed Delete action is already a deliberate two-step gesture.
   */
  const handleRemoveItems = useCallback(
    (itemsToRemove: ParsedQuickOrderItem[]) => {
      if (itemsToRemove.length === 0) return;
      void triggerSelectionHaptic();

      let nextParsedItems = parsedItems;
      let nextMessages = messages;
      for (const target of itemsToRemove) {
        const key = getParsedItemKey(target);
        nextParsedItems = removeParsedItem(nextParsedItems, key);
        nextMessages = removeMessageItems(nextMessages, key);
      }

      setParsedItems(nextParsedItems);
      setMessages(nextMessages);
      scheduleChatScrollToEnd("item-removed", true, buildSendSnapDelays(), {
        active: true,
        afterInteractions: true,
      });
      if (sessionId) {
        persistSession(sessionId, nextMessages, nextParsedItems).catch(
          (error) => {
            console.warn("[QuickOrder] Failed to persist item removal:", error);
          },
        );
      }
    },
    [messages, parsedItems, persistSession, scheduleChatScrollToEnd, sessionId],
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

  /**
   * Opens the quantity sheet for one row. Issue actions walk every item still
   * missing a quantity; tapping an existing quantity edits only that row.
   */
  const handleResolveQuantity = useCallback(
    (
      item: ParsedQuickOrderItem,
      options?: { single?: boolean },
    ) => {
      const tappedKey = getParsedItemKey(item);
      const fixQueue = getQuantityFixQueue(parsedItems);
      const queue =
        options?.single || fixQueue.length === 0 ? [tappedKey] : fixQueue;
      const index =
        options?.single || fixQueue.length === 0
          ? 0
          : Math.max(0, fixQueue.indexOf(tappedKey));

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
        const currentItem = parsedItems.find((item) => getParsedItemKey(item) === key) ?? null;
        if (
          currentItem &&
          isInventoryCountReviewItem(currentItem) &&
          userId &&
          locationId
        ) {
          const activeSessionId = await ensureSession();
          const baseParsedItems = removeParsedItem(parsedItems, key);
          const messageText = `${getParsedItemDisplayName(currentItem)} ${result.quantity}${trimmedUnit ? ` ${trimmedUnit}` : ""}`;
          const { data, error } = await invokeParseOrderWithRetry({
            label: "inventory-quantity-resolution",
            body: {
              source: "typed",
              mode: "inventory",
              message: messageText,
              raw_text: messageText,
              location_id: locationId,
              session_id: activeSessionId,
              user_id: userId,
              existing_items: baseParsedItems,
              recent_messages: messages
                .slice(-12)
                .map(buildPersistedMessage)
                .filter(
                  (message): message is PersistedQuickOrderMessage => message != null,
                ),
            },
          });
          if (error) throw error;

          const response = normalizeQuickOrderParseResponse(data);
          const recommendationItems = recommendationsToParsedItems(response.recommendations);
          const responseItems = orderInventoryModeItemsByMessage({
            rawText: messageText,
            reviewItems: response.parsedItems,
            recommendationItems,
            stockUpdates: response.stockUpdates,
          });
          const mergeResult = mergeQuickOrderParsedItemsDetailed(
            baseParsedItems,
            responseItems,
          );
          const nextParsed = mergeResult.items;
          const assistantMessage: QuickOrderMessage = {
            id: createMessageId(),
            role: "assistant",
            text: response.displayMessage,
            source: "typed",
            createdAt: new Date().toISOString(),
            parsedItems: responseItems,
            pendingClarifications: response.pendingActions,
            flags: response.flags,
            suggestions: [],
            stockUpdates: response.stockUpdates,
            recommendations: [],
            inventoryUpdates: buildInventoryUpdateRows(
              response.stockUpdates,
              response.recommendations,
              response.safetyWarnings,
            ),
            safetyWarnings: response.safetyWarnings,
            blockedOperations: response.blockedOperations,
            actions: response.actions,
            contextPatch: response.contextPatch,
            mutationId: response.mutationId,
          };
          const nextMessages = [
            ...removeMessageItems(messages, key),
            assistantMessage,
          ];
          const nextPendingClarifications = mergePendingClarificationsAfterParse(
            pendingClarifications,
            mergeResult.updatedItems,
            response.pendingActions,
          );

          setParsedItems(nextParsed);
          setMessages(nextMessages);
          setPendingClarifications(nextPendingClarifications);
          const next = advanceQuantityFlow(flow);
          setQuantityFlow(next ? { ...flow, index: next.index } : null);
          loadQuantitySuggestions(nextParsed.map((item) => item.item_id));
          scheduleChatScrollToEnd(
            "inventory-quantity-applied",
            true,
            buildSendSnapDelays(),
            {
              active: true,
              afterInteractions: true,
            },
          );
          if (activeSessionId) {
            try {
              await persistSession(activeSessionId, nextMessages, nextParsed);
            } catch (error) {
              console.warn(
                "[QuickOrder] Failed to persist inventory quantity edit:",
                error,
              );
            }
          }
          return;
        }

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
      ensureSession,
      loadQuantitySuggestions,
      locationId,
      pendingClarifications,
      persistSession,
      quantityFlow,
      scheduleChatScrollToEnd,
      sessionId,
      userId,
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

  const handleQuantityRemove = useCallback(() => {
    const flow = quantityFlow;
    if (!flow || isQuantitySaving) return;
    const key = flow.queue[flow.index];
    if (!key) return;
    const item = parsedItems.find((p) => getParsedItemKey(p) === key);
    if (!item) return;

    Alert.alert(
      `Remove ${getParsedItemDisplayName(item)}?`,
      "It will be taken off this order.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            const nextParsedItems = removeParsedItem(parsedItems, key);
            const nextMessages = removeMessageItems(messages, key);
            setParsedItems(nextParsedItems);
            setMessages(nextMessages);

            const remainingQueue = flow.queue.filter((entry) => entry !== key);
            if (remainingQueue.length === 0) {
              setQuantityFlow(null);
            } else {
              const nextIndex = Math.min(flow.index, remainingQueue.length - 1);
              setQuantityFlow({ queue: remainingQueue, index: nextIndex });
            }

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
    isQuantitySaving,
    messages,
    parsedItems,
    persistSession,
    quantityFlow,
    scheduleChatScrollToEnd,
    sessionId,
  ]);

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
      options?: {
        /**
         * Set when the message came from a composer suggestion pill (Last week /
         * Recent / Usual). The returned reorder items are dropped straight into
         * the composer instead of rendering a Preview card.
         */
        reorderPill?: "last_week" | "recent" | "usual";
        composerMode?: ComposerMode;
        modeConflictResolution?: "keep_inventory";
        preparsedQuickOrderData?: unknown;
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
      const requestMode = options?.composerMode ?? composerMode;

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

      if (/\b(?:what (?:am i|are we) missing|did (?:i|we) forget|am i missing|what did (?:i|we) miss|does this look complete|is this order complete|anything else (?:i|we) usually order|what should (?:i|we) add)\b/i.test(trimmed)) {
        const currentCartHash = buildQuickOrderCartHash(parsedItems);
        const checkedTime = smartMissingCheck.checkedAt ? new Date(smartMissingCheck.checkedAt).getTime() : 0;
        const fresh =
          smartMissingCheck.status === "ready" &&
          smartMissingCheck.locationId === locationId &&
          smartMissingCheck.cartHash === currentCartHash &&
          Number.isFinite(checkedTime) &&
          Date.now() - checkedTime <= 5 * 60 * 1000;
        const manualCheck = fresh ? smartMissingCheck : await runMissingItemCheck("manual");
        if (manualCheck) {
          const userMessage: QuickOrderMessage = {
            id: createMessageId(),
            role: "user",
            text: rawText,
            source,
            createdAt: new Date().toISOString(),
          };
          const assistantMessage: QuickOrderMessage = {
            id: createMessageId(),
            role: "assistant",
            text: manualCheck.suggestions.length === 0
              ? "Your order looks complete based on recent similar orders."
              : manualCheck.suggestions.length === 1
                ? `You may be missing ${manualCheck.suggestions[0].itemName}.`
                : `You may be missing ${manualCheck.suggestions.length} usual items.`,
            createdAt: new Date().toISOString(),
            suggestions: manualCheck.suggestions.map(missingSuggestionToQuickOrderSuggestion),
          };
          const nextMessages = [...messages, userMessage, assistantMessage];
          setMessages(nextMessages);
          scheduleChatScrollToEnd("missing-items-manual", true, buildSendSnapDelays(), {
            active: true,
            afterInteractions: true,
          });
          try {
            const activeSessionId = await ensureSession();
            await persistSession(activeSessionId, nextMessages, parsedItems);
          } catch (error) {
            console.warn("[QuickOrder] Failed to persist missing item response:", error);
          }
          return;
        }
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
            mode: requestMode,
            location_id: devIdFingerprint(locationId),
            session_id: devIdFingerprint(activeSessionId),
            user_id: devIdFingerprint(userId),
          });
        }

        const preParsed = options?.preparsedQuickOrderData;
        const { data, error, attempts } = preParsed
          ? { data: preParsed, error: null, attempts: 1 }
          : await invokeParseOrderWithRetry({
              label: "quick-order-submit",
              body: {
                source: source === "typed" ? "text" : source,
                mode: requestMode,
                mode_conflict_resolution: options?.modeConflictResolution,
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
            errorMessage: (error as { message?: string } | null)?.message,
            errorName: (error as { name?: string } | null)?.name,
            attempts,
          });
        }

        if (error) {
          // Supabase functions.invoke returns FunctionsHttpError for non-2xx,
          // FunctionsRelayError for relay issues, FunctionsFetchError for network failures.
          const errorName = (error as { name?: string }).name ?? "";
          const errorDetails = await getQuickOrderFunctionErrorDetails(error);
          const errorCode = errorDetails.code;
          console.warn(
            `[QuickOrder] parse-order invoke error: ${errorName}`,
            {
              status: errorDetails.status,
              code: errorCode,
              bodyCode: getErrorCodeFromBody(errorDetails.body),
            },
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
            actions_length: response.actions.length,
            mutationId: devIdFingerprint(response.mutationId),
            assistantMessage: devTextFingerprint(response.assistantMessage),
            rawError: response.rawError,
            errorCode: response.errorCode,
            diagnostics: response.diagnostics,
          });
        }

        // Only short-circuit to error path if there is truly no structured
        // result. Inventory-mode responses usually have no cart items, so
        // stock updates/recommendations/warnings must count as useful output.
        if (
          shouldDiscardQuickOrderResponseAsError(response)
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

        // Composer suggestion pills (Last week / Recent / Usual): flatten the
        // returned reorder/usual suggestions into a single de-duplicated list so
        // we can drop them straight into the composer instead of showing a
        // Preview card. "Usual" returns one suggestion per item; "Last week" and
        // "Recent" return a single suggestion holding the whole order.
        const reorderPill = options?.reorderPill;
        let reorderPrefillText: string | null = null;
        if (reorderPill) {
          const seen = new Set<string>();
          const gathered = responseSuggestions.flatMap((suggestion) =>
            getSuggestionItems(suggestion).filter((item) => {
              const key = item.item_id || item.item_name;
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            }),
          );
          if (gathered.length > 0) {
            reorderPrefillText =
              requestMode === "inventory"
                ? buildComposerItemNameList(gathered)
                : buildComposerOrderText(gathered);
          }
        }
        // Auto-accept high-confidence single-alternative matches (e.g. "shrimp"
        // → "Shrimp (Frozen)") so the user doesn't have to confirm an obvious
        // suggestion. The matched item lands in the cart immediately and the
        // clarification card is dropped from the response.
        const autoResolved = autoResolveSingleAlternativeMatches(
          response.parsedItems,
          response.pendingActions,
        );
        const autoApplyInventoryRecommendations =
          requestMode === "inventory" && response.recommendations.length > 0;
        const showInventoryUpdateCard =
          requestMode === "inventory" &&
          (
            response.stockUpdates.length > 0 ||
            response.recommendations.length > 0 ||
            response.safetyWarnings.some((warning) => warning.type === "no_order_needed")
          );
        const autoAppliedRecommendationItems = autoApplyInventoryRecommendations
          ? recommendationsToParsedItems(response.recommendations)
          : [];
        const responseItems = autoApplyInventoryRecommendations
          ? orderInventoryModeItemsByMessage({
              rawText,
              reviewItems: autoResolved.items,
              recommendationItems: autoAppliedRecommendationItems,
              stockUpdates: response.stockUpdates,
            })
          : requestMode === "order"
            ? markHumanOrderItems(autoResolved.items)
            : autoResolved.items;
        const displayedRecommendations = autoApplyInventoryRecommendations
          ? []
          : response.recommendations;
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
          let finalAssistantText =
            response.isBlocked ||
            response.isPartialSuccess ||
            response.stockUpdates.length > 0 ||
            displayedRecommendations.length > 0 ||
            autoAppliedRecommendationItems.length > 0 ||
            response.safetyWarnings.length > 0 ||
            response.blockedOperations.length > 0
              ? response.displayMessage
              : assistantText;

          // Pill-driven reorder: confirm with "Got it" and let the auto-filled
          // composer speak for itself. When nothing came back, fall through to
          // the backend's not-found message ("No matching order…").
          if (reorderPill) {
            if (requestMode === "inventory") {
              finalAssistantText = reorderPrefillText
                ? "Got it — your last inventory list is in the composer. Re-count each item, then send."
                : response.displayMessage;
            } else {
              finalAssistantText = reorderPrefillText
                ? reorderPill === "last_week"
                  ? "Got it — last week’s order is in the composer. Edit it if needed, then send."
                  : reorderPill === "recent"
                    ? "Got it — your most recent order is in the composer. Edit it if needed, then send."
                    : "Got it — your usual order is in the composer. Edit it if needed, then send."
                : response.displayMessage;
            }
          }

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
              suggestions: reorderPill ? [] : responseSuggestions,
              stockUpdates: response.stockUpdates,
              recommendations: displayedRecommendations,
              inventoryUpdates: showInventoryUpdateCard
                ? buildInventoryUpdateRows(
                    response.stockUpdates,
                    response.recommendations,
                    response.safetyWarnings,
                  )
                : [],
              safetyWarnings: response.safetyWarnings,
              blockedOperations: response.blockedOperations,
              actions: response.actions,
              contextPatch: response.contextPatch,
              mutationId: response.mutationId,
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
        if (reorderPrefillText) {
          const prefillText = reorderPrefillText;
          setComposerPrefill((prev) => ({
            text: prefillText,
            nonce: prev.nonce + 1,
          }));
        }
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
      loadQuantitySuggestions,
      locationId,
      messages,
      nudgeSent,
      parsedItems,
      persistSession,
      runMissingItemCheck,
      scheduleChatScrollToEnd,
      sessionId,
      smartMissingCheck,
      userId,
      composerMode,
    ],
  );

  const handleRetry = useCallback(() => {
    const lastText = lastUserTextRef.current;
    if (!lastText || isSending) return;
    void handleSubmitMore(lastText);
  }, [handleSubmitMore, isSending]);

  const recordDraftMutation = useCallback(
    async (input: {
      beforeItems: ParsedQuickOrderItem[];
      afterItems: ParsedQuickOrderItem[];
      mutationType:
        | "smart_suggestion_applied"
        | "stock_recommendation_applied"
        | "history_reorder_applied"
        | "manual_update"
        | "clarification_applied";
      assistantText: string;
      sourceMessage: string;
    }): Promise<{
      mutationId: string | null;
      actions: QuickOrderAssistantAction[];
      contextPatch: Record<string, unknown> | null;
    }> => {
      if (!userId || !locationId) {
        return { mutationId: null, actions: [], contextPatch: null };
      }
      const activeSessionId = await ensureSession();
      const { data, error } = await invokeParseOrderWithRetry({
        label: "record-mutation",
        maxRetries: 2,
        body: {
          operation: "record_mutation",
          source: "typed",
          message: input.sourceMessage,
          raw_text: input.sourceMessage,
          location_id: locationId,
          session_id: activeSessionId,
          user_id: userId,
          existing_items: input.afterItems,
          before_cart: input.beforeItems,
          after_cart: input.afterItems,
          mutation_type: input.mutationType,
          assistant_message_text: input.assistantText,
          recent_messages: messages
            .slice(-12)
            .map(buildPersistedMessage)
            .filter(
              (entry): entry is PersistedQuickOrderMessage => entry != null,
            ),
        },
      });
      if (error) throw error;
      const response = normalizeQuickOrderParseResponse(data);
      return {
        mutationId: response.mutationId,
        actions: response.actions,
        contextPatch: response.contextPatch,
      };
    },
    [ensureSession, locationId, messages, userId],
  );

  const handleRevertMutation = useCallback(
    async (message: QuickOrderMessage, action: QuickOrderAssistantAction) => {
      const mutationId = action.mutationId ?? message.mutationId;
      if (!mutationId || revertingMutationIds[mutationId] || message.reverted)
        return;
      if (!userId || !locationId) {
        Alert.alert("Choose a location before using Quick Order.");
        return;
      }

      setRevertingMutationIds((current) => ({ ...current, [mutationId]: true }));

      try {
        const activeSessionId = await ensureSession();
        const messagesWithPendingRevert = messages.map((entry) =>
          entry.id === message.id
            ? {
                ...entry,
                actions: (entry.actions ?? []).map((entryAction) =>
                  entryAction.id === action.id
                    ? { ...entryAction, disabled: true, status: "pending" }
                    : entryAction,
                ),
              }
            : entry,
        );

        const { data, error } = await invokeParseOrderWithRetry({
          label: "revert-mutation",
          maxRetries: 2,
          body: {
            operation: "revert",
            action: action.operation ?? action.type ?? "revert",
            mutation_id: mutationId,
            mutationId,
            source: "typed",
            message: "Revert",
            raw_text: "Revert",
            location_id: locationId,
            session_id: activeSessionId,
            user_id: userId,
            existing_items: parsedItems,
            recent_messages: messagesWithPendingRevert
              .slice(-12)
              .map(buildPersistedMessage)
              .filter(
                (entry): entry is PersistedQuickOrderMessage => entry != null,
              ),
          },
        });

        if (error) {
          throw error;
        }

        const response = normalizeQuickOrderParseResponse(data);
        const responseSuggestions = normalizeSuggestions(response.suggestions);
        const patchedItems = getContextPatchParsedItems(response.contextPatch);

        let nextParsedItems = parsedItems;
        let operationResult: QuickOrderOperationResult | null = null;
        let mergeResult: QuickOrderMergeResult = {
          items: nextParsedItems,
          addedItems: [],
          updatedItems: [],
          reviewItems: [],
          addedCount: 0,
          updatedCount: 0,
          reviewCount: 0,
          unchangedCount: 0,
          rejectedReasons: [],
        };

        if (patchedItems) {
          nextParsedItems = patchedItems;
          mergeResult = mergeQuickOrderParsedItemsDetailed([], patchedItems);
        } else {
          let operationBase = parsedItems;
          if (response.operations.length > 0) {
            operationResult = applyQuickOrderOperations(
              parsedItems,
              response.operations,
            );
            operationBase = operationResult.items;
          }
          mergeResult = mergeQuickOrderParsedItemsDetailed(
            operationBase,
            response.parsedItems,
          );
          nextParsedItems = mergeResult.items;
        }

        const assistantText = buildQuickOrderAssistantMessage({
          normalized: response,
          mergeResult,
          pendingCount: response.pendingActions.length,
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
        const revertAssistantMessage: QuickOrderMessage = {
          id: createMessageId(),
          role: "assistant",
          text: finalAssistantText || "Reverted.",
          source: "typed",
          createdAt: new Date().toISOString(),
          parsedItems: response.parsedItems,
          pendingClarifications: response.pendingActions,
          flags: response.flags,
          suggestions: responseSuggestions,
          stockUpdates: response.stockUpdates,
          recommendations: response.recommendations,
          safetyWarnings: response.safetyWarnings,
          blockedOperations: response.blockedOperations,
          actions: response.actions,
          contextPatch: response.contextPatch,
          mutationId: response.mutationId,
        };
        // A plain "back to the previous state" confirmation is redundant — the
        // "Reverted" affordance under the original bubble already conveys it.
        // Only append the follow-up bubble when the revert response carries
        // something new the user needs to see.
        const revertHasExtraContent =
          response.pendingActions.length > 0 ||
          responseSuggestions.length > 0 ||
          response.recommendations.length > 0 ||
          response.stockUpdates.length > 0 ||
          response.safetyWarnings.length > 0 ||
          response.blockedOperations.length > 0;
        const finalMessages = [
          ...messagesWithPendingRevert.map((entry) =>
            entry.id === message.id
              ? {
                  ...entry,
                  reverted: true,
                  actions: (entry.actions ?? []).map((entryAction) =>
                    entryAction.id === action.id
                      ? { ...entryAction, disabled: true, status: "reverted" }
                      : entryAction,
                  ),
                }
              : entry,
          ),
          ...(revertHasExtraContent ? [revertAssistantMessage] : []),
        ];

        setParsedItems(nextParsedItems);
        const nextPendingClarifications = patchedItems
          ? response.pendingActions
          : mergePendingClarificationsAfterParse(
              pendingClarifications,
              mergeResult.updatedItems,
              response.pendingActions,
            );
        setPendingClarifications(nextPendingClarifications);
        setMessages(finalMessages);
        loadQuantitySuggestions(nextParsedItems.map((item) => item.item_id));
        scheduleChatScrollToEnd(
          "mutation-reverted",
          true,
          buildSendSnapDelays(),
          {
            active: true,
            afterInteractions: true,
          },
        );

        await persistSession(activeSessionId, finalMessages, nextParsedItems);
      } catch (error) {
        console.warn("[QuickOrder] Failed to revert mutation:", error);
        Alert.alert("Could not revert", "Please try again.");
      } finally {
        setRevertingMutationIds((current) => {
          const next = { ...current };
          delete next[mutationId];
          return next;
        });
      }
    },
    [
      ensureSession,
      loadQuantitySuggestions,
      locationId,
      messages,
      parsedItems,
      pendingClarifications,
      persistSession,
      revertingMutationIds,
      scheduleChatScrollToEnd,
      userId,
    ],
  );

  const processVoiceRecording = useCallback(
    async (recording: { uri: string; durationMs: number }) => {
      if (!userId || !locationId) {
        applyVoiceEvent("process_failed", "UNKNOWN");
        setVoiceError("Choose a location before using voice order.");
        setVoiceReview(null);
        return;
      }

      let activeSessionId = sessionId;
      try {
        activeSessionId = await withPromiseTimeout(
          ensureSession(),
          QUICK_ORDER_VOICE_SESSION_TIMEOUT_MS,
          QUICK_ORDER_VOICE_SESSION_TIMEOUT_MESSAGE,
        );
        const result = await transcribeQuickOrderVoiceFile({
          uri: recording.uri,
          durationMs: recording.durationMs,
          locationId,
          userId,
          sessionId: activeSessionId,
          mode: composerMode,
          existingItems: parsedItems,
          recentMessages: messages
            .slice(-12)
            .map(buildPersistedMessage)
            .filter(
              (message): message is PersistedQuickOrderMessage => message != null,
            ),
        });

        if (!result.success) {
          applyVoiceEvent("process_failed", result.errorCode);
          setVoiceError(result.message);
          setVoiceReview(null);
          return;
        }

        const voiceText = (result.normalizedText || result.rawTranscript).trim();
        const safeActions = result.actions.filter((action) =>
          action.type === "add" &&
          Boolean(action.itemId) &&
          action.quantity != null &&
          Number.isFinite(action.quantity) &&
          action.quantity > 0 &&
          Boolean(action.unit?.trim())
        );
        if (!voiceText && safeActions.length === 0 && result.unresolved.length === 0) {
          applyVoiceEvent("process_failed", "VOICE_LOW_CONFIDENCE");
          setVoiceError("I couldn't turn that into order text. Try again.");
          setVoiceReview(null);
          return;
        }

        const review: VoiceReviewState = {
          rawTranscript: result.rawTranscript || voiceText,
          normalizedText: voiceText,
          modelUsed: result.modelUsed,
          confidence: result.confidence,
          voiceEventId: result.voiceEventId,
          detectedLanguages: result.detectedLanguages,
          actions: result.actions,
          unresolved: result.unresolved,
          warnings: result.warnings,
        };

        applyVoiceEvent("review_ready");
        setVoiceError(null);
        setLastVoiceRecording(null);
        setVoiceReview(review);
        await cleanupQuickOrderVoiceFile(recording.uri);

        if (safeActions.length === 0 && voiceText) {
          setVoiceError("I cleaned the voice input, but could not safely match every item. Please review before adding.");
          pendingVoiceDraftMetadataRef.current = {
            raw_transcript: result.rawTranscript || voiceText,
            transcript_confidence: result.confidence,
            language: result.detectedLanguages[0],
          };
          setComposerPrefill((prev) => ({
            text: voiceText,
            nonce: prev.nonce + 1,
          }));
        }
      } catch (error) {
        console.warn("[QuickOrder] Failed to process voice order:", error);
        applyVoiceEvent("process_failed", "MODEL_FAILED");
        setVoiceReview(null);
        setVoiceError(
          error instanceof Error && error.message === QUICK_ORDER_VOICE_SESSION_TIMEOUT_MESSAGE
            ? "Voice setup took too long. Check your connection and try again."
            : "Voice order cleanup failed. Try again.",
        );
      }
    },
    [
      applyVoiceEvent,
      composerMode,
      ensureSession,
      locationId,
      messages,
      parsedItems,
      sessionId,
      userId,
    ],
  );

  const handleStopVoice = useCallback(async (): Promise<{
    uri: string;
    durationMs: number;
  } | null> => {
    if (
      isVoiceStoppingRef.current ||
      voiceMachineRef.current.status !== "recording"
    ) {
      return null;
    }
    isVoiceStoppingRef.current = true;
    if (maxRecordingTimerRef.current) {
      clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    try {
      await audioRecorder.stop();
      const durationMs =
        audioRecorderState.durationMillis ||
        (recordingStartTimeRef.current ? Date.now() - recordingStartTimeRef.current : 0);
      const uri = audioRecorder.uri || audioRecorderState.url;
      recordingStartTimeRef.current = null;
      if (!uri || isQuickOrderVoiceTooShort(durationMs)) {
        if (uri) await cleanupQuickOrderVoiceFile(uri);
        applyVoiceEvent("process_failed", "TOO_SHORT");
        setVoiceError("Hold the mic a little longer and try again.");
        return null;
      }
      const recording = { uri, durationMs };
      setLastVoiceRecording(recording);
      applyVoiceEvent("stop");
      return recording;
    } catch (error) {
      console.warn("[QuickOrder] Failed to stop voice input:", error);
      applyVoiceEvent("process_failed", "INVALID_AUDIO");
      setVoiceError("Voice input is unavailable right now.");
      return null;
    } finally {
      isVoiceStoppingRef.current = false;
      try {
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        // Non-fatal audio session cleanup.
      }
    }
  }, [
    applyVoiceEvent,
    audioRecorder,
    audioRecorderState.durationMillis,
    audioRecorderState.url,
  ]);

  // Single-tap "stop and submit": ends the recording and immediately uploads it
  // for parsing. Both the square stop and the send arrow route here, so there's
  // no separate review step (matches the composer's recording-mode mockup).
  const handleSubmitVoice = useCallback(async () => {
    if (voiceMachineRef.current.uploadInFlight) return;
    const recording = await handleStopVoice();
    if (!recording) return;
    setVoiceError(null);
    setVoiceReview(null);
    void processVoiceRecording(recording);
  }, [handleStopVoice, processVoiceRecording]);

  const handleStartVoice = useCallback(async () => {
    if (!voiceEnabled || isSending || voiceMachineRef.current.uploadInFlight) return;
    try {
      const result = await AudioModule.requestRecordingPermissionsAsync();
      if (!result.granted) {
        applyVoiceEvent("process_failed", "PERMISSION_DENIED");
        setVoiceError("Microphone access is needed for voice order.");
        return;
      }
      setVoiceError(null);
      setVoiceReview(null);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync(QUICK_ORDER_RECORDING_OPTIONS);
      recordingStartTimeRef.current = Date.now();
      applyVoiceEvent("start");
      void triggerSelectionHaptic();
      audioRecorder.record({ forDuration: QUICK_ORDER_MAX_RECORDING_MS / 1000 });
      maxRecordingTimerRef.current = setTimeout(() => {
        void handleSubmitVoice();
      }, QUICK_ORDER_MAX_RECORDING_MS);
    } catch (error) {
      console.warn("[QuickOrder] Failed to start voice input:", error);
      applyVoiceEvent("process_failed", "INVALID_AUDIO");
      setVoiceError("Voice input is unavailable right now.");
    }
  }, [
    applyVoiceEvent,
    audioRecorder,
    handleSubmitVoice,
    isSending,
    voiceEnabled,
  ]);

  const handleCancelVoice = useCallback(async () => {
    if (voiceMachineRef.current.status === "transcribing") return;
    if (maxRecordingTimerRef.current) {
      clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop();
      }
      const uri = audioRecorder.uri || audioRecorderState.url || lastVoiceRecording?.uri;
      await cleanupQuickOrderVoiceFile(uri);
    } catch {
      // Best effort cancellation.
    }
    recordingStartTimeRef.current = null;
    setLastVoiceRecording(null);
    setVoiceError(null);
    setVoiceReview(null);
    applyVoiceEvent("cancel");
    setTimeout(() => applyVoiceEvent("reset"), 250);
  }, [
    applyVoiceEvent,
    audioRecorder,
    audioRecorderState.url,
    lastVoiceRecording?.uri,
  ]);

  const handleRetryVoice = useCallback(() => {
    if (!lastVoiceRecording || voiceMachineRef.current.uploadInFlight) return;
    applyVoiceEvent("transcribe");
    setVoiceError(null);
    setVoiceReview(null);
    void processVoiceRecording(lastVoiceRecording);
  }, [applyVoiceEvent, lastVoiceRecording, processVoiceRecording]);

  const handleEditVoiceReview = useCallback(() => {
    if (!voiceReview) return;
    const text = (voiceReview.normalizedText || voiceReview.rawTranscript).trim();
    if (!text) return;
    pendingVoiceDraftMetadataRef.current = {
      raw_transcript: voiceReview.rawTranscript || text,
      transcript_confidence: voiceReview.confidence,
      language: voiceReview.detectedLanguages[0],
    };
    setComposerPrefill((prev) => ({
      text,
      nonce: prev.nonce + 1,
    }));
    setVoiceReview(null);
    setVoiceError(null);
    applyVoiceEvent("reset");
  }, [applyVoiceEvent, voiceReview]);

  const handleDiscardVoiceReview = useCallback(() => {
    setVoiceReview(null);
    setVoiceError(null);
    applyVoiceEvent("reset");
  }, [applyVoiceEvent]);

  const handleRetryVoiceReview = useCallback(() => {
    setVoiceReview(null);
    setVoiceError(null);
    applyVoiceEvent("reset");
    requestAnimationFrame(() => {
      void handleStartVoice();
    });
  }, [applyVoiceEvent, handleStartVoice]);

  const handleAddVoiceReview = useCallback(async () => {
    const review = voiceReview;
    if (!review || voiceReviewAddInFlightRef.current) return;
    const incomingItems = voiceSafeAddActions(review)
      .map((action) => voiceActionToParsedItem(action, review))
      .filter((item): item is ParsedQuickOrderItem => item != null);

    if (incomingItems.length === 0) {
      handleEditVoiceReview();
      return;
    }
    if (!userId || !locationId) {
      setVoiceError("Choose a location before using voice order.");
      return;
    }

    voiceReviewAddInFlightRef.current = true;
    applyVoiceEvent("add_to_order");

    try {
      const activeSessionId = await ensureSession();
      let nextParsedItems: ParsedQuickOrderItem[] = parsedItems;
      let addedCount = incomingItems.length;

      setParsedItems((current) => {
        const mergeResult = mergeQuickOrderParsedItemsDetailed(current, incomingItems);
        nextParsedItems = mergeResult.items;
        addedCount = mergeResult.addedCount + mergeResult.updatedCount;
        return mergeResult.items;
      });

      const voiceText = (review.normalizedText || review.rawTranscript).trim();
      const userMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "user",
        text: voiceText,
        source: "voice",
        transcriptPreview: review.rawTranscript,
        createdAt: new Date().toISOString(),
      };
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: addedCount === 1
          ? "Added 1 item from voice."
          : `Added ${addedCount} items from voice.`,
        source: "voice",
        createdAt: new Date().toISOString(),
        parsedItems: incomingItems,
        pendingClarifications: [],
      };
      const nextMessages = [...messages, userMessage, assistantMessage];

      setMessages(nextMessages);
      setVoiceReview(null);
      setVoiceError(null);
      loadQuantitySuggestions(nextParsedItems.map((item) => item.item_id));
      scheduleChatScrollToEnd("voice-review-added", true, buildSendSnapDelays(), {
        active: true,
        afterInteractions: true,
      });
      await persistSession(activeSessionId, nextMessages, nextParsedItems);
      applyVoiceEvent("added");
      setTimeout(() => applyVoiceEvent("reset"), 450);
    } catch (error) {
      console.warn("[QuickOrder] Failed to add voice review:", error);
      voiceMachineRef.current = { status: "review_ready", uploadInFlight: false, errorCode: null };
      setVoiceStatus("review_ready");
      setVoiceError("Could not add the voice items. Try again.");
    } finally {
      voiceReviewAddInFlightRef.current = false;
    }
  }, [
    applyVoiceEvent,
    ensureSession,
    handleEditVoiceReview,
    loadQuantitySuggestions,
    locationId,
    messages,
    parsedItems,
    persistSession,
    scheduleChatScrollToEnd,
    userId,
    voiceReview,
  ]);

  const handleClarificationAction = useCallback(
    async (
      clarification: PendingQuickOrderClarification,
      action: PendingQuickOrderClarification["actions"][number],
    ) => {
      if (clarification.id.startsWith("mode_conflict_order_in_inventory")) {
        const sourceText =
          clarification.incoming_item?.raw_text ||
          clarification.incoming_item?.raw_token ||
          clarification.message;
        if (action.id === "cancel") {
          setConfirmedClarifications((current) => ({
            ...current,
            [clarification.id]: "Keeping as inventory",
          }));
          setPendingClarifications((current) =>
            current.filter((entry) => entry.id !== clarification.id),
          );
          void handleSubmitMore(sourceText, "typed", undefined, {
            composerMode: "inventory",
            modeConflictResolution: "keep_inventory",
          });
          return;
        }
        setComposerMode("order");
      }

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
      let nextMessages = messages.map((message) => ({
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

      if (action.id !== "cancel") {
        try {
          const mutationResult = await recordDraftMutation({
            beforeItems: parsedItems,
            afterItems: nextParsedItems,
            mutationType: "clarification_applied",
            assistantText: confirmedLabel,
            sourceMessage: clarification.message,
          });
          if (mutationResult.mutationId) {
            nextMessages = nextMessages.map((message) =>
              (message.pendingClarifications ?? []).some(
                (entry) => entry.id === clarification.id,
              )
                ? {
                    ...message,
                    actions: mutationResult.actions,
                    contextPatch: mutationResult.contextPatch,
                    mutationId: mutationResult.mutationId,
                  }
                : message,
            );
          }
        } catch (error) {
          console.warn(
            "[QuickOrder] Failed to record clarification mutation:",
            error,
          );
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
      recordDraftMutation,
      scheduleChatScrollToEnd,
      sessionId,
      setComposerMode,
      userId,
      handleSubmitMore,
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
          source: suggestion.type === "missing_item" ? "missing_item" : "inventory_recommendation",
          isSuggested: true,
          suggestionReason: suggestion.reason ?? suggestion.message,
          suggestionSource: suggestion.type === "missing_item" ? "missing_item" : "remaining_inventory",
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
      let mutationResult: {
        mutationId: string | null;
        actions: QuickOrderAssistantAction[];
        contextPatch: Record<string, unknown> | null;
      } = { mutationId: null, actions: [], contextPatch: null };
      try {
        mutationResult = await recordDraftMutation({
          beforeItems: parsedItems,
          afterItems: nextParsedItems,
          mutationType: suggestion.type === "reorder_last_week" || suggestion.type === "reorder_recent"
            ? "history_reorder_applied"
            : "smart_suggestion_applied",
          assistantText,
          sourceMessage: suggestion.message ?? suggestion.title ?? "Accepted Quick Order suggestion",
        });
      } catch (error) {
        console.warn("[QuickOrder] Failed to record suggestion mutation:", error);
      }
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: assistantText,
        createdAt: new Date().toISOString(),
        parsedItems: incoming,
        actions: mutationResult.actions,
        contextPatch: mutationResult.contextPatch,
        mutationId: mutationResult.mutationId,
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
      if (suggestion.type === "missing_item") {
        const addedIds = suggestionItems.map((item) => item.item_id);
        setSmartMissingCheck((current) => ({
          ...current,
          suggestions: current.suggestions.filter((entry) => !addedIds.includes(entry.itemId)),
        }));
      }
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
    [
      messages,
      parsedItems,
      persistSession,
      recordDraftMutation,
      scheduleChatScrollToEnd,
      sessionId,
    ],
  );

  const handleRejectSuggestion = useCallback(
    async (suggestion: QuickOrderSuggestion) => {
      const ignoredItemId = suggestion.type === "missing_item"
        ? suggestion.item_id ?? suggestion.items?.[0]?.item_id ?? null
        : null;
      if (ignoredItemId) {
        setSmartMissingCheck((current) => ({
          ...current,
          ignoredItemIds: [...new Set([...current.ignoredItemIds, ignoredItemId])],
          suggestions: current.suggestions.filter((entry) => entry.itemId !== ignoredItemId),
        }));
      }
      // The card collapses to its own dismissed state, so a rejected suggestion
      // needs no extra chat bubble. A missing-item suggestion is the one case
      // worth confirming, since we also stop resurfacing it for this order.
      if (!ignoredItemId) {
        return;
      }
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: "Got it — I will not show that suggestion again for this order.",
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

  // Tapping Preview on a reorder suggestion drops the suggested order into the
  // composer (bumping the nonce so re-tapping re-applies). The user edits it
  // inline and sends it through the normal parse-order path.
  const handlePreviewToComposer = useCallback(
    (suggestion: QuickOrderSuggestion) => {
      const items = getSuggestionItems(suggestion);
      if (items.length === 0) return;
      setComposerPrefill((prev) => ({
        text: buildComposerOrderText(items),
        nonce: prev.nonce + 1,
      }));
    },
    [],
  );

  // Discarding a suggestion clears any previewed text back out of the composer.
  const handleDiscardSuggestion = useCallback((_suggestion: QuickOrderSuggestion) => {
    setComposerPrefill((prev) => ({ text: "", nonce: prev.nonce + 1 }));
  }, []);

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
          source: "inventory_recommendation",
          isSuggested: true,
          suggestionReason: item.reason,
          suggestionSource: "remaining_inventory",
          resolution: item.resolution,
          reason_codes: item.reason_codes,
          resolution_trace: item.resolution_trace,
          user_visible_note: item.user_visible_note,
        }),
      );
      if (incoming.length === 0) return;

      const mergeResult = mergeQuickOrderParsedItemsDetailed(
        parsedItems,
        incoming,
      );
      const nextParsedItems = mergeResult.items;
      const assistantText = incoming.length === 1
        ? `Added suggested order: ${formatQuickOrderQuantity(incoming[0].quantity, incoming[0].unit)} of ${incoming[0].item_name ?? incoming[0].display_name ?? "item"}.`
        : `Added ${incoming.length} suggested items.`;
      let mutationResult: {
        mutationId: string | null;
        actions: QuickOrderAssistantAction[];
        contextPatch: Record<string, unknown> | null;
      } = { mutationId: null, actions: [], contextPatch: null };
      try {
        mutationResult = await recordDraftMutation({
          beforeItems: parsedItems,
          afterItems: nextParsedItems,
          mutationType: recommendations.some((item) => item.recommendation_type === "stock_reorder_rule")
            ? "stock_recommendation_applied"
            : "smart_suggestion_applied",
          assistantText,
          sourceMessage: recommendations.map((item) => item.reason).filter(Boolean).join(" ") || "Accepted suggested order",
        });
      } catch (error) {
        console.warn("[QuickOrder] Failed to record recommendation mutation:", error);
      }
      const assistantMessage: QuickOrderMessage = {
        id: createMessageId(),
        role: "assistant",
        text: assistantText,
        createdAt: new Date().toISOString(),
        parsedItems: incoming,
        actions: mutationResult.actions,
        contextPatch: mutationResult.contextPatch,
        mutationId: mutationResult.mutationId,
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
    [
      messages,
      parsedItems,
      persistSession,
      recordDraftMutation,
      scheduleChatScrollToEnd,
      sessionId,
    ],
  );

  const handlePreviewRecommendations = useCallback(
    (recommendations: QuickOrderRecommendation[]) => {
      const text = buildComposerOrderText(
        recommendations.map((recommendation) => ({
          item_id: recommendation.item_id,
          item_name: recommendation.item_name,
          quantity: recommendation.suggested_quantity,
          unit: recommendation.unit,
          unit_type: null,
        })),
      );
      if (!text.trim()) return;
      setComposerMode("order");
      setComposerPrefill((prev) => ({
        text,
        nonce: prev.nonce + 1,
      }));
    },
    [setComposerMode],
  );

  const handleConfirmOrder = useCallback(() => {
    if (
      parsedItems.length === 0 ||
      issueCount > 0 ||
      isConfirmingRef.current ||
      isConfirming ||
      isSending ||
      showConfirmLocationSheet ||
      orderConfirmation ||
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

    const currentCartHash = buildQuickOrderCartHash(parsedItems);
    const checkedTime = smartMissingCheck.checkedAt
      ? new Date(smartMissingCheck.checkedAt).getTime()
      : 0;
    const smartCheckFresh =
      smartMissingCheck.status === "ready" &&
      smartMissingCheck.locationId === locationId &&
      smartMissingCheck.cartHash === currentCartHash &&
      Number.isFinite(checkedTime) &&
      Date.now() - checkedTime <= 5 * 60 * 1000;
    const highConfidenceMissing = smartCheckFresh
      ? highConfidenceMissingSuggestions
      : [];
    if (highConfidenceMissing.length > 0 && !skipMissingReviewOnceRef.current) {
      setSelectedMissingItemIds(
        Object.fromEntries(highConfidenceMissing.map((suggestion) => [suggestion.itemId, true])),
      );
      setMissingReviewVisible(true);
      return;
    }
    skipMissingReviewOnceRef.current = false;

    Keyboard.dismiss();
    setConfirmLocationId(locationId);
    setShowConfirmLocationSheet(true);
    void triggerConfirmationHaptic();
  }, [
    isConfirming,
    isSending,
    issueCount,
    highConfidenceMissingSuggestions,
    locationId,
    orderConfirmation,
    parsedItems,
    showConfirmLocationSheet,
    smartMissingCheck,
    userId,
  ]);

  const handleSelectSubmitLocation = useCallback((nextLocationId: string) => {
    if (confirmLocationId === nextLocationId) {
      return;
    }

    setConfirmLocationId(nextLocationId);
    void triggerConfirmationHaptic();
  }, [confirmLocationId]);

  const handleUnavailableSubmitLocationChange = useCallback(() => {
    Alert.alert("No other location", "There is no other location available for this order.");
  }, []);

  const handleCloseConfirmLocationSheet = useCallback(() => {
    if (isConfirmingRef.current || isConfirming) {
      return;
    }

    setShowConfirmLocationSheet(false);
    setConfirmLocationId(null);
  }, [isConfirming]);

  const handleConfirmSubmitOrder = useCallback(async () => {
    if (
      !confirmLocationId ||
      !userId ||
      parsedItems.length === 0 ||
      issueCount > 0 ||
      isConfirmingRef.current ||
      isConfirming ||
      isSending ||
      !areQuickOrderItemsCartReady(parsedItems)
    ) {
      return;
    }

    const selectedLocationName =
      locationNameById.get(confirmLocationId) ?? "Selected location";
    const sessionToSubmit = sessionId;

    try {
      isConfirmingRef.current = true;
      setIsConfirming(true);

      const loadedInventory = await loadInventoryItems();
      const inventoryById = new Map<string, QuickOrderInventoryItem>(
        loadedInventory.map((item) => [item.id, item]),
      );
      const cartAdds = quickOrderItemsToCartAdds(parsedItems, inventoryById);
      const orderItems: OrderItemPayload[] = cartAdds.map((add) => ({
        inventory_item_id: add.inventoryItemId,
        quantity: add.quantity,
        unit_type: add.unitType,
        input_mode: "quantity",
        quantity_requested: add.quantity,
        remaining_reported: null,
        decided_quantity: null,
        decided_by: null,
        decided_at: null,
        note: add.note,
        was_suggested: add.wasSuggested,
        original_suggested_qty: add.originalSuggestedQty,
      }));
      const orderId =
        quickOrderPendingOrderIdRef.current ?? generateQuickOrderSubmitId();
      quickOrderPendingOrderIdRef.current = orderId;
      const entryMethod = parsedItems.some((item) => item.source === "voice")
        ? "voice_order"
        : "quick_order";

      const result = await withPromiseTimeout(
        submitOrderService({
          orderId,
          locationId: confirmLocationId,
          userId,
          status: "submitted",
          items: orderItems,
          entryMethod,
          quickSessionId: sessionToSubmit,
        }),
        ORDER_SUBMIT_UI_TIMEOUT_MS,
        "Order submission timed out. Please check your connection and try again.",
      );
      const order = result.order;
      const normalizedOrderNumber =
        typeof order.order_number === "number" || typeof order.order_number === "string"
          ? String(order.order_number)
          : null;
      const submittedBy =
        profile?.full_name?.trim() ||
        user?.name?.trim() ||
        user?.email?.trim() ||
        "Staff";
      const itemCount = order.order_items?.length ?? orderItems.length;

      setShowConfirmLocationSheet(false);
      setConfirmLocationId(null);
      setOrderConfirmation({
        orderId: order.id,
        orderNumber: normalizedOrderNumber,
        locationName: selectedLocationName,
        itemCount,
        summary: formatOrderConfirmationSummary(itemCount, selectedLocationName),
        submittedBy,
        submittedAt: order.created_at,
      });
      void triggerConfirmationHaptic();
      completePendingRemindersForUser(userId).catch(() => {});
      resolveActiveLocationReminders(confirmLocationId).catch(() => {});

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
      setVoiceError(null);
      setVoiceReview(null);
      setLastVoiceRecording(null);
      applyVoiceEvent("reset");
      setSessionId(null);
      setNudgeSent(false);
      quickOrderPendingOrderIdRef.current = null;
    } catch (error) {
      console.warn("[QuickOrder] Failed to submit order:", error);
      const isRetryable = error instanceof OrderSubmissionError ? error.retryable : true;
      Alert.alert(
        isRetryable ? "Submit Order Failed" : "Cannot Submit Order",
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      isConfirmingRef.current = false;
      setIsConfirming(false);
    }
  }, [
    confirmLocationId,
    applyVoiceEvent,
    isConfirming,
    isSending,
    issueCount,
    loadInventoryItems,
    locationNameById,
    parsedItems,
    profile?.full_name,
    sessionId,
    user?.email,
    user?.name,
    userId,
  ]);

  const handleToggleMissingSelection = useCallback((itemId: string) => {
    setSelectedMissingItemIds((current) => {
      const next = { ...current };
      if (next[itemId]) {
        delete next[itemId];
      } else {
        next[itemId] = true;
      }
      return next;
    });
  }, []);

  const handleAddSelectedMissing = useCallback(() => {
    const selected = highConfidenceMissingSuggestions.filter(
      (suggestion) => selectedMissingItemIds[suggestion.itemId],
    );
    setMissingReviewVisible(false);
    if (selected.length === 0) return;
    void handleSubmitMore(
      buildComposerOrderText(selected.map((suggestion) => ({
        item_id: suggestion.itemId,
        item_name: suggestion.itemName,
        quantity: suggestion.suggestedQuantity,
        unit: suggestion.unit,
        unit_type: null,
      }))),
    );
  }, [handleSubmitMore, highConfidenceMissingSuggestions, selectedMissingItemIds]);

  const handleSkipMissingAndConfirm = useCallback(() => {
    const skippedIds = highConfidenceMissingSuggestions.map((suggestion) => suggestion.itemId);
    setSmartMissingCheck((current) => ({
      ...current,
      ignoredItemIds: [...new Set([...current.ignoredItemIds, ...skippedIds])],
      suggestions: current.suggestions.filter((suggestion) => !skippedIds.includes(suggestion.itemId)),
    }));
    setMissingReviewVisible(false);
    skipMissingReviewOnceRef.current = true;
    requestAnimationFrame(() => {
      void handleConfirmOrder();
    });
  }, [handleConfirmOrder, highConfidenceMissingSuggestions]);

  const handleCancelMissingReview = useCallback(() => {
    setMissingReviewVisible(false);
  }, []);

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
        const inventoryUpdateNoOrderKeys = new Set(
          (message.inventoryUpdates ?? [])
            .filter((row) => row.new_quantity == null)
            .map((row) => row.item_id || row.item_name.toLowerCase())
            .filter((key) => key.length > 0),
        );
        const filteredSafetyWarnings = (message.safetyWarnings ?? []).filter(
          (warning) => {
            const key =
              warning.item_id ?? warning.item_name?.toLowerCase() ?? "";
            if (key.length > 0 && clarificationItemKeys.has(key)) return false;
            if (warning.type === "no_order_needed" && key.length > 0 && inventoryUpdateNoOrderKeys.has(key)) {
              return false;
            }
            return true;
          },
        );
        // Inventory-mode replies speak through the "Updated" card alone: the
        // counted→ordered rows make the chosen quantity obvious, so the generic
        // text pill is dropped. Genuine problems still surface below as their
        // own warning/clarification cards (the "second message").
        const hasInventoryUpdates = (message.inventoryUpdates?.length ?? 0) > 0;
        const suppressAssistantPill =
          hasInventoryUpdates ||
          renderableClarifications.length > 0 ||
          filteredSafetyWarnings.length > 0;
        const revertAction = getRevertAction(message);
        const mutationId = revertAction?.mutationId ?? message.mutationId ?? null;
        // Every assistant reply is a rounded chat bubble: green when it confirms
        // a cart change, amber when the user must fix something, neutral for
        // Q&A/info. A revertable cart mutation gets a subtle "Revert" affordance
        // beneath the bubble — the assistant-side mirror of the "Copy" control
        // under user messages.
        const contextNotes = deriveContextNotes(message);
        return (
          <View>
            <ContextNotesDisclosure notes={contextNotes} />
            {suppressAssistantPill ? null : (
              <AIResponsePill message={message} onLayout={layoutHandler} />
            )}
            {!suppressAssistantPill && revertAction && mutationId ? (
              <InlineRevertButton
                reverting={Boolean(revertingMutationIds[mutationId])}
                reverted={Boolean(message.reverted)}
                disabled={revertAction.disabled}
                label={revertAction.label}
                onPress={() => handleRevertMutation(message, revertAction)}
              />
            ) : null}
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
            {hasInventoryUpdates ? (
              <InventoryUpdateCard
                updates={message.inventoryUpdates ?? []}
                onLayout={layoutHandler}
              />
            ) : message.stockUpdates?.length ? (
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
                onPreview={handlePreviewToComposer}
                onDiscard={handleDiscardSuggestion}
                onLayout={layoutHandler}
              />
            ))}
            {message.recommendations?.length ? (
              <RecommendationCard
                recommendations={message.recommendations}
                onAdd={handleAddRecommendations}
                onPreview={handlePreviewRecommendations}
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
      handlePreviewToComposer,
      handleDiscardSuggestion,
      handleAddRecommendations,
      handlePreviewRecommendations,
      handleClarificationAction,
      handleRejectClarification,
      handleMessageLayout,
      handleRevertMutation,
      handleRetry,
      revertingMutationIds,
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
      const voiceMetadata = pendingVoiceDraftMetadataRef.current;
      pendingVoiceDraftMetadataRef.current = null;
      void handleSubmitMore(
        text,
        voiceMetadata ? "voice" : "typed",
        voiceMetadata ?? undefined,
        { composerMode },
      );
    },
    [composerMode, handleSubmitMore],
  );

  // Composer suggestion pills. Each sends a human-readable message (which also
  // matches the parser's history-intent phrases) and asks handleSubmitMore to
  // auto-fill the composer with whatever order comes back.
  const handleComposerPillPress = useCallback(
    (pill: string) => {
      if (isSending) return;
      if (pill !== "last_week" && pill !== "recent" && pill !== "usual") return;
      const message =
        pill === "last_week"
          ? "Reorder last week’s order"
          : pill === "recent"
            ? "Reorder my recent order"
            : "Show my usual order";
      void handleSubmitMore(message, "typed", undefined, { reorderPill: pill });
    },
    [handleSubmitMore, isSending],
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
        <View style={[styles.chatArea, { paddingTop: ds.spacing(5) }]}>
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
                  <ActivityIndicator color={quickOrderAccent} />
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
              <>
                {voiceReview ? (
                  <VoiceReviewCard
                    review={voiceReview}
                    status={voiceStatus}
                    onAdd={() => { void handleAddVoiceReview(); }}
                    onEditText={handleEditVoiceReview}
                    onRetry={handleRetryVoiceReview}
                    onDiscard={handleDiscardVoiceReview}
                  />
                ) : null}
                {isSending ? (
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
                    <ActivityIndicator color={quickOrderAccent} />
                    <Text
                      style={[styles.typingText, { fontSize: ds.fontSize(15) }]}
                    >
                      Reading order...
                    </Text>
                  </View>
                ) : null}
              </>
            }
          />

          {/* Layer 2 — the floating "Order List" card pinned just below the header. */}
          <QuickOrderListCard
            items={parsedItems}
            issueCount={issueCount}
            isSubmitting={isConfirming}
            onEditItem={handleEditItem}
            onResolveQuantity={handleResolveQuantity}
            onRemoveItems={handleRemoveItems}
            onConfirm={() => void handleConfirmOrder()}
            onHeightChange={handleOrderCardHeightChange}
            locationShortLabel={locationShortLabel}
            locationLabel={location?.name ?? ""}
            locations={allLocations}
            selectedLocationId={location?.id ?? null}
            isLocationDropdownOpen={locationDropdownOpen}
            onToggleLocationDropdown={handleToggleLocationDropdown}
            onSelectLocation={handleSelectLocation}
            onCloseLocationDropdown={handleCloseLocationDropdown}
            onClear={handleClearRequest}
          />
        </View>

        <QuickOrderComposerBar
          onSubmit={handleComposerSubmit}
          isSending={isSending || voiceStatus === "transcribing"}
          bottomInset={insets.bottom}
          tabBarHeight={tabBarHeight}
          prefillText={composerPrefill.text}
          prefillNonce={composerPrefill.nonce}
          placeholder={getComposerPlaceholder(composerMode)}
          composerMode={composerMode}
          onComposerModeChange={setComposerMode}
          suggestionPills={showComposerPills ? COMPOSER_SUGGESTION_PILLS : undefined}
          onSuggestionPillPress={handleComposerPillPress}
          onHeightChange={handleComposerHeightChange}
          onBottomOffsetChange={handleComposerBottomOffsetChange}
          voiceEnabled={voiceEnabled}
          voiceStatus={voiceStatus}
          voiceMetering={audioRecorderState.metering}
          voiceError={voiceError}
          onStartVoice={handleStartVoice}
          onSubmitVoice={handleSubmitVoice}
          onCancelVoice={handleCancelVoice}
          onRetryVoice={handleRetryVoice}
        />

        <Modal
          visible={missingReviewVisible}
          transparent
          animationType="fade"
          onRequestClose={handleCancelMissingReview}
        >
          <View style={styles.missingReviewBackdrop}>
            <View
              style={[
                styles.missingReviewCard,
                {
                  borderRadius: ds.radius(18),
                  padding: ds.spacing(16),
                },
              ]}
            >
              <Text style={[styles.missingReviewTitle, { fontSize: ds.fontSize(18) }]}>
                Before you confirm, you may be missing {highConfidenceMissingSuggestions.length} usual {highConfidenceMissingSuggestions.length === 1 ? "item" : "items"}.
              </Text>
              <View style={{ marginTop: ds.spacing(10), gap: ds.spacing(8) }}>
                {highConfidenceMissingSuggestions.map((suggestion) => {
                  const selected = Boolean(selectedMissingItemIds[suggestion.itemId]);
                  return (
                    <Pressable
                      key={suggestion.itemId}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      onPress={() => handleToggleMissingSelection(suggestion.itemId)}
                      style={[
                        styles.missingReviewRow,
                        {
                          borderRadius: ds.radius(12),
                          padding: ds.spacing(10),
                        },
                      ]}
                    >
                      <Ionicons
                        name={selected ? "checkbox" : "square-outline"}
                        size={ds.icon(22)}
                        color={selected ? quickOrderAccent : colors.textMuted}
                      />
                      <View style={styles.missingReviewRowText}>
                        <Text style={[styles.missingReviewItem, { fontSize: ds.fontSize(15) }]}>
                          {suggestion.itemName} - {suggestion.suggestedQuantity}{suggestion.unit ? ` ${suggestion.unit}` : ""}
                        </Text>
                        <Text style={[styles.missingReviewReason, { fontSize: ds.fontSize(12) }]}>
                          {suggestion.reason}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={[styles.missingReviewActions, { marginTop: ds.spacing(14), gap: ds.spacing(8) }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add selected missing items"
                  onPress={handleAddSelectedMissing}
                  style={({ pressed }) => [
                    styles.missingReviewPrimaryButton,
                    {
                      borderRadius: ds.radius(12),
                      paddingVertical: ds.spacing(10),
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.missingReviewPrimaryText, { fontSize: ds.fontSize(14) }]}>
                    Add selected
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Skip missing items and confirm order"
                  onPress={handleSkipMissingAndConfirm}
                  style={({ pressed }) => [
                    styles.missingReviewSecondaryButton,
                    {
                      borderRadius: ds.radius(12),
                      paddingVertical: ds.spacing(10),
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.missingReviewSecondaryText, { fontSize: ds.fontSize(14) }]}>
                    Skip and confirm
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel missing item review"
                  onPress={handleCancelMissingReview}
                  style={({ pressed }) => [
                    styles.missingReviewCancelButton,
                    {
                      borderRadius: ds.radius(12),
                      paddingVertical: ds.spacing(10),
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.missingReviewCancelText, { fontSize: ds.fontSize(14) }]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

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
          composerMode={composerMode}
          isSaving={isQuantitySaving}
          onClose={handleQuantityClose}
          onApply={(result) => void handleQuantityApply(result)}
          onSkip={handleQuantitySkip}
          onRemove={handleQuantityRemove}
        />
      </View>

      <ConfirmLocationBottomSheet
        visible={showConfirmLocationSheet}
        selectedLocationId={confirmLocationId}
        locationOptions={submitLocationOptions}
        isSubmitting={isConfirming}
        onLocationChange={handleSelectSubmitLocation}
        onNoLocationAvailable={handleUnavailableSubmitLocationChange}
        onConfirm={() => { void handleConfirmSubmitOrder(); }}
        onClose={handleCloseConfirmLocationSheet}
      />

      <OrderSubmissionConfirmationOverlay
        confirmation={orderConfirmation}
        onDismissed={() => {
          setOrderConfirmation(null);
        }}
      />
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
  voiceReviewCard: {
    alignSelf: "stretch",
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  voiceReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  voiceReviewTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  voiceReviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  voiceReviewRowText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  voiceReviewUnresolved: {
    backgroundColor: colors.statusAmberBg,
    borderWidth: glassHairlineWidth,
    borderColor: colors.statusAmber,
  },
  voiceReviewSectionLabel: {
    color: colors.statusAmber,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  voiceReviewWarningText: {
    color: colors.textPrimary,
    fontWeight: "700",
    letterSpacing: 0,
    marginTop: 3,
  },
  voiceReviewMutedText: {
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  voiceReviewActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  voiceReviewPrimaryButton: {
    flex: 1.25,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: quickOrderAccent,
  },
  voiceReviewPrimaryText: {
    color: colors.textOnPrimary,
    fontWeight: "900",
    letterSpacing: 0,
  },
  voiceReviewSecondaryButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: quickOrderAccentPale,
  },
  voiceReviewSecondaryText: {
    color: quickOrderAccent,
    fontWeight: "800",
    letterSpacing: 0,
  },
  aiPill: {
    alignSelf: "flex-start",
    maxWidth: "88%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    ...(Platform.OS === "android"
      ? { elevation: 0, shadowOpacity: 0 }
      : {
          shadowColor: colors.textPrimary,
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.03,
          shadowRadius: 10,
          elevation: 1,
        }),
  },
  aiPillCaution: {
    backgroundColor: quickOrderAssistantPillBackground.caution,
    borderWidth: 0,
  },
  aiPillSuccess: {
    backgroundColor: quickOrderAssistantPillBackground.success,
    borderWidth: 0,
  },
  aiPillText: {
    flexShrink: 1,
    marginLeft: 10,
    color: colors.textPrimary,
    fontWeight: "600",
    letterSpacing: 0,
  },
  aiPillTextAndroid: {
    includeFontPadding: false,
    backgroundColor: "transparent",
    textAlignVertical: "center",
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
  personalContextNote: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 4,
    marginLeft: 4,
  },
  personalContextDisclosure: {
    marginBottom: 4,
  },
  personalContextToggle: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: "italic",
    fontWeight: "700",
    marginLeft: 4,
  },
  inventoryUpdateRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  inventoryUpdateNewText: {
    color: quickOrderAccent,
    fontWeight: "800",
    letterSpacing: 0,
  },
  inventoryUpdateDashText: {
    color: colors.textSecondary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  // Counted but not ordered (above range, no order needed, etc.): "– 0 unit" in
  // black so it reads as deliberately left alone, distinct from the red orders.
  inventoryUpdateNotOrderedText: {
    color: colors.textPrimary,
    fontWeight: "800",
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
    backgroundColor: quickOrderAccentLight,
  },
  suggestionButtonText: {
    color: quickOrderAccent,
    fontWeight: "800",
    letterSpacing: 0,
  },
  missingReviewBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 22,
    backgroundColor: colors.scrimStrong,
  },
  missingReviewCard: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  missingReviewTitle: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  missingReviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.glassCircle,
    borderWidth: 1,
    borderColor: glassColors.cardBorder,
  },
  missingReviewRowText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
  },
  missingReviewItem: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  missingReviewReason: {
    marginTop: 3,
    color: colors.textSecondary,
    fontWeight: "600",
    letterSpacing: 0,
  },
  missingReviewActions: {
    flexDirection: "column",
  },
  missingReviewPrimaryButton: {
    alignItems: "center",
    backgroundColor: quickOrderAccent,
  },
  missingReviewPrimaryText: {
    color: colors.textOnPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  missingReviewSecondaryButton: {
    alignItems: "center",
    backgroundColor: quickOrderAccentPale,
    borderWidth: 1,
    borderColor: quickOrderAccentLight,
  },
  missingReviewSecondaryText: {
    color: quickOrderAccent,
    fontWeight: "800",
    letterSpacing: 0,
  },
  missingReviewCancelButton: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: glassColors.cardBorder,
  },
  missingReviewCancelText: {
    color: colors.textSecondary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  revertAffordance: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
  },
  revertAffordanceRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  revertAffordanceText: {
    fontWeight: "700",
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
