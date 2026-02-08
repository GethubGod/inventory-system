import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import { supabase } from '@/lib/supabase';
import type { EventSubscription } from 'expo-modules-core';

// Lazy-load expo-speech-recognition to avoid crashing the entire app
// when the native module isn't available (e.g. before dev client rebuild)
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {
  // Native module not available — voice features will be disabled
}

// --- Types ---

export interface TunaCartItem {
  area_item_id: string | null;
  inventory_item_id?: string;
  item_name: string;
  emoji: string;
  spoken_text: string;
  quantity: number;
  unit: string;
  confidence: number;
}

export interface ConversationMessage {
  id: string;
  type: 'human' | 'ai';
  text: string;
  timestamp: number;
  parsedItems?: TunaCartItem[];
}

interface GeminiMessage {
  role: 'user' | 'model';
  parts: [{ text: string }];
}

interface OfflineQueueItem {
  id: string;
  transcript: string;
  timestamp: number;
  locationShortCode: string;
}

interface TunaSpecialistState {
  // Voice recognition
  isListening: boolean;
  liveTranscript: string;
  finalTranscript: string | null;

  // AI processing
  isProcessing: boolean;
  currentSpeaker: 'human' | 'ai' | null;

  // Conversation
  conversation: ConversationMessage[];
  geminiHistory: GeminiMessage[];

  // Cart
  cartItems: TunaCartItem[];

  // Offline
  isOnline: boolean;
  offlineQueue: OfflineQueueItem[];

  // Error
  error: string | null;

  // Debug (only used in __DEV__)
  lastRawResponse: string | null;

  // Onboarding
  hasSeenOnboarding: boolean;

  // Actions
  initVoice: () => void;
  destroyVoice: () => void;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  sendToGemini: (locationShortCode: string) => Promise<void>;
  sendTextToGemini: (text: string, locationShortCode: string) => Promise<void>;
  processOfflineQueue: (locationShortCode: string) => Promise<void>;
  removeCartItem: (index: number) => void;
  updateCartItemQuantity: (index: number, quantity: number) => void;
  clearCart: () => void;
  getCartForOrder: () => Array<{
    area_item_id: string | null;
    inventory_item_id?: string;
    name: string;
    emoji: string;
    quantity: number;
    unit: string;
  }>;
  setOnboardingSeen: () => void;
  reset: () => void;
}

// --- Constants ---

const MAX_OFFLINE_QUEUE = 20;
const QUEUE_PROCESS_DELAY_MS = 500;

// --- Helpers ---

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function haptic(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(style).catch(() => {});
  }
}

function hapticNotification(type: Haptics.NotificationFeedbackType) {
  if (Platform.OS !== 'web') {
    Haptics.notificationAsync(type).catch(() => {});
  }
}

