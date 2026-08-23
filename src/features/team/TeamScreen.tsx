// Manager Team list: live roster with a per-person feature summary and the
// "New employee defaults" entry pinned at the bottom.

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useAuthStore } from '@/store';
import { radii, tipsTheme } from '@/theme/design';
import { listManagedUsers, type ManagedUser } from '@/services/userManagement';
import { getModulesForUser } from '@/services/userModules';
import {
  resolveEffectiveModules,
  type EffectiveModules,
} from '@/store/moduleStore.helpers';
import {
  getEmployeeInviteDefaults,
  type EmployeeInviteDefaults,
} from '@/services/employeeDefaults';
import { LOCATION_GROUP_LABELS } from './invitePreview';
import {
  fetchDefaultLocationIds,
  groupForLocationId,
  summarizeModules,
} from './teamService';
import { TeamRow } from './components/TeamUI';

interface RosterEntry {
  user: ManagedUser;
  modules: EffectiveModules | null;
  locationId: string | null;
}

export default function TeamScreen() {
  const ds = useScaledStyles();
  const { locations } = useAuthStore(useShallow((state) => ({ locations: state.locations })));

  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [defaults, setDefaults] = useState<EmployeeInviteDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [users, locationIds, inviteDefaults] = await Promise.all([
        listManagedUsers(),
        fetchDefaultLocationIds(),
        getEmployeeInviteDefaults().catch(() => null),
      ]);
      setDefaults(inviteDefaults);

      const entries: RosterEntry[] = await Promise.all(
        users.map(async (user) => {
          const modules = await getModulesForUser(user.id)
            .then((states) => resolveEffectiveModules(user.role, states))
            .catch(() => resolveEffectiveModules(user.role, null));
          return { user, modules, locationId: locationIds.get(user.id) ?? null };
        }),
      );
      setRoster(entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the team.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const defaultsSummary = defaults
    ? summarizeModules({ ...defaults, fulfillment: false } as EffectiveModules)
    : 'Loading…';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tipsTheme.page }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View style={{ backgroundColor: tipsTheme.page }}>
          <StackScreenHeader
            title="Team"
            subtitle="Invites, features, and sign-in resets"
            right={
              <TouchableOpacity
                onPress={() =>
                  router.push(
                    '/(manager)/manager-settings/team-invite' as Parameters<typeof router.push>[0],
                  )
                }
                activeOpacity={0.82}
                style={{
                  backgroundColor: tipsTheme.accent,
                  borderRadius: radii.pill,
                  paddingHorizontal: ds.spacing(14),
                  minHeight: Math.max(36, ds.buttonH - ds.spacing(14)),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: '#FFFFFF' }}>
                  + Invite
                </Text>
              </TouchableOpacity>
            }
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
            <View
              style={{
                backgroundColor: tipsTheme.tint,
                borderRadius: 13,
                padding: ds.spacing(12),
                marginBottom: ds.spacing(10),
              }}
            >
              <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.alert }}>{error}</Text>
              <TouchableOpacity onPress={() => void load()} style={{ marginTop: ds.spacing(6) }}>
                <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: tipsTheme.alert }}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {roster === null && !error ? (
            <View style={{ paddingVertical: ds.spacing(30), alignItems: 'center' }}>
              <ActivityIndicator size="small" color={tipsTheme.accent} />
            </View>
          ) : null}

          {(roster ?? []).map(({ user, modules, locationId }) => {
            const group = groupForLocationId(locationId, locations);
            const summary = user.is_suspended
              ? 'Suspended'
              : `${LOCATION_GROUP_LABELS[group]} · ${summarizeModules(modules)}`;
            return (
              <TeamRow
                key={user.id}
                initial={(user.full_name ?? user.email ?? '?').trim().charAt(0).toUpperCase() || '?'}
                title={user.full_name ?? user.email ?? 'Unnamed'}
                subtitle={summary}
                onPress={() =>
                  router.push({
                    pathname: '/(manager)/manager-settings/team-member',
                    params: { userId: user.id },
                  } as Parameters<typeof router.push>[0])
                }
              />
            );
          })}

          {roster !== null ? (
            <TeamRow
              icon="options-outline"
              initial=""
              muted
              title="New employee defaults"
              subtitle={defaultsSummary === 'Nothing enabled' ? 'Everything off' : defaultsSummary}
              onPress={() =>
                router.push(
                  '/(manager)/manager-settings/team-defaults' as Parameters<typeof router.push>[0],
                )
              }
            />
          ) : null}
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
