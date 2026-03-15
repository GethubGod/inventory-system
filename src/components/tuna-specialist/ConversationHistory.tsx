import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { ConversationMessage } from '@/store/tunaSpecialistStore';
import { colors } from '@/constants';

interface ConversationHistoryProps {
  visible: boolean;
  onClose: () => void;
  conversation: ConversationMessage[];
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ConversationHistory({
  visible,
  onClose,
  conversation,
}: ConversationHistoryProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          paddingTop: insets.top,
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>
            Conversation
          </Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityLabel="Close conversation history"
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: colors.gray[100],
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={18} color={colors.gray[400]} />
          </TouchableOpacity>
        </View>

        {/* Message List */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {conversation.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="chatbubbles-outline" size={48} color={colors.gray[600]} />
              <Text style={{ color: colors.gray[500], marginTop: 12, fontSize: 15 }}>
                No conversation yet
              </Text>
              <Text style={{ color: colors.gray[600], marginTop: 4, fontSize: 13 }}>
                Tap the mic to start ordering
              </Text>
            </View>
          )}

          {conversation.map((msg) => {
            const isHuman = msg.type === 'human';
            return (
              <View
                key={msg.id}
                style={{
                  alignItems: isHuman ? 'flex-end' : 'flex-start',
                  marginBottom: 12,
                }}
              >
                <View
                  style={{
                    maxWidth: '85%',
                    backgroundColor: isHuman
                      ? colors.successBg
                      : colors.card,
                    borderRadius: 16,
                    borderTopRightRadius: isHuman ? 4 : 16,
                    borderTopLeftRadius: isHuman ? 16 : 4,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      color: isHuman ? colors.success : colors.text,
                      lineHeight: 20,
                    }}
                  >
                    {msg.text}
                  </Text>

                  {/* Parsed items chips */}
                  {msg.parsedItems && msg.parsedItems.length > 0 && (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        marginTop: 8,
                        gap: 6,
                      }}
                    >
                      {msg.parsedItems.map((item, idx) => (
                        <View
                          key={`${item.item_name}-${idx}`}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: colors.primary[50],
                            borderRadius: 10,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                          }}
                        >
                          <Text style={{ fontSize: 12 }}>{item.emoji}</Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: colors.primary[700],
                              fontWeight: '600',
                              marginLeft: 4,
                            }}
                          >
                            {item.quantity} {item.unit} {item.item_name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Timestamp */}
                <Text
                  style={{
                    fontSize: 10,
                    color: colors.gray[600],
                    marginTop: 3,
                    marginHorizontal: 4,
                  }}
                >
                  {formatRelativeTime(msg.timestamp)}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
