import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTunaSpecialistStore } from '@/store';
import { colors } from '@/constants';

const SENSITIVE_KEY_PATTERN =
  /(transcript|message|text|token|id|email|name|raw|reply|speech|body|history)/i;

function fingerprintText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return `${value.length} chars · ${(hash >>> 0).toString(16).slice(0, 8)}`;
}

function redactDebugValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (key && SENSITIVE_KEY_PATTERN.test(key)) {
      return fingerprintText(value);
    }
    return value.length > 120 ? `${fingerprintText(value)} (truncated)` : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDebugValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactDebugValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

function formatRedactedRawResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(redactDebugValue(parsed), null, 2);
  } catch {
    return fingerprintText(raw);
  }
}

const TEST_TRANSCRIPTS = [
  { label: 'Simple order', text: '10 cases of salmon and 5 tuna' },
  { label: 'Chinese order', text: '三文鱼十箱 金枪鱼五箱' },
  { label: 'Complex order', text: 'I need 3 cases of yellowtail, 2 bags of rice, and 1 box of nori sheets' },
  { label: 'Question', text: 'What did I order last week?' },
];

interface DebugPanelProps {
  locationShortCode: string;
}

export function DebugPanel({ locationShortCode }: DebugPanelProps) {
  const sendTextToIntelligence = useTunaSpecialistStore((s) => s.sendTextToIntelligence);
  const lastRawResponse = useTunaSpecialistStore((s) => s.lastRawResponse);
  const isProcessing = useTunaSpecialistStore((s) => s.isProcessing);
  const isListening = useTunaSpecialistStore((s) => s.isListening);
  const isOnline = useTunaSpecialistStore((s) => s.isOnline);
  const cartItems = useTunaSpecialistStore((s) => s.cartItems);
  const offlineQueue = useTunaSpecialistStore((s) => s.offlineQueue);
  const conversation = useTunaSpecialistStore((s) => s.conversation);

  const [customText, setCustomText] = useState('');
  const [showRawResponse, setShowRawResponse] = useState(false);

  if (!__DEV__) return null;

  const handleSendTest = (text: string) => {
    if (isProcessing || !text.trim()) return;
    sendTextToIntelligence(text.trim(), locationShortCode);
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        padding: 14,
        margin: 12,
        borderWidth: 1,
        borderColor: colors.divider,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary[700], marginBottom: 10 }}>
        Debug Panel
      </Text>

      {/* State info */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <StateBadge label="Listening" active={isListening} />
        <StateBadge label="Processing" active={isProcessing} />
        <StateBadge label="Online" active={isOnline} />
        <StateBadge label={`Cart: ${cartItems.length}`} active={cartItems.length > 0} />
        <StateBadge label={`Queue: ${offlineQueue.length}`} active={offlineQueue.length > 0} />
        <StateBadge label={`Msgs: ${conversation.length}`} active={conversation.length > 0} />
      </View>

      {/* Quick test transcripts */}
      <Text style={{ fontSize: 11, color: colors.gray[600], marginBottom: 6 }}>
        Test Transcripts
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {TEST_TRANSCRIPTS.map((t) => (
          <TouchableOpacity
            key={t.label}
            onPress={() => handleSendTest(t.text)}
            disabled={isProcessing}
            style={{
              backgroundColor: isProcessing ? colors.gray[100] : colors.primary[50],
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontSize: 11, color: isProcessing ? colors.gray[600] : colors.primary[700], fontWeight: '600' }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Custom text input */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <TextInput
          value={customText}
          onChangeText={setCustomText}
          placeholder="Custom transcript..."
          placeholderTextColor={colors.gray[600]}
          style={{
            flex: 1,
            backgroundColor: colors.gray[100],
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            color: colors.text,
            fontSize: 13,
          }}
          returnKeyType="send"
          onSubmitEditing={() => {
            handleSendTest(customText);
            setCustomText('');
          }}
        />
        <TouchableOpacity
          onPress={() => {
            handleSendTest(customText);
            setCustomText('');
          }}
          disabled={isProcessing || !customText.trim()}
          style={{
            backgroundColor: isProcessing || !customText.trim() ? colors.gray[100] : colors.primary[500],
            borderRadius: 8,
            paddingHorizontal: 14,
            justifyContent: 'center',
          }}
        >
          <Ionicons name="send" size={16} color={colors.white} />
        </TouchableOpacity>
      </View>

      {/* Raw response viewer */}
      {lastRawResponse && (
        <View>
          <TouchableOpacity
            onPress={() => setShowRawResponse((p) => !p)}
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}
          >
            <Ionicons
              name={showRawResponse ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={colors.gray[600]}
            />
            <Text style={{ fontSize: 11, color: colors.gray[600], marginLeft: 4 }}>
              Raw Response
            </Text>
          </TouchableOpacity>

          {showRawResponse && (
            <ScrollView
              style={{
                maxHeight: 200,
                backgroundColor: colors.gray[100],
                borderRadius: 8,
                padding: 8,
              }}
            >
              <Text style={{ fontSize: 10, color: colors.gray[500], fontFamily: 'monospace' }}>
                {formatRedactedRawResponse(lastRawResponse)}
              </Text>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

function StateBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <View
      style={{
        backgroundColor: active ? colors.successBg : colors.gray[100],
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          color: active ? colors.success : colors.gray[600],
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}