async function invokeEdgeFunction(body: Record<string, unknown>, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await supabase.functions.invoke('voice-order', { body });
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Module-level subscriptions ---
let voiceSubscriptions: EventSubscription[] = [];
let netInfoUnsubscribe: NetInfoSubscription | null = null;

const initialState = {
  isListening: false,
  liveTranscript: '',
  finalTranscript: null as string | null,
  isProcessing: false,
  currentSpeaker: null as 'human' | 'ai' | null,
  conversation: [] as ConversationMessage[],
  geminiHistory: [] as GeminiMessage[],
  cartItems: [] as TunaCartItem[],
  isOnline: true,
  offlineQueue: [] as OfflineQueueItem[],
  error: null as string | null,
  lastRawResponse: null as string | null,
  hasSeenOnboarding: false,
};

// --- Shared send logic ---

async function performSendToGemini(
  transcript: string,
  locationShortCode: string,
  set: Function,
  get: () => TunaSpecialistState,
) {
  const { isOnline, geminiHistory, offlineQueue } = get();

  // Offline: queue it
  if (!isOnline) {
    if (offlineQueue.length >= MAX_OFFLINE_QUEUE) {
      set((state: TunaSpecialistState) => ({
        conversation: [
          ...state.conversation,
          {
            id: generateId(),
            type: 'ai' as const,
            text: 'Queue is full. Please connect to internet to process pending orders.',
            timestamp: Date.now(),
          },
        ],
        finalTranscript: null,
      }));
      return;
    }

    set((state: TunaSpecialistState) => ({
      offlineQueue: [
        ...state.offlineQueue,
        { id: generateId(), transcript, timestamp: Date.now(), locationShortCode },
      ],
      conversation: [
        ...state.conversation,
        { id: generateId(), type: 'human' as const, text: transcript, timestamp: Date.now() },
        {
          id: generateId(),
          type: 'ai' as const,
          text: "No internet — I've saved your order. I'll process it when you're back online.",
          timestamp: Date.now(),
        },
      ],
      finalTranscript: null,
    }));
    return;
  }

  set({ isProcessing: true, currentSpeaker: 'ai' });

  const humanMsg: ConversationMessage = {
    id: generateId(),
    type: 'human',
    text: transcript,
    timestamp: Date.now(),
  };

  const updatedHistory: GeminiMessage[] = [
    ...geminiHistory,
    { role: 'user', parts: [{ text: transcript }] },
  ];

  set((state: TunaSpecialistState) => ({
    conversation: [...state.conversation, humanMsg],
    geminiHistory: updatedHistory,
  }));

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const employeeId = user?.id;

    const { data, error } = await invokeEdgeFunction({
      transcript,
      conversationHistory: updatedHistory,
      employeeId,
      locationShortCode,
    });

    if (error) throw error;

    const { aiMessage, parsedItems = [], geminiTurn } = data as {
      aiMessage: string;
      parsedItems: TunaCartItem[];
      geminiTurn: GeminiMessage;
    };

    // Store raw response for debug
    if (__DEV__) {
      set({ lastRawResponse: JSON.stringify(data, null, 2) });
    }

    const aiMsg: ConversationMessage = {
      id: generateId(),
      type: 'ai',
      text: aiMessage,
      timestamp: Date.now(),
      parsedItems: parsedItems.length > 0 ? parsedItems : undefined,
    };

    if (parsedItems.length > 0) {
      hapticNotification(Haptics.NotificationFeedbackType.Success);
    }

    set((state: TunaSpecialistState) => ({
      conversation: [...state.conversation, aiMsg],
      geminiHistory: [...state.geminiHistory, geminiTurn],
      cartItems: [...state.cartItems, ...parsedItems],
      isProcessing: false,
      currentSpeaker: null,
      finalTranscript: null,
    }));
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    const message = isTimeout
      ? "I'm taking too long. Try again with a shorter order."
      : "Something went wrong. Try again.";

    hapticNotification(Haptics.NotificationFeedbackType.Error);

    set((state: TunaSpecialistState) => ({
      conversation: [
        ...state.conversation,
        { id: generateId(), type: 'ai' as const, text: message, timestamp: Date.now() },
      ],
      isProcessing: false,
      currentSpeaker: null,
      finalTranscript: null,
    }));
  }
}

// --- Store ---

