import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { GlassSurface, StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { SettingsSectionLabel } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { supabase } from '@/lib/supabase';
import type { InventoryItem, ParserExampleRow, UnitType } from '@/types';
import {
  colors,
  glassColors,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
  uiTints,
} from '@/theme/design';

type QuickOrderConfigItem = InventoryItem & {
  aliases: string[];
};

type ExampleBuilderItem = {
  localId: string;
  item_id: string | null;
  item_name: string;
  itemSearch: string;
  quantity: string;
  unit: string;
  unit_type: UnitType;
};

type ConfigTab = 'aliases' | 'examples' | 'learning';

type ParserCorrectionRow = {
  raw_token: string | null;
  user_corrected_item_id: string | null;
  created_at: string;
};

type LearningGroup = {
  key: string;
  rawToken: string;
  correctedItemId: string;
  correctedItemName: string;
  count: number;
  alreadyAlias: boolean;
};

const INVENTORY_SELECT =
  'id,name,category,supplier_category,supplier_id,base_unit,pack_unit,pack_size,active,aliases,created_at,created_by';

function normalizeAlias(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeAliasKey(value: string) {
  return normalizeAlias(value).toLowerCase();
}

function newBuilderItem(): ExampleBuilderItem {
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    item_id: null,
    item_name: '',
    itemSearch: '',
    quantity: '1',
    unit: '',
    unit_type: 'base',
  };
}

function parseStructuredOutput(value: unknown): ExampleBuilderItem[] {
  if (!Array.isArray(value)) {
    return [newBuilderItem()];
  }

  const rows = value.map((entry) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const quantity = row.quantity;
    const unitType: UnitType = row.unit_type === 'pack' ? 'pack' : 'base';
    return {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      item_id: typeof row.item_id === 'string' ? row.item_id : null,
      item_name: typeof row.item_name === 'string' ? row.item_name : '',
      itemSearch: typeof row.item_name === 'string' ? row.item_name : '',
      quantity:
        typeof quantity === 'number' && Number.isFinite(quantity)
          ? String(quantity)
          : typeof quantity === 'string'
            ? quantity
            : '1',
      unit: typeof row.unit === 'string' ? row.unit : '',
      unit_type: unitType,
    };
  });

  return rows.length > 0 ? rows : [newBuilderItem()];
}

function mapInventoryRow(row: unknown): QuickOrderConfigItem {
  const item = row as Partial<QuickOrderConfigItem>;
  return {
    id: item.id ?? '',
    name: item.name ?? '',
    category: item.category ?? 'dry',
    supplier_category: item.supplier_category ?? 'main_distributor',
    supplier_id: item.supplier_id ?? null,
    base_unit: item.base_unit ?? '',
    pack_unit: item.pack_unit ?? '',
    pack_size: item.pack_size ?? 1,
    active: item.active !== false,
    aliases: Array.isArray(item.aliases)
      ? item.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    created_at: item.created_at ?? '',
    created_by: item.created_by ?? null,
  };
}

