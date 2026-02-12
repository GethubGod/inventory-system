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
  const sendTextToGemini = useTunaSpecialistStore((s) => s.sendTextToGemini);
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
    sendTextToGemini(text.trim(), locationShortCode);
  };

  return (
    <View
      style={{
        backgroundColor: 'rgba(0,0,0,0.85)',
        borderRadius: 16,
        padding: 14,
        margin: 12,
        borderWidth: 1,
        borderColor: 'rgba(249,115,22,0.3)',
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FDBA74', marginBottom: 10 }}>
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
      <Text style={{ fontSize: 11, color: '#6B7280', marginBottom: 6 }}>
        Test Transcripts
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {TEST_TRANSCRIPTS.map((t) => (
          <TouchableOpacity
            key={t.label}
            onPress={() => handleSendTest(t.text)}
            disabled={isProcessing}
            style={{
              backgroundColor: isProcessing ? '#374151' : 'rgba(249,115,22,0.2)',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontSize: 11, color: isProcessing ? '#6B7280' : '#FDBA74', fontWeight: '600' }}>
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
          placeholderTextColor="#4B5563"
          style={{
            flex: 1,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
            color: '#E2E8F0',
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
            backgroundColor: isProcessing || !customText.trim() ? '#374151' : '#F97316',
            borderRadius: 8,
            paddingHorizontal: 14,
            justifyContent: 'center',
          }}
        >
          <Ionicons name="send" size={16} color="#FFF" />
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
              color="#6B7280"
            />
            <Text style={{ fontSize: 11, color: '#6B7280', marginLeft: 4 }}>
              Raw Response
            </Text>
          </TouchableOpacity>

          {showRawResponse && (
            <ScrollView
              style={{
                maxHeight: 200,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderRadius: 8,
                padding: 8,
              }}
            >
              <Text style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>
                {lastRawResponse}
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
        backgroundColor: active ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          color: active ? '#86EFAC' : '#6B7280',
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}
