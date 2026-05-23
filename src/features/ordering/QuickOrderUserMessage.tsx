import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, quickOrderAccent } from '@/theme/design';

/** How long the "Copied" confirmation stays visible after a tap. */
const COPIED_RESET_MS = 1200;

type QuickOrderUserMessageProps = {
  /** The exact text the user typed (line breaks preserved on copy). */
  text: string;
  source?: 'typed' | 'voice';
  onLayout?: (event: LayoutChangeEvent) => void;
};

/**
 * A user message bubble plus a small, subtle "Copy" affordance underneath it so
 * employees can quickly re-grab a long order string. Memoised because it sits in
 * the chat FlatList — only re-renders when its text changes.
 */
export const QuickOrderUserMessage = React.memo(function QuickOrderUserMessage({
  text,
  source = 'typed',
  onLayout,
}: QuickOrderUserMessageProps) {
  const ds = useScaledStyles();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(() => {
    void Clipboard.setStringAsync(text);
    void triggerSelectionHaptic();
    setCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [text]);

  return (
    <View onLayout={onLayout} style={[styles.wrapper, { marginTop: ds.spacing(10) }]}>
      <View
        style={[
          styles.bubble,
          {
            borderRadius: ds.radius(20),
            paddingHorizontal: ds.spacing(16),
            paddingVertical: ds.spacing(10),
          },
        ]}
      >
        <Text style={[styles.bubbleText, { fontSize: ds.fontSize(16) }]}>{text}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Message copied' : 'Copy message'}
        hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
        onPress={handleCopy}
        style={({ pressed }) => [
          styles.copyButton,
          { marginTop: ds.spacing(4), opacity: pressed ? 0.5 : 1 },
        ]}
      >
        <View style={[styles.copyRow, { gap: ds.spacing(6) }]}>
          <Ionicons
            name={copied ? 'checkmark' : source === 'voice' ? 'mic-outline' : 'copy-outline'}
            size={ds.icon(13)}
            color={copied ? colors.statusGreen : colors.textMuted}
          />
          <Text
            style={[
              styles.copyText,
              {
                fontSize: ds.fontSize(12),
                color: copied ? colors.statusGreen : colors.textMuted,
              },
            ]}
          >
            {copied ? 'Copied' : source === 'voice' ? 'Voice' : 'Copy'}
          </Text>
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-end',
  },
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: quickOrderAccent,
  },
  bubbleText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copyText: {
    fontWeight: '700',
    letterSpacing: 0,
  },
});