export function QuickOrderConfigScreen() {
  const ds = useScaledStyles();
  const user = useAuthStore((state) => state.user);
  const [items, setItems] = useState<QuickOrderConfigItem[]>([]);
  const [examples, setExamples] = useState<ParserExampleRow[]>([]);
  const [corrections, setCorrections] = useState<ParserCorrectionRow[]>([]);
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTab>('aliases');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [rawText, setRawText] = useState('');
  const [builderItems, setBuilderItems] = useState<ExampleBuilderItem[]>([newBuilderItem()]);
  const [editingExampleId, setEditingExampleId] = useState<string | null>(null);
  const [isExampleActive, setIsExampleActive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAlias, setIsSavingAlias] = useState(false);
  const [savingLearningKey, setSavingLearningKey] = useState<string | null>(null);
  const [isSavingExample, setIsSavingExample] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const itemsById = useMemo(() => {
    const map = new Map<string, QuickOrderConfigItem>();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    const matches = query
      ? items.filter((item) => {
          const aliases = item.aliases.join(' ').toLowerCase();
          return item.name.toLowerCase().includes(query) || aliases.includes(query);
        })
      : items;

    return matches.slice(0, 30);
  }, [itemSearch, items]);

  const learningGroups = useMemo(() => {
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

    return Array.from(grouped.values()).sort((a, b) => b.count - a.count || a.rawToken.localeCompare(b.rawToken));
  }, [corrections, itemsById]);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [itemsResult, examplesResult, correctionsResult] = await Promise.all([
        supabase
          .from('inventory_items')
          .select(INVENTORY_SELECT)
          .eq('active', true)
          .order('name', { ascending: true })
          .limit(1000),
        supabase
          .from('parser_examples')
          .select('id,raw_text,structured_output,source,is_active,created_at')
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('parser_corrections')
          .select('raw_token,user_corrected_item_id,created_at')
          .not('raw_token', 'is', null)
          .not('user_corrected_item_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1000),
      ]);

      if (itemsResult.error) throw itemsResult.error;
      if (examplesResult.error) throw examplesResult.error;
      if (correctionsResult.error) throw correctionsResult.error;

      const nextItems = (itemsResult.data ?? []).map(mapInventoryRow);
      setItems(nextItems);
      setExamples((examplesResult.data ?? []) as ParserExampleRow[]);
      setCorrections((correctionsResult.data ?? []) as ParserCorrectionRow[]);
      setSelectedItemId((current) => current ?? nextItems[0]?.id ?? null);
    } catch (error: any) {
      setErrorMessage(
        error?.message ??
          'Unable to load Quick Order configuration. Confirm the migration has been applied.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateBuilderItem = useCallback(
    (localId: string, updates: Partial<ExampleBuilderItem>) => {
      setBuilderItems((current) =>
        current.map((item) => (item.localId === localId ? { ...item, ...updates } : item)),
      );
    },
    [],
  );

  const appendAliasToItem = useCallback(
    async (itemId: string, aliasValue: string) => {
      const item = itemsById.get(itemId);
      const alias = normalizeAlias(aliasValue);
      if (!item || !alias) {
        throw new Error('Choose an item and alias before saving.');
      }

      const aliasExists = item.aliases.some(
        (existing) => normalizeAliasKey(existing) === normalizeAliasKey(alias),
      );

      if (aliasExists) {
        return { item, aliases: item.aliases, added: false };
      }

      const nextAliases = [...item.aliases, alias].sort((a, b) => a.localeCompare(b));
      const { error } = await supabase
        .from('inventory_items')
        .update({ aliases: nextAliases })
        .eq('id', item.id);

      if (error) throw error;

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, aliases: nextAliases } : entry,
        ),
      );

      return { item, aliases: nextAliases, added: true };
    },
    [itemsById],
  );

  const addAlias = useCallback(async () => {
    if (!selectedItem) return;

    const alias = normalizeAlias(aliasInput);
    if (!alias) {
      Alert.alert('Alias required', 'Enter an alias before adding it.');
      return;
    }

    try {
      setIsSavingAlias(true);
      const result = await appendAliasToItem(selectedItem.id, alias);
      if (!result.added) {
        Alert.alert('Alias already exists', `${selectedItem.name} already has that alias.`);
        return;
      }
      setAliasInput('');
    } catch (error: any) {
      Alert.alert('Alias update failed', error?.message ?? 'Unable to save alias.');
    } finally {
      setIsSavingAlias(false);
    }
  }, [aliasInput, appendAliasToItem, selectedItem]);

  const removeAlias = useCallback(
    async (alias: string) => {
      if (!selectedItem) return;

      const nextAliases = selectedItem.aliases.filter((entry) => entry !== alias);

      try {
        setIsSavingAlias(true);
        const { error } = await supabase
          .from('inventory_items')
          .update({ aliases: nextAliases })
          .eq('id', selectedItem.id);

        if (error) throw error;

        setItems((current) =>
          current.map((item) =>
            item.id === selectedItem.id ? { ...item, aliases: nextAliases } : item,
          ),
        );
      } catch (error: any) {
        Alert.alert('Alias update failed', error?.message ?? 'Unable to remove alias.');
      } finally {
        setIsSavingAlias(false);
      }
    },
    [selectedItem],
  );

  const addLearningAlias = useCallback(
    async (group: LearningGroup) => {
      try {
        setSavingLearningKey(group.key);
        const result = await appendAliasToItem(group.correctedItemId, group.rawToken);
        if (!result.added) {
          Alert.alert('Alias already exists', `${group.correctedItemName} already has "${group.rawToken}".`);
        }
      } catch (error: any) {
        Alert.alert('Alias update failed', error?.message ?? 'Unable to add learning alias.');
      } finally {
        setSavingLearningKey(null);
      }
    },
    [appendAliasToItem],
  );

  const resetExampleForm = useCallback(() => {
    setEditingExampleId(null);
    setRawText('');
    setBuilderItems([newBuilderItem()]);
    setIsExampleActive(true);
  }, []);

  const saveExample = useCallback(async () => {
    const normalizedRawText = rawText.trim();
    if (!normalizedRawText) {
      Alert.alert('Raw text required', 'Enter the text the employee might type.');
      return;
    }

    const completeRows = builderItems.filter(
      (item) => item.item_id && item.item_name && Number(item.quantity) > 0,
    );

    if (completeRows.length === 0) {
      Alert.alert('Expected output required', 'Add at least one mapped item with quantity.');
      return;
    }

    const structuredOutput = completeRows.map((item) => ({
      item_id: item.item_id,
      item_name: item.item_name,
      quantity: Number(item.quantity),
      unit: item.unit.trim(),
      unit_type: item.unit_type,
      confidence: 1,
    }));

    try {
      setIsSavingExample(true);

      if (editingExampleId) {
        const { error } = await supabase
          .from('parser_examples')
          .update({
            raw_text: normalizedRawText,
            structured_output: structuredOutput,
            is_active: isExampleActive,
          })
          .eq('id', editingExampleId);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('parser_examples').insert({
          raw_text: normalizedRawText,
          structured_output: structuredOutput,
          source: 'manager',
          is_active: isExampleActive,
        });

        if (error) throw error;
      }

      resetExampleForm();
      await loadData();
    } catch (error: any) {
      Alert.alert('Example save failed', error?.message ?? 'Unable to save parser example.');
    } finally {
      setIsSavingExample(false);
    }
  }, [builderItems, editingExampleId, isExampleActive, loadData, rawText, resetExampleForm]);

  const editExample = useCallback((example: ParserExampleRow) => {
    setEditingExampleId(example.id);
    setRawText(example.raw_text);
    setBuilderItems(parseStructuredOutput(example.structured_output));
    setIsExampleActive(example.is_active);
  }, []);

  const deleteExample = useCallback((example: ParserExampleRow) => {
    Alert.alert('Delete example', `Delete "${example.raw_text}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('parser_examples')
              .delete()
              .eq('id', example.id);

            if (error) throw error;

            if (editingExampleId === example.id) {
              resetExampleForm();
            }
            await loadData();
          } catch (error: any) {
            Alert.alert('Delete failed', error?.message ?? 'Unable to delete parser example.');
          }
        },
      },
    ]);
  }, [editingExampleId, loadData, resetExampleForm]);

  const renderBuilderItem = (builderItem: ExampleBuilderItem, index: number) => {
    const builderSearch = builderItem.itemSearch.trim().toLowerCase();
    const builderMatches = builderSearch
      ? items
          .filter((item) => {
            const aliases = item.aliases.join(' ').toLowerCase();
            return item.name.toLowerCase().includes(builderSearch) || aliases.includes(builderSearch);
          })
          .slice(0, 6)
      : [];

    return (
      <View
        key={builderItem.localId}
        style={{
          marginTop: ds.spacing(12),
          paddingTop: ds.spacing(12),
          borderTopWidth: index === 0 ? 0 : 1,
          borderTopColor: glassColors.cardBorder,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text
            style={{
              flex: 1,
              fontSize: ds.fontSize(13),
              fontWeight: '800',
              color: glassColors.textPrimary,
            }}
          >
            Output item {index + 1}
          </Text>
          {builderItems.length > 1 ? (
            <TouchableOpacity
              onPress={() =>
                setBuilderItems((current) =>
                  current.filter((item) => item.localId !== builderItem.localId),
                )
              }
              style={{ padding: ds.spacing(6) }}
            >
              <Ionicons name="trash-outline" size={ds.icon(18)} color={colors.statusRed} />
            </TouchableOpacity>
          ) : null}
        </View>

        <TextInput
          value={builderItem.itemSearch}
          onChangeText={(value) =>
            updateBuilderItem(builderItem.localId, {
              itemSearch: value,
              item_id: value === builderItem.item_name ? builderItem.item_id : null,
            })
          }
          placeholder="Search inventory item"
          placeholderTextColor={glassColors.textMuted}
          style={{
            marginTop: ds.spacing(8),
            minHeight: 46,
            borderRadius: glassRadii.search,
            borderWidth: 1,
            borderColor: glassColors.cardBorder,
            paddingHorizontal: ds.spacing(12),
            color: glassColors.textPrimary,
            fontSize: ds.fontSize(15),
            backgroundColor: colors.white,
          }}
        />

        {builderMatches.length > 0 ? (
          <View style={{ marginTop: ds.spacing(8), gap: ds.spacing(6) }}>
            {builderMatches.map((item) => (
              <Pressable
                key={item.id}
                onPress={() =>
                  updateBuilderItem(builderItem.localId, {
                    item_id: item.id,
                    item_name: item.name,
                    itemSearch: item.name,
                    unit: item.base_unit || item.pack_unit || builderItem.unit,
                    unit_type: item.base_unit ? 'base' : 'pack',
                  })
                }
                style={({ pressed }) => ({
                  paddingHorizontal: ds.spacing(10),
                  paddingVertical: ds.spacing(9),
                  borderRadius: 8,
                  backgroundColor: pressed ? colors.primaryPale : colors.glassCircle,
                })}
              >
                <Text style={{ color: glassColors.textPrimary, fontSize: ds.fontSize(14), fontWeight: '700' }}>
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(10) }}>
          <TextInput
            value={builderItem.quantity}
            onChangeText={(value) =>
              updateBuilderItem(builderItem.localId, { quantity: value.replace(/[^0-9.]/g, '') })
            }
            keyboardType="decimal-pad"
            placeholder="Qty"
            placeholderTextColor={glassColors.textMuted}
            style={{
              flex: 0.5,
              minHeight: 46,
              borderRadius: glassRadii.search,
              borderWidth: 1,
              borderColor: glassColors.cardBorder,
              paddingHorizontal: ds.spacing(12),
              color: glassColors.textPrimary,
              fontSize: ds.fontSize(15),
              backgroundColor: colors.white,
            }}
          />
          <TextInput
            value={builderItem.unit}
            onChangeText={(value) => updateBuilderItem(builderItem.localId, { unit: value })}
            placeholder="Unit"
            placeholderTextColor={glassColors.textMuted}
            style={{
              flex: 1,
              minHeight: 46,
              borderRadius: glassRadii.search,
              borderWidth: 1,
              borderColor: glassColors.cardBorder,
              paddingHorizontal: ds.spacing(12),
              color: glassColors.textPrimary,
              fontSize: ds.fontSize(15),
              backgroundColor: colors.white,
            }}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(10) }}>
          {(['base', 'pack'] as UnitType[]).map((unitType) => (
            <Pressable
              key={unitType}
              onPress={() => updateBuilderItem(builderItem.localId, { unit_type: unitType })}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: glassRadii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  builderItem.unit_type === unitType ? colors.primary : colors.glassCircle,
              }}
            >
              <Text
                style={{
                  color:
                    builderItem.unit_type === unitType ? colors.textOnPrimary : glassColors.textPrimary,
                  fontWeight: '800',
                  fontSize: ds.fontSize(13),
                }}
              >
                {unitType === 'base' ? 'Base unit' : 'Pack unit'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  if (user?.role !== 'manager') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }}>
        <StackScreenHeader title="Quick Order AI" subtitle="Manager access required" />
        <View style={{ padding: glassSpacing.screen }}>
          <Text style={{ color: glassColors.textSecondary }}>
            Only managers can configure Quick Order parsing.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <StackScreenHeader
          title="Quick Order AI"
          subtitle="Aliases, examples, and weekly learning"
          onBackPress={() => router.replace('/(manager)/profile')}
        />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingBottom: glassTabBarHeight + ds.spacing(32),
          }}
        >
          {errorMessage ? (
            <GlassSurface
              intensity="subtle"
              blurred={false}
              style={{
                borderRadius: glassRadii.surface,
                padding: ds.spacing(14),
                marginBottom: ds.spacing(14),
                backgroundColor: colors.statusRedBg,
              }}
            >
              <Text style={{ color: colors.statusRed, fontSize: ds.fontSize(13), fontWeight: '700' }}>
                {errorMessage}
              </Text>
            </GlassSurface>
          ) : null}

          <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginBottom: ds.spacing(14) }}>
            {(['aliases', 'examples', 'learning'] as ConfigTab[]).map((tab) => {
              const isActive = activeConfigTab === tab;
              const label = tab === 'aliases' ? 'Aliases' : tab === 'examples' ? 'Examples' : 'Weekly Learning';
              return (
                <Pressable
                  key={tab}
                  onPress={() => setActiveConfigTab(tab)}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    borderRadius: glassRadii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isActive ? colors.primary : colors.glassCircle,
                    paddingHorizontal: ds.spacing(8),
                  }}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{
                      color: isActive ? colors.textOnPrimary : glassColors.textPrimary,
                      fontSize: ds.fontSize(13),
                      fontWeight: '800',
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {isLoading ? (
            <View style={{ paddingVertical: ds.spacing(40), alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <>
              {activeConfigTab === 'aliases' ? (
                <>
                  <SettingsSectionLabel label="Aliases Manager" />
                  <GlassSurface
                    intensity="subtle"
                    blurred={false}
                    style={{ borderRadius: glassRadii.surface, padding: ds.spacing(14), marginBottom: ds.spacing(20) }}
                  >
                <TextInput
                  value={itemSearch}
                  onChangeText={setItemSearch}
                  placeholder="Search inventory by name or alias"
                  placeholderTextColor={glassColors.textMuted}
                  style={{
                    minHeight: 48,
                    borderRadius: glassRadii.search,
                    borderWidth: 1,
                    borderColor: glassColors.cardBorder,
                    paddingHorizontal: ds.spacing(12),
                    color: glassColors.textPrimary,
                    fontSize: ds.fontSize(15),
                    backgroundColor: colors.white,
                  }}
                />

                <View style={{ marginTop: ds.spacing(12), maxHeight: ds.spacing(260), gap: ds.spacing(6) }}>
                  {filteredItems.map((item) => {
                    const isSelected = item.id === selectedItemId;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setSelectedItemId(item.id)}
                        style={{
                          minHeight: 44,
                          borderRadius: 8,
                          paddingHorizontal: ds.spacing(10),
                          paddingVertical: ds.spacing(8),
                          backgroundColor: isSelected ? colors.primaryPale : colors.glassCircle,
                          borderWidth: isSelected ? 1 : 0,
                          borderColor: colors.primary,
                        }}
                      >
                        <Text style={{ color: glassColors.textPrimary, fontSize: ds.fontSize(14), fontWeight: '800' }}>
                          {item.name}
                        </Text>
                        {item.aliases.length > 0 ? (
                          <Text
                            numberOfLines={1}
                            style={{ marginTop: 2, color: glassColors.textSecondary, fontSize: ds.fontSize(12) }}
                          >
                            {item.aliases.join(', ')}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>

                {selectedItem ? (
                  <View style={{ marginTop: ds.spacing(16) }}>
                    <Text style={{ color: glassColors.textPrimary, fontSize: ds.fontSize(16), fontWeight: '800' }}>
                      {selectedItem.name}
                    </Text>

                    <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(10) }}>
                      <TextInput
                        value={aliasInput}
                        onChangeText={setAliasInput}
                        placeholder="Add alias, e.g. sake"
                        placeholderTextColor={glassColors.textMuted}
                        autoCapitalize="none"
                        style={{
                          flex: 1,
                          minHeight: 46,
                          borderRadius: glassRadii.search,
                          borderWidth: 1,
                          borderColor: glassColors.cardBorder,
                          paddingHorizontal: ds.spacing(12),
                          color: glassColors.textPrimary,
                          fontSize: ds.fontSize(15),
                          backgroundColor: colors.white,
                        }}
                      />
                      <TouchableOpacity
                        onPress={addAlias}
                        disabled={isSavingAlias}
                        activeOpacity={0.82}
                        style={{
                          width: Math.max(48, ds.buttonH),
                          minHeight: 46,
                          borderRadius: glassRadii.pill,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.primary,
                          opacity: isSavingAlias ? 0.6 : 1,
                        }}
                      >
                        <Ionicons name="add" size={ds.icon(22)} color={colors.textOnPrimary} />
                      </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(8), marginTop: ds.spacing(12) }}>
                      {selectedItem.aliases.length > 0 ? (
                        selectedItem.aliases.map((alias) => (
                          <Pressable
                            key={alias}
                            onPress={() => void removeAlias(alias)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              borderRadius: glassRadii.pill,
                              backgroundColor: uiTints.accent.background,
                              paddingHorizontal: ds.spacing(10),
                              paddingVertical: ds.spacing(7),
                            }}
                          >
                            <Text style={{ color: glassColors.textPrimary, fontWeight: '700', fontSize: ds.fontSize(13) }}>
                              {alias}
                            </Text>
                            <Ionicons
                              name="close"
                              size={ds.icon(14)}
                              color={glassColors.textSecondary}
                              style={{ marginLeft: ds.spacing(4) }}
                            />
                          </Pressable>
                        ))
                      ) : (
                        <Text style={{ color: glassColors.textSecondary, fontSize: ds.fontSize(13) }}>
                          No aliases yet.
                        </Text>
                      )}
                    </View>
                  </View>
                ) : null}
                  </GlassSurface>
                </>
              ) : null}

              {activeConfigTab === 'examples' ? (
                <>
                  <SettingsSectionLabel label="Examples Manager" />
                  <GlassSurface
                    intensity="subtle"
                    blurred={false}
                    style={{ borderRadius: glassRadii.surface, padding: ds.spacing(14), marginBottom: ds.spacing(14) }}
                  >
                <TextInput
                  value={rawText}
                  onChangeText={setRawText}
                  placeholder='Raw text, e.g. "salmon 2"'
                  placeholderTextColor={glassColors.textMuted}
                  style={{
                    minHeight: 48,
                    borderRadius: glassRadii.search,
                    borderWidth: 1,
                    borderColor: glassColors.cardBorder,
                    paddingHorizontal: ds.spacing(12),
                    color: glassColors.textPrimary,
                    fontSize: ds.fontSize(15),
                    backgroundColor: colors.white,
                  }}
                />

                {builderItems.map(renderBuilderItem)}

                <TouchableOpacity
                  onPress={() => setBuilderItems((current) => [...current, newBuilderItem()])}
                  activeOpacity={0.82}
                  style={{
                    marginTop: ds.spacing(12),
                    minHeight: 42,
                    borderRadius: glassRadii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.glassCircle,
                  }}
                >
                  <Text style={{ color: glassColors.textPrimary, fontWeight: '800', fontSize: ds.fontSize(14) }}>
                    Add output item
                  </Text>
                </TouchableOpacity>

                <Pressable
                  onPress={() => setIsExampleActive((value) => !value)}
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: ds.spacing(14) }}
                >
                  <Ionicons
                    name={isExampleActive ? 'checkbox' : 'square-outline'}
                    size={ds.icon(22)}
                    color={isExampleActive ? colors.primary : glassColors.textSecondary}
                  />
                  <Text style={{ marginLeft: ds.spacing(8), color: glassColors.textPrimary, fontWeight: '700' }}>
                    Active example
                  </Text>
                </Pressable>

                <View style={{ flexDirection: 'row', gap: ds.spacing(10), marginTop: ds.spacing(16) }}>
                  {editingExampleId ? (
                    <TouchableOpacity
                      onPress={resetExampleForm}
                      activeOpacity={0.82}
                      style={{
                        flex: 1,
                        minHeight: 48,
                        borderRadius: glassRadii.pill,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.glassCircle,
                      }}
                    >
                      <Text style={{ color: glassColors.textPrimary, fontWeight: '800' }}>Cancel</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={saveExample}
                    disabled={isSavingExample}
                    activeOpacity={0.82}
                    style={{
                      flex: 2,
                      minHeight: 48,
                      borderRadius: glassRadii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.primary,
                      opacity: isSavingExample ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ color: colors.textOnPrimary, fontWeight: '800' }}>
                      {editingExampleId ? 'Update example' : 'Create example'}
                    </Text>
                  </TouchableOpacity>
                </View>
                  </GlassSurface>

                  <GlassSurface
                    intensity="subtle"
                    blurred={false}
                    style={{ borderRadius: glassRadii.surface, padding: ds.spacing(14) }}
                  >
                {examples.length > 0 ? (
                  examples.map((example) => (
                    <View
                      key={example.id}
                      style={{
                        paddingVertical: ds.spacing(12),
                        borderBottomWidth: example === examples[examples.length - 1] ? 0 : 1,
                        borderBottomColor: glassColors.cardBorder,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: glassColors.textPrimary, fontSize: ds.fontSize(15), fontWeight: '800' }}>
                            {example.raw_text}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{ marginTop: ds.spacing(4), color: glassColors.textSecondary, fontSize: ds.fontSize(12) }}
                          >
                            {JSON.stringify(example.structured_output)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: ds.spacing(4), marginLeft: ds.spacing(8) }}>
                          <TouchableOpacity onPress={() => editExample(example)} style={{ padding: ds.spacing(6) }}>
                            <Ionicons name="create-outline" size={ds.icon(18)} color={colors.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => deleteExample(example)} style={{ padding: ds.spacing(6) }}>
                            <Ionicons name="trash-outline" size={ds.icon(18)} color={colors.statusRed} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <Text
                        style={{
                          marginTop: ds.spacing(6),
                          color: example.is_active ? colors.statusGreen : glassColors.textSecondary,
                          fontSize: ds.fontSize(12),
                          fontWeight: '800',
                        }}
                      >
                        {example.is_active ? 'Active' : 'Inactive'} · {example.source}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={{ color: glassColors.textSecondary, fontSize: ds.fontSize(13) }}>
                    No parser examples yet.
                  </Text>
                )}
                  </GlassSurface>
                </>
              ) : null}

              {activeConfigTab === 'learning' ? (
                <>
                  <SettingsSectionLabel label="Weekly Learning" />
                  <GlassSurface
                    intensity="subtle"
                    blurred={false}
                    style={{ borderRadius: glassRadii.surface, padding: ds.spacing(14) }}
                  >
                    {learningGroups.length > 0 ? (
                      learningGroups.map((group) => (
                        <View
                          key={group.key}
                          style={{
                            paddingVertical: ds.spacing(12),
                            borderBottomWidth: group === learningGroups[learningGroups.length - 1] ? 0 : 1,
                            borderBottomColor: glassColors.cardBorder,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ds.spacing(10) }}>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  color: glassColors.textPrimary,
                                  fontSize: ds.fontSize(15),
                                  fontWeight: '800',
                                }}
                              >
                                {group.rawToken} -&gt; {group.correctedItemName}
                              </Text>
                              <Text
                                style={{
                                  marginTop: ds.spacing(4),
                                  color: glassColors.textSecondary,
                                  fontSize: ds.fontSize(12),
                                  fontWeight: '700',
                                }}
                              >
                                Corrected {group.count} {group.count === 1 ? 'time' : 'times'}
                              </Text>
                            </View>

                            <TouchableOpacity
                              onPress={() => void addLearningAlias(group)}
                              disabled={group.alreadyAlias || savingLearningKey === group.key}
                              activeOpacity={0.82}
                              style={{
                                minHeight: 42,
                                borderRadius: glassRadii.pill,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: group.alreadyAlias ? colors.glassCircle : colors.primary,
                                paddingHorizontal: ds.spacing(12),
                                opacity: savingLearningKey === group.key ? 0.6 : 1,
                              }}
                            >
                              <Text
                                style={{
                                  color: group.alreadyAlias ? glassColors.textSecondary : colors.textOnPrimary,
                                  fontSize: ds.fontSize(13),
                                  fontWeight: '800',
                                }}
                              >
                                {group.alreadyAlias ? 'Added' : 'Add as Alias'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={{ color: glassColors.textSecondary, fontSize: ds.fontSize(13) }}>
                        No correction patterns yet.
                      </Text>
                    )}
                  </GlassSurface>
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
