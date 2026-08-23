// Preview as <Name>: renders the employee tab/module state for the target
// user, driven by their live get_effective_modules result through the SAME
// getVisibleEmployeeTabs logic the employee layout uses — a live render that
// cannot drift. Strictly read-only: this screen never writes anything.

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { getModulesForUser } from '@/services/userModules';
import {
  getVisibleEmployeeTabs,
  resolveEffectiveModules,
  type EffectiveModules,
} from '@/store/moduleStore.helpers';
import type { InviteLocationGroup } from '@/services/invites';
import { EMPLOYEE_TAB_META, LOCATION_GROUP_LABELS } from './invitePreview';

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

const TAB_DESCRIPTIONS: Record<string, string> = {
  index: 'Home — quick actions and store insights',
  'simple-order': 'Order — the daily checklist with usual amounts',
  'quick-order': 'Advanced — free-form ordering with the parser',
  cart: 'Cart — items staged before sending',
  settings: 'Settings — profile, reminders, and sign out',
};

export default function PreviewAsScreen() {
  const ds = useScaledStyles();
  const params = useLocalSearchParams<{
    userId?: string | string[];
    name?: string | string[];
    group?: string | string[];
  }>();
  const userId = param(params.userId);
  const name = param(params.name) || 'this person';
  const firstName = name.split(' ')[0];
  const groupParam = param(params.group);
  const group: InviteLocationGroup =
    groupParam === 'sushi' || groupParam === 'poki' || groupParam === 'both' ? groupParam : 'both';

  const [modules, setModules] = useState<EffectiveModules | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const states = await getModulesForUser(userId);
      setModules(resolveEffectiveModules('employee', states));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load their settings.');
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const tabKeys = modules ? getVisibleEmployeeTabs(modules) : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tipsTheme.ink }} edges={['top', 'left', 'right']}>
      {/* Dark exit bar — the only chrome that is not part of the preview. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: ds.spacing(8),
          paddingHorizontal: ds.spacing(15),
          paddingVertical: ds.spacing(11),
          backgroundColor: tipsTheme.ink,
        }}
      >
        <Ionicons name="eye-outline" size={ds.icon(16)} color="#FFFFFF" />
        <Text style={{ flex: 1, fontSize: ds.fontSize(12), fontWeight: '700', color: '#FFFFFF' }}>
          Viewing as {firstName} · {LOCATION_GROUP_LABELS[group]}
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.82}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: radii.pill,
            paddingHorizontal: ds.spacing(12),
            paddingVertical: ds.spacing(4),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(11), fontWeight: '700', color: '#FFFFFF' }}>Exit</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, backgroundColor: tipsTheme.page }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: ds.spacing(20), paddingBottom: ds.spacing(12) }}
        >
          <Text style={{ fontSize: ds.fontSize(19), fontWeight: '700', color: tipsTheme.ink }}>
            {`What ${firstName} sees`}
          </Text>
          <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}>
            Live from their current settings. Nothing here changes their data.
          </Text>

          {error ? (
            <View style={{ backgroundColor: tipsTheme.tint, borderRadius: 13, padding: ds.spacing(12) }}>
              <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.alert }}>{error}</Text>
              <TouchableOpacity onPress={() => void load()} style={{ marginTop: ds.spacing(6) }}>
                <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: tipsTheme.alert }}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          ) : modules === null ? (
            <View style={{ paddingVertical: ds.spacing(30), alignItems: 'center' }}>
              <ActivityIndicator size="small" color={tipsTheme.accent} />
            </View>
          ) : (
            <>
              {tabKeys.map((key) => (
                <View
                  key={key}
                  style={{
                    backgroundColor: tipsTheme.card,
                    borderWidth: glassHairlineWidth,
                    borderColor: tipsTheme.hairline,
                    borderRadius: 17,
                    paddingHorizontal: ds.spacing(13),
                    paddingVertical: ds.spacing(11),
                    marginBottom: ds.spacing(8),
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: ds.spacing(10),
                  }}
                >
                  <Ionicons
                    name={(EMPLOYEE_TAB_META[key]?.icon ?? 'ellipse-outline') as keyof typeof Ionicons.glyphMap}
                    size={ds.icon(18)}
                    color={tipsTheme.accent}
                  />
                  <Text style={{ flex: 1, fontSize: ds.fontSize(12.5), color: tipsTheme.ink }}>
                    {TAB_DESCRIPTIONS[key] ?? EMPLOYEE_TAB_META[key]?.label ?? key}
                  </Text>
                </View>
              ))}

              {modules.stock_check ? (
                <View style={{ backgroundColor: tipsTheme.well, borderRadius: 13, padding: ds.spacing(11) }}>
                  <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink2 }}>
                    Stock check is on — it opens from inside the app, not as a tab.
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* The real tab bar, rendered from the same visible-tab list. */}
        {modules !== null ? (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-around',
              borderTopWidth: glassHairlineWidth,
              borderTopColor: tipsTheme.hairline,
              backgroundColor: tipsTheme.card,
              paddingTop: ds.spacing(8),
              paddingBottom: ds.spacing(18),
            }}
          >
            {tabKeys.map((key, index) => {
              const meta = EMPLOYEE_TAB_META[key];
              const active = index === 0;
              return (
                <View key={key} style={{ alignItems: 'center', gap: 2 }}>
                  <Ionicons
                    name={(meta?.icon ?? 'ellipse-outline') as keyof typeof Ionicons.glyphMap}
                    size={ds.icon(19)}
                    color={active ? tipsTheme.accent : tipsTheme.ink3}
                  />
                  <Text
                    style={{
                      fontSize: ds.fontSize(9.5),
                      fontWeight: active ? '700' : '500',
                      color: active ? tipsTheme.accent : tipsTheme.ink3,
                    }}
                  >
                    {meta?.label ?? key}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
