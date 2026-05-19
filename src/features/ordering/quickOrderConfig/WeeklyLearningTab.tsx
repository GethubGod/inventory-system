import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassRadii,
  grayScale,
} from '@/theme/design';
import {
  type LearningGroup,
  type ParserCorrectionRow,
  type QuickOrderConfigItem,
  makeIgnoreKey,
  normalizeAlias,
  normalizeAliasKey,
  startOfWeekIso,
} from './types';

const HIGHLIGHT_THRESHOLD = 3;

interface WeeklyLearningTabProps {
  items: QuickOrderConfigItem[];
  corrections: ParserCorrectionRow[];
  ignoreKeys: Set<string>;
  setItems: React.Dispatch<React.SetStateAction<QuickOrderConfigItem[]>>;
  setIgnoreKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function WeeklyLearningTab({
  items,
  corrections,
  ignoreKeys,
  setItems,
  setIgnoreKeys,
}: WeeklyLearningTabProps) {
  const ds = useScaledStyles();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const itemsById = useMemo(() => {
    const map = new Map<string, QuickOrderConfigItem>();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  const allGroups = useMemo<LearningGroup[]>(() => {
    const grouped = new Map<string, LearningGroup>();
    for (const correction of corrections) {
      const rawToken = normalizeAlias(correction.raw_token ?? '');
      const correctedItemId = correction.user_corrected_item_id;
      if (!rawToken || !correctedItemId) continue;
      const item = itemsById.get(correctedItemId);
      if (!item) continue;
      const key = `${normalizeAliasKey(rawToken)}:${correctedItemId}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      grouped.set(key, {
        key,
        rawToken,
        correctedItemId,
        correctedItemName: item.name,
        count: 1,
        alreadyAlias: item.aliases.some(
          (alias) => normalizeAliasKey(alias) === normalizeAliasKey(rawToken),
        ),
      });
    }
    return Array.from(grouped.values()).sort(
      (a, b) => b.count - a.count || a.rawToken.localeCompare(b.rawToken),
    );
  }, [corrections, itemsById]);

  const visibleGroups = useMemo(
    () => allGroups.filter((g) => !ignoreKeys.has(makeIgnoreKey(g.rawToken, g.correctedItemId)) && !g.alreadyAlias),
    [allGroups, ignoreKeys],
  );

  const weekStart = useMemo(() => startOfWeekIso(), []);
  const correctionsThisWeek = useMemo(
    () => corrections.filter((c) => c.created_at >= weekStart).length,
    [corrections, weekStart],
  );

  const addAsAlias = useCallback(
    async (group: LearningGroup) => {
      try {
        setSavingKey(group.key);
        const item = itemsById.get(group.correctedItemId);
        if (!item) return;

        const alias = group.rawToken;
        const exists = item.aliases.some(
          (existing) => normalizeAliasKey(existing) === normalizeAliasKey(alias),
        );
        if (exists) {
          Alert.alert('Alias already exists', `${item.name} already has "${alias}".`);
          return;
        }
        const next = [...item.aliases, alias].sort((a, b) => a.localeCompare(b));
        const { error } = await supabase
          .from('inventory_items')
          .update({ aliases: next })
          .eq('id', item.id);
        if (error) throw error;
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, aliases: next } : entry,
          ),
        );
      } catch (error: any) {
        Alert.alert('Alias update failed', error?.message ?? 'Unable to add alias.');
      } finally {
        setSavingKey(null);
      }
    },
    [itemsById, setItems],
  );

  const ignoreSuggestion = useCallback(
    (group: LearningGroup) => {
      const key = makeIgnoreKey(group.rawToken, group.correctedItemId);
      setIgnoreKeys((current) => {
        if (current.has(key)) return current;
        const next = new Set(current);
        next.add(key);
        return next;
      });
    },
    [setIgnoreKeys],
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', gap: ds.spacing(12), marginBottom: ds.spacing(20) }}>
        <StatCard value={visibleGroups.length} label="Pending suggestions" />
        <StatCard value={correctionsThisWeek} label="Corrections this week" />
      </View>

      <Text
        style={{
          fontSize: ds.fontSize(22),
          fontWeight: '800',
          color: glassColors.textPrimary,
          marginBottom: ds.spacing(12),
        }}
      >
        Suggestions
      </Text>

      <View style={{ gap: ds.spacing(12) }}>
        {visibleGroups.map((group) => (
          <SuggestionCard
            key={group.key}
            group={group}
            saving={savingKey === group.key}
            onAddAlias={() => void addAsAlias(group)}
            onIgnore={() => void ignoreSuggestion(group)}
          />
        ))}

        {visibleGroups.length === 0 ? (
          <Text
            style={{
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(14),
              textAlign: 'center',
              paddingVertical: ds.spacing(40),
            }}
          >
            No correction patterns yet. They&apos;ll show up here once employees correct the parser.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.white,
        borderRadius: glassRadii.surface,
        borderWidth: 1,
        borderColor: glassColors.cardBorder,
        padding: ds.spacing(16),
      }}
    >
      <Text
        style={{
          fontSize: ds.fontSize(34),
          fontWeight: '800',
          color: glassColors.textPrimary,
          lineHeight: ds.fontSize(40),
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          marginTop: ds.spacing(4),
          fontSize: ds.fontSize(13),
          color: glassColors.textSecondary,
          fontWeight: '500',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

interface SuggestionCardProps {
  group: LearningGroup;
  saving: boolean;
  onAddAlias: () => void;
  onIgnore: () => void;
}

function SuggestionCard({ group, saving, onAddAlias, onIgnore }: SuggestionCardProps) {
  const ds = useScaledStyles();
  const isHot = group.count >= HIGHLIGHT_THRESHOLD;
  const pillBg = isHot ? colors.primaryLight : grayScale[100];
  const pillText = isHot ? colors.primary : glassColors.textSecondary;

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: glassRadii.surface,
        borderWidth: 1,
        borderColor: glassColors.cardBorder,
        padding: ds.spacing(16),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: ds.spacing(6),
            backgroundColor: pillBg,
            borderRadius: glassRadii.pill,
            paddingHorizontal: ds.spacing(12),
            paddingVertical: ds.spacing(6),
          }}
        >
          {isHot ? <Ionicons name="trending-up" size={ds.icon(14)} color={pillText} /> : null}
          <Text
            style={{
              color: pillText,
              fontSize: ds.fontSize(12),
              fontWeight: '700',
            }}
          >
            Corrected {group.count} {group.count === 1 ? 'time' : 'times'}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={onIgnore}
          disabled={saving}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={ds.icon(20)} color={glassColors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: ds.spacing(14), gap: ds.spacing(6) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              width: ds.spacing(72),
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(13),
            }}
          >
            Typed
          </Text>
          <Text
            style={{
              flex: 1,
              color: glassColors.textPrimary,
              fontSize: ds.fontSize(15),
              fontWeight: '700',
            }}
          >
            {group.rawToken}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              width: ds.spacing(72),
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(13),
            }}
          >
            Fixed to
          </Text>
          <Text
            style={{
              flex: 1,
              color: glassColors.textPrimary,
              fontSize: ds.fontSize(15),
              fontWeight: '700',
            }}
          >
            {group.correctedItemName}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: ds.spacing(10), marginTop: ds.spacing(16) }}>
        <Pressable
          onPress={onAddAlias}
          disabled={saving}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            borderRadius: glassRadii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
            opacity: saving ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              color: colors.textOnPrimary,
              fontSize: ds.fontSize(14),
              fontWeight: '700',
            }}
          >
            Add as alias
          </Text>
        </Pressable>
        <Pressable
          onPress={onIgnore}
          disabled={saving}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            borderRadius: glassRadii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.white,
            borderWidth: 1,
            borderColor: glassColors.cardBorder,
            opacity: saving ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              color: glassColors.textPrimary,
              fontSize: ds.fontSize(14),
              fontWeight: '700',
            }}
          >
            Ignore
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
