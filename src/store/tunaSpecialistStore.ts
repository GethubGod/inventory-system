import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '@/lib/supabase';
import type { EventSubscription } from 'expo-modules-core';

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

  // Actions
  initVoice: () => void;
  destroyVoice: () => void;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  sendToGemini: (locationShortCode: string) => Promise<void>;
  processOfflineQueue: (locationShortCode: string) => Promise<void>;
  resolveAmbiguousItem: (cartIndex: number, alternativeAreaItemId: string) => void;
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
  reset: () => void;
}

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

// --- Listener subscriptions (module-level) ---
let subscriptions: EventSubscription[] = [];

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
};

// --- Store ---

export const useTunaSpecialistStore = create<TunaSpecialistState>()(
  persist(
    (set, get) => ({
      ...initialState,

      initVoice: () => {
        // Clean up any existing listeners
        subscriptions.forEach((s) => s.remove());
        subscriptions = [];

        subscriptions.push(
          ExpoSpeechRecognitionModule.addListener('start', () => {
            set({ isListening: true, currentSpeaker: 'human', error: null });
          }),
        );

        subscriptions.push(
          ExpoSpeechRecognitionModule.addListener('end', () => {
            set({ isListening: false });
          }),
        );

        subscriptions.push(
          ExpoSpeechRecognitionModule.addListener('result', (event) => {
            const transcript = event.results[0]?.transcript ?? '';
            if (event.isFinal) {
              set({ finalTranscript: transcript, liveTranscript: '' });
            } else {
              set({ liveTranscript: transcript });
            }
          }),
        );

        subscriptions.push(
          ExpoSpeechRecognitionModule.addListener('error', (event) => {
            const message =
              event.error === 'no-speech'
                ? "I didn't catch that. Try speaking closer to the mic."
                : `Speech recognition error: ${event.message || event.error}`;
            set({ error: message, isListening: false, currentSpeaker: null });
          }),
        );
      },

      destroyVoice: () => {
        subscriptions.forEach((s) => s.remove());
        subscriptions = [];
        ExpoSpeechRecognitionModule.abort();
      },

      startListening: async () => {
        if (get().isListening || get().isProcessing) return;

        try {
          // Check connectivity
          const netState = await NetInfo.fetch();
          set({ isOnline: !!netState.isConnected });

          // Request permissions
          const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
          if (!result.granted) {
            set({ error: 'Microphone permission denied. Please enable it in Settings.' });
            return;
          }

          // Clear previous state
          set({ liveTranscript: '', finalTranscript: null, error: null });

          haptic(Haptics.ImpactFeedbackStyle.Light);

          // Start on-device speech recognition
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
          ExpoSpeechRecognitionModule.stop();
        } catch {
          // May already be stopped
        }

        haptic(Haptics.ImpactFeedbackStyle.Medium);
        set({ isListening: false });
      },

      sendToGemini: async (locationShortCode: string) => {
        const { finalTranscript, isOnline, geminiHistory } = get();
        if (!finalTranscript) return;

        // Offline: queue it
        if (!isOnline) {
          set((state) => ({
            offlineQueue: [
              ...state.offlineQueue,
              {
                id: generateId(),
                transcript: finalTranscript,
                timestamp: Date.now(),
                locationShortCode,
              },
            ],
            conversation: [
              ...state.conversation,
              {
                id: generateId(),
                type: 'human' as const,
                text: finalTranscript,
                timestamp: Date.now(),
              },
              {
                id: generateId(),
                type: 'ai' as const,
                text: "Saved! I'll process this when you're back online.",
                timestamp: Date.now(),
              },
            ],
            finalTranscript: null,
          }));
          return;
        }

        set({ isProcessing: true, currentSpeaker: 'ai' });

        // Add human message to conversation
        const humanMsg: ConversationMessage = {
          id: generateId(),
          type: 'human',
          text: finalTranscript,
          timestamp: Date.now(),
        };

        // Update gemini history with user turn
        const updatedHistory: GeminiMessage[] = [
          ...geminiHistory,
          { role: 'user', parts: [{ text: finalTranscript }] },
        ];

        set((state) => ({
          conversation: [...state.conversation, humanMsg],
          geminiHistory: updatedHistory,
        }));

        try {
          // Get current user ID
          const { data: { user } } = await supabase.auth.getUser();
          const employeeId = user?.id;

          const { data, error } = await invokeEdgeFunction({
            transcript: finalTranscript,
            conversationHistory: updatedHistory,
            employeeId,
            locationShortCode,
          });

          if (error) throw error;

          const {
            aiMessage,
            parsedItems = [],
            geminiTurn,
          } = data as {
            aiMessage: string;
            parsedItems: TunaCartItem[];
            geminiTurn: GeminiMessage;
          };

          // Add AI message to conversation
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

          set((state) => ({
            conversation: [...state.conversation, aiMsg],
            geminiHistory: [...state.geminiHistory, geminiTurn],
            cartItems: [...state.cartItems, ...parsedItems],
            isProcessing: false,
            currentSpeaker: null,
            finalTranscript: null,
          }));
        } catch (err) {
          const message =
            err instanceof DOMException && err.name === 'AbortError'
              ? "Request timed out. Try again."
              : "Something went wrong. Try again.";

          set((state) => ({
            conversation: [
              ...state.conversation,
              {
                id: generateId(),
                type: 'ai' as const,
                text: message,
                timestamp: Date.now(),
              },
            ],
            isProcessing: false,
            currentSpeaker: null,
            finalTranscript: null,
          }));
        }
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

            const { aiMessage, parsedItems = [], geminiTurn } = data as {
              aiMessage: string;
              parsedItems: TunaCartItem[];
              geminiTurn: GeminiMessage;
            };

            processedIds.push(item.id);

            set((state) => ({
              conversation: [
                ...state.conversation,
                {
                  id: generateId(),
                  type: 'ai' as const,
                  text: `[Offline] ${aiMessage}`,
                  timestamp: Date.now(),
                  parsedItems: parsedItems.length > 0 ? parsedItems : undefined,
                },
              ],
              cartItems: [...state.cartItems, ...parsedItems],
            }));
          } catch {
            // Skip failed items, try again later
          }
        }

        if (processedIds.length > 0) {
          set((state) => ({
            offlineQueue: state.offlineQueue.filter((q) => !processedIds.includes(q.id)),
          }));
        }
      },

      resolveAmbiguousItem: (cartIndex: number, alternativeAreaItemId: string) => {
        // Reserved for future use
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
        set({ cartItems: [], conversation: [], geminiHistory: [] });
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

      reset: () => {
        if (get().isListening) {
          ExpoSpeechRecognitionModule.abort();
        }
        set({ ...initialState });
      },
    }),
    {
      name: 'tuna-specialist-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cartItems: state.cartItems,
        offlineQueue: state.offlineQueue,
      }),
    },
  ),
);

function hapicNotifyWarn() {
  if (Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }
}