export const useTunaSpecialistStore = create<TunaSpecialistState>()(
  persist(
    (set, get) => ({
      ...initialState,

      initVoice: () => {
        // Clean up any existing listeners
        voiceSubscriptions.forEach((s) => s.remove());
        voiceSubscriptions = [];

        if (!ExpoSpeechRecognitionModule) {
          set({ error: 'Voice recognition not available. Rebuild the dev client.' });
          // Still subscribe to network changes
          if (netInfoUnsubscribe) netInfoUnsubscribe();
          netInfoUnsubscribe = NetInfo.addEventListener((state) => {
            set({ isOnline: !!state.isConnected });
          });
          return;
        }

        voiceSubscriptions.push(
          ExpoSpeechRecognitionModule.addListener('start', () => {
            set({ isListening: true, currentSpeaker: 'human', error: null });
          }),
        );

        voiceSubscriptions.push(
          ExpoSpeechRecognitionModule.addListener('end', () => {
            set({ isListening: false });
          }),
        );

        voiceSubscriptions.push(
          ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
            const transcript = event.results[0]?.transcript ?? '';
            if (event.isFinal) {
              set({ finalTranscript: transcript, liveTranscript: '' });
            } else {
              set({ liveTranscript: transcript });
            }
          }),
        );

        voiceSubscriptions.push(
          ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
            let message: string;
            if (event.error === 'no-speech') {
              message = "I didn't catch anything. Make sure to speak close to the phone.";
            } else {
              message = 'I had trouble hearing you. Move to a quieter spot and try again.';
            }
            hapticNotification(Haptics.NotificationFeedbackType.Error);
            set({ error: message, isListening: false, currentSpeaker: null });
          }),
        );

        // Subscribe to network changes
        if (netInfoUnsubscribe) netInfoUnsubscribe();
        netInfoUnsubscribe = NetInfo.addEventListener((state) => {
          set({ isOnline: !!state.isConnected });
        });
      },

      destroyVoice: () => {
        voiceSubscriptions.forEach((s) => s.remove());
        voiceSubscriptions = [];
        if (netInfoUnsubscribe) {
          netInfoUnsubscribe();
          netInfoUnsubscribe = null;
        }
        if (ExpoSpeechRecognitionModule) {
          ExpoSpeechRecognitionModule.abort();
        }
      },

      startListening: async () => {
        if (get().isListening || get().isProcessing) return;

        if (!ExpoSpeechRecognitionModule) {
          set({ error: 'Voice recognition not available. Rebuild the dev client.' });
          return;
        }

        try {
          const netState = await NetInfo.fetch();
          set({ isOnline: !!netState.isConnected });

          const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (!result.granted) {
            set({ error: 'Microphone and speech recognition access needed for Tuna Specialist.' });
            return;
          }

          set({ liveTranscript: '', finalTranscript: null, error: null });
          haptic(Haptics.ImpactFeedbackStyle.Light);

          ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: true,
            continuous: false,
            addsPunctuation: true,
          });
        } catch (err) {
          set({
            error: `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },

      stopListening: async () => {
        try {
          if (ExpoSpeechRecognitionModule) ExpoSpeechRecognitionModule.stop();
        } catch {
          // May already be stopped
        }
        haptic(Haptics.ImpactFeedbackStyle.Medium);
        set({ isListening: false });
      },

      sendToGemini: async (locationShortCode: string) => {
        const { finalTranscript } = get();
        if (!finalTranscript) return;
        await performSendToGemini(finalTranscript, locationShortCode, set, get);
      },

      sendTextToGemini: async (text: string, locationShortCode: string) => {
        // For debug panel: bypass STT, send text directly
        set({ finalTranscript: text });
        await performSendToGemini(text, locationShortCode, set, get);
      },

      processOfflineQueue: async (locationShortCode: string) => {
        const { offlineQueue, isOnline } = get();
        if (!isOnline || offlineQueue.length === 0) return;

        const { data: { user } } = await supabase.auth.getUser();
        const employeeId = user?.id;

        const processedIds: string[] = [];

        for (const item of offlineQueue) {
          try {
            const { data, error } = await invokeEdgeFunction({
              transcript: item.transcript,
              conversationHistory: [],
              employeeId,
              locationShortCode: item.locationShortCode,
            });

            if (error) continue;

            const { aiMessage, parsedItems = [] } = data as {
              aiMessage: string;
              parsedItems: TunaCartItem[];
            };

            processedIds.push(item.id);

            set((state) => ({
              conversation: [
                ...state.conversation,
                {
                  id: generateId(),
                  type: 'ai' as const,
                  text: `[Queued] ${aiMessage}`,
                  timestamp: Date.now(),
                  parsedItems: parsedItems.length > 0 ? parsedItems : undefined,
                },
              ],
              cartItems: [...state.cartItems, ...parsedItems],
            }));

            // Small delay between calls to avoid rate limiting
            await delay(QUEUE_PROCESS_DELAY_MS);
          } catch {
            // Skip failed items
          }
        }

        if (processedIds.length > 0) {
          set((state) => ({
            offlineQueue: state.offlineQueue.filter((q) => !processedIds.includes(q.id)),
          }));
        }
      },

      removeCartItem: (index: number) => {
        set((state) => ({
          cartItems: state.cartItems.filter((_, i) => i !== index),
        }));
      },

      updateCartItemQuantity: (index: number, quantity: number) => {
        set((state) => {
          const updated = [...state.cartItems];
          if (updated[index]) {
            updated[index] = { ...updated[index], quantity };
          }
          return { cartItems: updated };
        });
      },

      clearCart: () => {
        hapicNotifyWarn();
        set({ cartItems: [], conversation: [], geminiHistory: [], offlineQueue: [] });
      },

      getCartForOrder: () => {
        return get().cartItems.map((item) => ({
          area_item_id: item.area_item_id,
          inventory_item_id: item.inventory_item_id,
          name: item.item_name,
          emoji: item.emoji,
          quantity: item.quantity,
          unit: item.unit,
        }));
      },

      setOnboardingSeen: () => {
        set({ hasSeenOnboarding: true });
      },

      reset: () => {
        if (get().isListening && ExpoSpeechRecognitionModule) {
          ExpoSpeechRecognitionModule.abort();
        }
        set({ ...initialState, hasSeenOnboarding: get().hasSeenOnboarding });
      },
    }),
    {
      name: 'tuna-specialist-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cartItems: state.cartItems,
        offlineQueue: state.offlineQueue,
        hasSeenOnboarding: state.hasSeenOnboarding,
      }),
    },
  ),
);

function hapicNotifyWarn() {
  if (Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }
}
