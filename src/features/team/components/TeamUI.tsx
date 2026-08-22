// Shared building blocks for the Team screens (tips colorway).

import type { ReactNode } from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import type { InviteLocationGroup } from '@/services/invites';
import { LOCATION_GROUP_LABELS } from '../invitePreview';

/** White card with the tips hairline border. */
export function TeamCard({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View
      style={{
        backgroundColor: tipsTheme.card,
        borderWidth: glassHairlineWidth,
        borderColor: tipsTheme.hairline,
        borderRadius: 19,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

/** Uppercase section label ("WORKS AT · CHANGE ANYTIME"). */
export function TeamSectionLabel({ label }: { label: string }) {
  const ds = useScaledStyles();
  return (
    <Text
      style={{
        fontSize: ds.fontSize(11.5),
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: tipsTheme.ink2,
        marginTop: ds.spacing(13),
        marginBottom: ds.spacing(6),
      }}
    >
      {label}
    </Text>
  );
}

interface WorksAtSegmentedProps {
  value: InviteLocationGroup;
  onChange: (value: InviteLocationGroup) => void;
  disabled?: boolean;
}

const GROUPS: InviteLocationGroup[] = ['sushi', 'poki', 'both'];

/** Sushi / Poki & Pho / Both segmented control (accent-filled selection). */
export function WorksAtSegmented({ value, onChange, disabled = false }: WorksAtSegmentedProps) {
  const ds = useScaledStyles();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: tipsTheme.well,
        borderRadius: radii.pill,
        padding: 3,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {GROUPS.map((group) => {
        const selected = group === value;
        return (
          <TouchableOpacity
            key={group}
            onPress={() => onChange(group)}
            disabled={disabled}
            activeOpacity={0.82}
            style={{
              flex: 1,
              paddingVertical: ds.spacing(8),
              borderRadius: radii.pill,
              alignItems: 'center',
              backgroundColor: selected ? tipsTheme.accent : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(12),
                fontWeight: selected ? '700' : '600',
                color: selected ? '#FFFFFF' : tipsTheme.ink2,
              }}
            >
              {LOCATION_GROUP_LABELS[group]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

interface ModuleToggleRowProps {
  label: string;
  tag?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  showBorder?: boolean;
}

/** Toggle row inside a TeamCard ("Ordering checklist  DEFAULT  [switch]"). */
export function ModuleToggleRow({
  label,
  tag,
  value,
  onChange,
  disabled = false,
  showBorder = true,
}: ModuleToggleRowProps) {
  const ds = useScaledStyles();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: ds.spacing(8),
        borderBottomWidth: showBorder ? glassHairlineWidth : 0,
        borderBottomColor: tipsTheme.hairline,
      }}
    >
      <Text
        style={{
          fontSize: ds.fontSize(13.5),
          fontWeight: '600',
          color: tipsTheme.ink,
        }}
      >
        {label}
      </Text>
      {tag ? (
        <Text
          style={{
            fontSize: ds.fontSize(9.5),
            fontWeight: '700',
            color: tipsTheme.ink3,
            marginLeft: ds.spacing(6),
          }}
        >
          {tag}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: tipsTheme.disabled, true: tipsTheme.accent }}
      />
    </View>
  );
}

interface TeamRowProps {
  initial: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  muted?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

/** Roster row: avatar initial (or icon), name, summary, chevron. */
export function TeamRow({ initial, title, subtitle, onPress, muted = false, icon }: TeamRowProps) {
  const ds = useScaledStyles();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.82}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.spacing(10),
        backgroundColor: muted ? tipsTheme.well : tipsTheme.card,
        borderWidth: glassHairlineWidth,
        borderColor: muted ? 'transparent' : tipsTheme.hairline,
        borderRadius: 17,
        paddingHorizontal: ds.spacing(13),
        paddingVertical: ds.spacing(11),
        marginBottom: ds.spacing(8),
      }}
    >
      <View
        style={{
          width: ds.icon(36),
          height: ds.icon(36),
          borderRadius: radii.circle,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: muted ? tipsTheme.card : tipsTheme.tint,
        }}
      >
        {icon ? (
          <Ionicons name={icon} size={ds.icon(17)} color={tipsTheme.ink} />
        ) : (
          <Text style={{ fontSize: ds.fontSize(14), fontWeight: '700', color: tipsTheme.accent }}>
            {initial}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: ds.fontSize(13.5), fontWeight: '700', color: tipsTheme.ink }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink2, marginTop: 1 }}
        >
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={ds.icon(16)} color={tipsTheme.ink3} />
    </TouchableOpacity>
  );
}
