import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { GlassSurface, StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParserExampleRow } from '@/types';
import {
  colors,
  glassColors,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';
import { AliasesTab } from './quickOrderConfig/AliasesTab';
import { ExamplesTab } from './quickOrderConfig/ExamplesTab';
import { WeeklyLearningTab } from './quickOrderConfig/WeeklyLearningTab';
import {
  type ConfigTab,
  type ParserCorrectionRow,
  type QuickOrderConfigItem,
  INVENTORY_SELECT,
  mapInventoryRow,
} from './quickOrderConfig/types';

const TAB_LABELS: Record<ConfigTab, string> = {
  aliases: 'Aliases',
  examples: 'Examples',
  learning: 'Weekly Learning',
};

const IGNORE_KEYS_STORAGE_KEY = 'quickOrderConfig.ignoredSuggestionKeys.v1';

async function loadIgnoreKeysFromStorage(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(IGNORE_KEYS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

async function persistIgnoreKeysToStorage(keys: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(IGNORE_KEYS_STORAGE_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    // best effort; ignore failures
  }
}

export function QuickOrderConfigScreen() {
  const ds = useScaledStyles();
  const user = useAuthStore((state) => state.user);

  const [items, setItems] = useState<QuickOrderConfigItem[]>([]);
  const [examples, setExamples] = useState<ParserExampleRow[]>([]);
  const [corrections, setCorrections] = useState<ParserCorrectionRow[]>([]);
  const [ignoreKeys, setIgnoreKeys] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<ConfigTab>('aliases');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [itemsResult, examplesResult, correctionsResult, storedIgnores] = await Promise.all([
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
        loadIgnoreKeysFromStorage(),
      ]);

      if (itemsResult.error) throw itemsResult.error;
      if (examplesResult.error) throw examplesResult.error;
      if (correctionsResult.error) throw correctionsResult.error;

      setItems((itemsResult.data ?? []).map(mapInventoryRow));
      setExamples((examplesResult.data ?? []) as ParserExampleRow[]);
      setCorrections((correctionsResult.data ?? []) as ParserCorrectionRow[]);
      setIgnoreKeys(storedIgnores);
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

  const refreshExamples = useCallback(async () => {
    const { data, error } = await supabase
      .from('parser_examples')
      .select('id,raw_text,structured_output,source,is_active,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error) setExamples((data ?? []) as ParserExampleRow[]);
  }, []);

  const updateIgnoreKeys = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (update) => {
      setIgnoreKeys((current) => {
        const next = typeof update === 'function' ? (update as (prev: Set<string>) => Set<string>)(current) : update;
        void persistIgnoreKeysToStorage(next);
        return next;
      });
    },
    [],
  );

  if (user?.role !== 'manager') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }}>
        <StackScreenHeader title="Quick Order" subtitle="Manager access required" />
        <View style={{ padding: glassSpacing.screen }}>
          <Text style={{ color: glassColors.textSecondary }}>
            Only managers can configure Quick Order parsing.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ManagerScaleContainer>
        <StackScreenHeader
          title="Quick Order"
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
              <Text
                style={{
                  color: colors.statusRed,
                  fontSize: ds.fontSize(13),
                  fontWeight: '700',
                }}
              >
                {errorMessage}
              </Text>
            </GlassSurface>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              gap: ds.spacing(8),
              marginBottom: ds.spacing(18),
            }}
          >
            {(['aliases', 'examples', 'learning'] as ConfigTab[]).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={TAB_LABELS[tab]}
                  onPress={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: glassRadii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: ds.spacing(8),
                    backgroundColor: isActive ? colors.primary : colors.white,
                    borderWidth: isActive ? 0 : 1,
                    borderColor: glassColors.cardBorder,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{
                      color: isActive ? colors.textOnPrimary : glassColors.textPrimary,
                      fontSize: ds.fontSize(14),
                      fontWeight: '700',
                    }}
                  >
                    {TAB_LABELS[tab]}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {isLoading ? (
            <View style={{ paddingVertical: ds.spacing(60), alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : activeTab === 'aliases' ? (
            <AliasesTab items={items} setItems={setItems} />
          ) : activeTab === 'examples' ? (
            <ExamplesTab examples={examples} items={items} onRefresh={refreshExamples} />
          ) : (
            <WeeklyLearningTab
              items={items}
              corrections={corrections}
              ignoreKeys={ignoreKeys}
              setItems={setItems}
              setIgnoreKeys={updateIgnoreKeys}
            />
          )}
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
