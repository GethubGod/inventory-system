import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  Text,
  TextInput,
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
  type QuickOrderConfigItem,
  normalizeAlias,
  normalizeAliasKey,
} from './types';

interface AliasesTabProps {
  items: QuickOrderConfigItem[];
  setItems: React.Dispatch<React.SetStateAction<QuickOrderConfigItem[]>>;
}

export function AliasesTab({ items, setItems }: AliasesTabProps) {
  const ds = useScaledStyles();
  const [search, setSearch] = useState('');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [aliasInputs, setAliasInputs] = useState<Record<string, string>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items.slice(0, 60);
    return items
      .filter((item) => {
        const aliases = item.aliases.join(' ').toLowerCase();
        return item.name.toLowerCase().includes(query) || aliases.includes(query);
      })
      .slice(0, 60);
  }, [items, search]);

  const persistAliases = useCallback(
    async (itemId: string, nextAliases: string[]) => {
      const { error } = await supabase
        .from('inventory_items')
        .update({ aliases: nextAliases })
        .eq('id', itemId);
      if (error) throw error;
      setItems((current) =>
        current.map((entry) =>
          entry.id === itemId ? { ...entry, aliases: nextAliases } : entry,
        ),
      );
    },
    [setItems],
  );

  const expandItem = useCallback((itemId: string) => {
    setExpandedItemId(itemId);
    setAliasInputs((current) => ({ ...current, [itemId]: current[itemId] ?? '' }));
    requestAnimationFrame(() => {
      inputRefs.current[itemId]?.focus();
    });
  }, []);

  const collapseItem = useCallback(() => {
    setExpandedItemId(null);
  }, []);

  const addAlias = useCallback(
    async (item: QuickOrderConfigItem) => {
      const raw = aliasInputs[item.id] ?? '';
      const alias = normalizeAlias(raw);
      if (!alias) return;

      const exists = item.aliases.some(
        (existing) => normalizeAliasKey(existing) === normalizeAliasKey(alias),
      );
      if (exists) {
        Alert.alert('Alias already exists', `${item.name} already has that alias.`);
        return;
      }

      const next = [...item.aliases, alias].sort((a, b) => a.localeCompare(b));
      try {
        setSavingItemId(item.id);
        await persistAliases(item.id, next);
        setAliasInputs((current) => ({ ...current, [item.id]: '' }));
        collapseItem();
      } catch (error: any) {
        Alert.alert('Alias update failed', error?.message ?? 'Unable to save alias.');
      } finally {
        setSavingItemId(null);
      }
    },
    [aliasInputs, collapseItem, persistAliases],
  );

  const removeAlias = useCallback(
    async (item: QuickOrderConfigItem, alias: string) => {
      const next = item.aliases.filter((entry) => entry !== alias);
      try {
        setSavingItemId(item.id);
        await persistAliases(item.id, next);
      } catch (error: any) {
        Alert.alert('Alias update failed', error?.message ?? 'Unable to remove alias.');
      } finally {
        setSavingItemId(null);
      }
    },
    [persistAliases],
  );

  return (
    <View>
      <Text
        style={{
          fontSize: ds.fontSize(22),
          fontWeight: '800',
          color: glassColors.textPrimary,
          marginBottom: ds.spacing(12),
        }}
      >
        Aliases
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.white,
          borderRadius: glassRadii.pill,
          borderWidth: 1,
          borderColor: glassColors.cardBorder,
          paddingHorizontal: ds.spacing(14),
          minHeight: 48,
          marginBottom: ds.spacing(14),
        }}
      >
        <Ionicons name="search" size={ds.icon(18)} color={glassColors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search inventory by name or alias"
          placeholderTextColor={glassColors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          style={{
            flex: 1,
            marginLeft: ds.spacing(8),
            color: glassColors.textPrimary,
            fontSize: ds.fontSize(15),
          }}
        />
      </View>

      <View style={{ gap: ds.spacing(12) }}>
        {filteredItems.map((item) => (
          <AliasItemCard
            key={item.id}
            item={item}
            expanded={expandedItemId === item.id}
            inputValue={aliasInputs[item.id] ?? ''}
            saving={savingItemId === item.id}
            onChangeInput={(value) =>
              setAliasInputs((current) => ({ ...current, [item.id]: value }))
            }
            onExpand={() => expandItem(item.id)}
            onCollapse={collapseItem}
            onSubmit={() => void addAlias(item)}
            onRemoveAlias={(alias) => void removeAlias(item, alias)}
            inputRef={(ref) => {
              inputRefs.current[item.id] = ref;
            }}
          />
        ))}

        {filteredItems.length === 0 ? (
          <Text
            style={{
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(14),
              textAlign: 'center',
              paddingVertical: ds.spacing(40),
            }}
          >
            No inventory items match that search.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

interface AliasItemCardProps {
  item: QuickOrderConfigItem;
  expanded: boolean;
  inputValue: string;
  saving: boolean;
  onChangeInput: (value: string) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onSubmit: () => void;
  onRemoveAlias: (alias: string) => void;
  inputRef: (ref: TextInput | null) => void;
}

function AliasItemCard({
  item,
  expanded,
  inputValue,
  saving,
  onChangeInput,
  onExpand,
  onCollapse,
  onSubmit,
  onRemoveAlias,
  inputRef,
}: AliasItemCardProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: glassRadii.surface,
        borderWidth: expanded ? 2 : 1,
        borderColor: expanded ? colors.primary : glassColors.cardBorder,
        padding: ds.spacing(16),
      }}
    >
      <Text
        style={{
          fontSize: ds.fontSize(17),
          fontWeight: '700',
          color: glassColors.textPrimary,
          marginBottom: ds.spacing(10),
        }}
      >
        {item.name}
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(8), alignItems: 'center' }}>
        {item.aliases.length === 0 ? (
          <Text
            style={{
              color: glassColors.textSecondary,
              fontStyle: 'italic',
              fontSize: ds.fontSize(14),
            }}
          >
            No aliases yet
          </Text>
        ) : (
          item.aliases.map((alias) => (
            <View
              key={alias}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: grayScale[100],
                borderRadius: glassRadii.pill,
                paddingLeft: ds.spacing(12),
                paddingRight: ds.spacing(8),
                paddingVertical: ds.spacing(6),
                gap: ds.spacing(6),
              }}
            >
              <Text
                style={{
                  color: glassColors.textPrimary,
                  fontSize: ds.fontSize(13),
                  fontWeight: '600',
                }}
              >
                {alias}
              </Text>
              <TouchableOpacity
                onPress={() => onRemoveAlias(alias)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
              >
                <Ionicons name="close" size={ds.icon(14)} color={glassColors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))
        )}

        {!expanded ? (
          <TouchableOpacity
            onPress={onExpand}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.primaryLight,
              borderRadius: glassRadii.pill,
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(7),
              gap: ds.spacing(2),
            }}
          >
            <Ionicons name="add" size={ds.icon(15)} color={colors.primary} />
            <Text
              style={{
                color: colors.primary,
                fontSize: ds.fontSize(13),
                fontWeight: '700',
              }}
            >
              Add
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {expanded ? (
        <View style={{ marginTop: ds.spacing(12), gap: ds.spacing(10) }}>
          <View
            style={{
              backgroundColor: colors.white,
              borderRadius: glassRadii.pill,
              borderWidth: 1,
              borderColor: glassColors.cardBorder,
              paddingHorizontal: ds.spacing(14),
              minHeight: 46,
              justifyContent: 'center',
            }}
          >
            <TextInput
              ref={inputRef}
              value={inputValue}
              onChangeText={onChangeInput}
              placeholder="e.g. abocado"
              placeholderTextColor={glassColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={onSubmit}
              style={{
                color: glassColors.textPrimary,
                fontSize: ds.fontSize(15),
                padding: 0,
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: ds.spacing(10) }}>
            <Pressable
              onPress={onCollapse}
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
                opacity: saving ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: glassColors.textPrimary,
                  fontWeight: '700',
                  fontSize: ds.fontSize(14),
                }}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={onSubmit}
              disabled={saving || !inputValue.trim()}
              style={({ pressed }) => ({
                flex: 2,
                minHeight: 44,
                borderRadius: glassRadii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.primary,
                opacity: saving || !inputValue.trim() ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: colors.textOnPrimary,
                  fontWeight: '700',
                  fontSize: ds.fontSize(14),
                }}
              >
                {saving ? 'Saving…' : 'Save alias'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
