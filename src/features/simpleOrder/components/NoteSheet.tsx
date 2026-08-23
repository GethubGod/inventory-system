import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerImpactHaptic } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';

/**
 * Free-text note attached to THIS send: travels to manager review with the
 * order, or is appended to direct-send supplier messages.
 */

interface NoteSheetProps {
  visible: boolean;
  note: string;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function NoteSheet({ visible, note, onSave, onClose }: NoteSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(note);

  useEffect(() => {
    if (visible) setDraft(note);
  }, [visible, note]);

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
          {note.trim() ? 'Edit note' : 'Add note'}
        </Text>
        <Text
          style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
        >
          Goes with this order to the manager.
        </Text>

        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="Example: the walk-in freezer is full, hold the extra rice until Friday"
          placeholderTextColor={tipsTheme.ink3}
          accessibilityLabel="Order note"
          style={{
            minHeight: ds.spacing(96),
            maxHeight: ds.spacing(180),
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            borderRadius: 16,
            paddingHorizontal: ds.spacing(15),
            paddingVertical: ds.spacing(12),
            fontSize: ds.fontSize(14),
            color: tipsTheme.ink,
            textAlignVertical: 'top',
            marginBottom: ds.spacing(14),
          }}
        />

        <TouchableOpacity
          onPress={() => {
            void triggerImpactHaptic();
            onSave(draft.trim());
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Save note"
          style={{
            minHeight: 52,
            borderRadius: radii.pill,
            backgroundColor: tipsTheme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
            {draft.trim() ? 'Save note' : note.trim() ? 'Remove note' : 'Save note'}
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </BottomSheetShell>
  );
}
