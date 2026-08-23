// New employee defaults: the org-wide preset every new invite starts with.
// Applies to invites only — existing team members keep what they have.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { tipsTheme } from '@/theme/design';
import {
  getEmployeeInviteDefaults,
  setEmployeeInviteDefaults,
  type EmployeeInviteDefaults,
} from '@/services/employeeDefaults';
import { ModuleToggleRow, TeamCard } from './components/TeamUI';

const ROWS: { key: string; label: string }[] = [
  { key: 'ordering_simple', label: 'Ordering checklist' },
  { key: 'ordering_advanced', label: 'Advanced ordering' },
  { key: 'stock_check', label: 'Stock check' },
  { key: 'tips', label: 'Tips' },
];

export default function DefaultsScreen() {
  const ds = useScaledStyles();
  const [defaults, setDefaults] = useState<EmployeeInviteDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDefaults(await getEmployeeInviteDefaults());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the defaults.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleToggle = async (key: string, value: boolean) => {
    if (!defaults || saving) return;
    const previous = defaults;
    const next = { ...defaults, [key]: value };
    setDefaults(next);
    setSaving(true);
    try {
      await setEmployeeInviteDefaults(next);
    } catch (saveError) {
      setDefaults(previous);
      Alert.alert(
        'Update failed',
        saveError instanceof Error ? saveError.message : 'Try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tipsTheme.page }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View style={{ backgroundColor: tipsTheme.page }}>
          <StackScreenHeader
            title="New employee defaults"
            subtitle="Every new invite starts with these. You can still change any person later."
          />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: ds.spacing(20),
            paddingTop: ds.spacing(8),
            paddingBottom: ds.spacing(28),
          }}
        >
          {error ? (
            <View style={{ backgroundColor: tipsTheme.tint, borderRadius: 13, padding: ds.spacing(12) }}>
              <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.alert }}>{error}</Text>
              <TouchableOpacity onPress={() => void load()} style={{ marginTop: ds.spacing(6) }}>
                <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: tipsTheme.alert }}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          ) : defaults === null ? (
            <View style={{ paddingVertical: ds.spacing(30), alignItems: 'center' }}>
              <ActivityIndicator size="small" color={tipsTheme.accent} />
            </View>
          ) : (
            <>
              <TeamCard style={{ paddingHorizontal: ds.spacing(13), marginBottom: ds.spacing(9) }}>
                {ROWS.map((row, index) => (
                  <ModuleToggleRow
                    key={row.key}
                    label={row.label}
                    value={defaults[row.key] === true}
                    disabled={saving}
                    showBorder={index < ROWS.length - 1}
                    onChange={(value) => void handleToggle(row.key, value)}
                  />
                ))}
              </TeamCard>

              <View style={{ backgroundColor: tipsTheme.tint, borderRadius: 13, padding: ds.spacing(12) }}>
                <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink, lineHeight: 17 }}>
                  <Text style={{ fontWeight: '700' }}>Applies to invites only. </Text>
                  Current team members keep what they have.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
