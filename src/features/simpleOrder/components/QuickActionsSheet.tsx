import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { glassHairlineWidth, tipsTheme } from '@/theme/design';
import type { SimpleOrderDensity } from '@/types/settings';

/**
 * Quick actions for the checklist, opened from the floating pill's dots
 * button (Order tab only). Two cards: checklist actions (clear / save as
 * default / note) and surfaces (display / receive delivery / recent orders).
 * The order-day reminder editor deliberately is NOT here — it lives in
 * Settings → Order reminders.
 */

export type QuickAction =
  | 'clear'
  | 'saveDefault'
  | 'note'
  | 'display'
  | 'receive'
  | 'recent';

interface QuickActionsSheetProps {
  visible: boolean;
  hasNote: boolean;
  density: SimpleOrderDensity;
  showCategories: boolean;
  onAction: (action: QuickAction) => void;
  onClose: () => void;
}

interface RowSpec {
  action: QuickAction;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string | null;
  chevron?: boolean;
}

function ActionRow({
  spec,
  isLast,
  onPress,
}: {
  spec: RowSpec;
  isLast: boolean;
  onPress: () => void;
}) {
  const ds = useScaledStyles();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={spec.title}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.spacing(11),
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(13),
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: 'rgba(0, 0, 0, 0.05)',
      }}
    >
      <Ionicons name={spec.icon} size={ds.icon(20)} color={tipsTheme.ink} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: ds.fontSize(14.5), fontWeight: '600', color: tipsTheme.ink }}>
          {spec.title}
        </Text>
        {spec.subtitle ? (
          <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink3, marginTop: 1 }}>
            {spec.subtitle}
          </Text>
        ) : null}
      </View>
      {spec.chevron ? (
        <Ionicons name="chevron-forward" size={ds.icon(16)} color={tipsTheme.ink3} />
      ) : null}
    </TouchableOpacity>
  );
}

export function QuickActionsSheet({
  visible,
  hasNote,
  density,
  showCategories,
  onAction,
  onClose,
}: QuickActionsSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const checklistRows: RowSpec[] = [
    {
      action: 'clear',
      icon: 'trash-outline',
      title: 'Clear checklist',
      subtitle: 'Uncheck everything, reset amounts',
    },
    {
      action: 'saveDefault',
      icon: 'bookmark-outline',
      title: 'Save checklist as default',
      subtitle: 'Checked items and amounts start the next order',
    },
    {
      action: 'note',
      icon: 'create-outline',
      title: hasNote ? 'Edit note' : 'Add note',
      subtitle: hasNote ? 'Sent with this order' : 'Attach a message to this order',
    },
  ];

  const surfaceRows: RowSpec[] = [
    {
      action: 'display',
      icon: 'options-outline',
      title: 'Checklist display',
      subtitle: `${density === 'comfort' ? 'Comfortable' : 'Compact'} · categories ${
        showCategories ? 'on' : 'off'
      }`,
      chevron: true,
    },
    {
      action: 'receive',
      icon: 'cube-outline',
      title: 'Receive delivery',
      subtitle: null,
      chevron: true,
    },
    {
      action: 'recent',
      icon: 'time-outline',
      title: 'Recent orders',
      subtitle: null,
      chevron: true,
    },
  ];

  const handle = (action: QuickAction) => {
    void triggerSelectionHaptic();
    onAction(action);
  };

  const card = {
    backgroundColor: tipsTheme.card,
    borderWidth: glassHairlineWidth,
    borderColor: tipsTheme.hairline,
    borderRadius: 18,
    overflow: 'hidden' as const,
  };

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
        Quick actions
      </Text>
      <Text
        style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
      >
        For this checklist.
      </Text>

      <View style={[card, { marginBottom: ds.spacing(10) }]}>
        {checklistRows.map((spec, index) => (
          <ActionRow
            key={spec.action}
            spec={spec}
            isLast={index === checklistRows.length - 1}
            onPress={() => handle(spec.action)}
          />
        ))}
      </View>

      <View style={card}>
        {surfaceRows.map((spec, index) => (
          <ActionRow
            key={spec.action}
            spec={spec}
            isLast={index === surfaceRows.length - 1}
            onPress={() => handle(spec.action)}
          />
        ))}
      </View>
    </BottomSheetShell>
  );
}
