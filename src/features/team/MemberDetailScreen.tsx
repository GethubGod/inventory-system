// Employee detail: works-at (changeable anytime), feature toggles, Reset PIN,
// and Preview as <Name>. Toggles write user_modules live; works-at goes
// through the manager-gated set_user_default_location RPC.

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useAuthStore } from '@/store';
import { triggerNotificationHaptic, NotificationFeedbackType } from '@/lib/haptics';
import { colors, glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { listManagedUsers, type ManagedUser } from '@/services/userManagement';
import { getModulesForUser, setUserModule, type ModuleKey } from '@/services/userModules';
import {
  getManageableModuleKeys,
  resolveEffectiveModules,
  type EffectiveModules,
} from '@/store/moduleStore.helpers';
import { isValidPin, resetUserCredential } from '@/services/loginCredentials';
import type { InviteLocationGroup } from '@/services/invites';
import {
  fetchDefaultLocationIds,
  fetchLoginCredentialInfo,
  groupForLocationId,
  locationIdForGroup,
  setUserDefaultLocation,
  type LoginCredentialInfo,
} from './teamService';
import { ModuleToggleRow, TeamCard, TeamSectionLabel, WorksAtSegmented } from './components/TeamUI';

/** Screen-local labels per the flow spec. */
const DETAIL_MODULE_LABELS: Partial<Record<ModuleKey, string>> = {
  ordering_simple: 'Ordering checklist',
  ordering_advanced: 'Advanced ordering',
  stock_check: 'Stock check',
  tips: 'Tips',
  fulfillment: 'Fulfillment',
};

export default function MemberDetailScreen() {
  const ds = useScaledStyles();
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const userId = (Array.isArray(params.userId) ? params.userId[0] : params.userId) ?? '';
  const { locations } = useAuthStore(useShallow((state) => ({ locations: state.locations })));

  const [user, setUser] = useState<ManagedUser | null>(null);
  const [modules, setModules] = useState<EffectiveModules | null>(null);
  const [group, setGroup] = useState<InviteLocationGroup>('both');
  const [credential, setCredential] = useState<LoginCredentialInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<ModuleKey | null>(null);
  const [groupSaving, setGroupSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [resetVisible, setResetVisible] = useState(false);
  const [resetPin, setResetPin] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 2200);
  };

  const load = useCallback(async () => {
    if (!userId) return;
    setLoadError(null);
    try {
      const [users, locationIds, credentialInfo] = await Promise.all([
        listManagedUsers(),
        fetchDefaultLocationIds(),
        fetchLoginCredentialInfo(userId).catch(() => null),
      ]);
      const found = users.find((candidate) => candidate.id === userId) ?? null;
      if (!found) {
        setLoadError('This person is no longer on the roster.');
        return;
      }
      setUser(found);
      setCredential(credentialInfo);
      setGroup(groupForLocationId(locationIds.get(userId) ?? null, locations));
      const states = await getModulesForUser(userId).catch(() => null);
      setModules(resolveEffectiveModules(found.role, states));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load this person.');
    }
  }, [userId, locations]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleGroupChange = async (nextGroup: InviteLocationGroup) => {
    if (!user || groupSaving || nextGroup === group) return;
    const previous = group;
    setGroup(nextGroup);
    setGroupSaving(true);
    try {
      await setUserDefaultLocation(user.id, locationIdForGroup(nextGroup, locations));
      showNotice('Works-at updated.');
    } catch (error) {
      setGroup(previous);
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setGroupSaving(false);
    }
  };

  const handleModuleChange = async (key: ModuleKey, enabled: boolean) => {
    if (!user || !modules || pendingKey) return;
    const previous = modules;
    setModules({ ...modules, [key]: enabled });
    setPendingKey(key);
    try {
      await setUserModule(user.id, key, enabled);
      showNotice(`${DETAIL_MODULE_LABELS[key] ?? key} ${enabled ? 'on' : 'off'}.`);
    } catch (error) {
      setModules(previous);
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setPendingKey(null);
    }
  };

  const handleResetSubmit = () => {
    if (!user) return;
    if (!isValidPin(resetPin)) {
      setResetError('PIN must be exactly 4 digits');
      return;
    }
    Alert.alert(
      `Reset ${user.full_name ?? 'this'} PIN?`,
      `They sign in with ${resetPin} from now on.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setResetBusy(true);
              setResetError(null);
              try {
                await resetUserCredential(user.id, resetPin);
                triggerNotificationHaptic(NotificationFeedbackType.Success);
                setResetVisible(false);
                setResetPin('');
                setCredential({ kind: 'pin', updatedAt: new Date().toISOString() });
                showNotice('PIN reset.');
              } catch (error) {
                setResetError(error instanceof Error ? error.message : 'Unable to reset the PIN.');
              } finally {
                setResetBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const displayName = user?.full_name ?? 'Team member';
  const manageableKeys = user ? getManageableModuleKeys(user.role) : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tipsTheme.page }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View style={{ backgroundColor: tipsTheme.page }}>
          <StackScreenHeader
            title={displayName}
            subtitle={
              user?.is_suspended
                ? 'Suspended'
                : credential
                  ? `Signs in with a ${credential.kind === 'pin' ? 'PIN' : 'password'}`
                  : 'No app sign-in set up yet'
            }
          />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: ds.spacing(20),
            paddingBottom: ds.spacing(28),
          }}
        >
          {loadError ? (
            <View
              style={{
                backgroundColor: tipsTheme.tint,
                borderRadius: 13,
                padding: ds.spacing(12),
                marginTop: ds.spacing(8),
              }}
            >
              <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.alert }}>{loadError}</Text>
              <TouchableOpacity onPress={() => void load()} style={{ marginTop: ds.spacing(6) }}>
                <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: tipsTheme.alert }}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!user && !loadError ? (
            <View style={{ paddingVertical: ds.spacing(30), alignItems: 'center' }}>
              <ActivityIndicator size="small" color={tipsTheme.accent} />
            </View>
          ) : null}

          {user ? (
            <>
              {notice ? (
                <View
                  style={{
                    backgroundColor: tipsTheme.tint,
                    borderRadius: 13,
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(8),
                    marginTop: ds.spacing(8),
                  }}
                >
                  <Text style={{ fontSize: ds.fontSize(12), fontWeight: '600', color: tipsTheme.ink }}>
                    {notice}
                  </Text>
                </View>
              ) : null}

              <TeamSectionLabel label="Works at · change anytime" />
              <WorksAtSegmented value={group} onChange={(next) => void handleGroupChange(next)} disabled={groupSaving} />

              <TeamSectionLabel label="Features" />
              <TeamCard style={{ paddingHorizontal: ds.spacing(13) }}>
                {modules ? (
                  manageableKeys.map((key, index) => (
                    <ModuleToggleRow
                      key={key}
                      label={DETAIL_MODULE_LABELS[key] ?? key}
                      value={modules[key]}
                      disabled={pendingKey !== null}
                      showBorder={index < manageableKeys.length - 1}
                      onChange={(value) => void handleModuleChange(key, value)}
                    />
                  ))
                ) : (
                  <View style={{ paddingVertical: ds.spacing(14), alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={tipsTheme.accent} />
                  </View>
                )}
              </TeamCard>

              <View style={{ height: ds.spacing(9) }} />
              <TouchableOpacity
                onPress={() => {
                  setResetPin('');
                  setResetError(null);
                  setResetVisible(true);
                }}
                disabled={user.is_suspended}
                activeOpacity={0.82}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ds.spacing(10),
                  backgroundColor: tipsTheme.card,
                  borderWidth: glassHairlineWidth,
                  borderColor: tipsTheme.hairline,
                  borderRadius: 17,
                  paddingHorizontal: ds.spacing(13),
                  minHeight: Math.max(48, ds.buttonH),
                  opacity: user.is_suspended ? 0.5 : 1,
                }}
              >
                <Ionicons name="key-outline" size={ds.icon(17)} color={tipsTheme.ink} />
                <Text style={{ flex: 1, fontSize: ds.fontSize(13.5), fontWeight: '700', color: tipsTheme.ink }}>
                  {`Reset ${displayName.split(' ')[0]}'s PIN`}
                </Text>
                <Ionicons name="chevron-forward" size={ds.icon(16)} color={tipsTheme.ink3} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/(manager)/manager-settings/team-preview',
                    params: { userId: user.id, name: displayName, group },
                  } as Parameters<typeof router.push>[0])
                }
                activeOpacity={0.82}
                style={{
                  marginTop: ds.spacing(9),
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: ds.spacing(8),
                  backgroundColor: tipsTheme.ink,
                  borderRadius: radii.pill,
                  minHeight: Math.max(46, ds.buttonH),
                }}
              >
                <Ionicons name="eye-outline" size={ds.icon(16)} color="#FFFFFF" />
                <Text style={{ fontSize: ds.fontSize(13), fontWeight: '700', color: '#FFFFFF' }}>
                  {`Preview as ${displayName.split(' ')[0]}`}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>

        <Modal transparent animationType="fade" visible={resetVisible} onRequestClose={() => setResetVisible(false)}>
          <View
            style={{
              flex: 1,
              backgroundColor: colors.scrimStrong,
              alignItems: 'center',
              justifyContent: 'center',
              padding: ds.spacing(24),
            }}
          >
            <View
              style={{
                alignSelf: 'stretch',
                backgroundColor: tipsTheme.card,
                borderRadius: 19,
                padding: ds.spacing(18),
              }}
            >
              <Text style={{ fontSize: ds.fontSize(17), fontWeight: '700', color: tipsTheme.ink }}>
                {`Reset ${displayName.split(' ')[0]}'s PIN`}
              </Text>
              <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.ink2, marginTop: ds.spacing(4) }}>
                Type a new 4-digit PIN. Tell them in person.
              </Text>
              <TextInput
                value={resetPin}
                onChangeText={(value) => {
                  setResetPin(value.replace(/[^0-9]/g, '').slice(0, 4));
                  if (resetError) setResetError(null);
                }}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                editable={!resetBusy}
                autoFocus
                style={{
                  marginTop: ds.spacing(12),
                  backgroundColor: tipsTheme.well,
                  borderRadius: 12,
                  paddingHorizontal: ds.spacing(13),
                  minHeight: 48,
                  fontSize: ds.fontSize(20),
                  fontWeight: '700',
                  letterSpacing: 8,
                  textAlign: 'center',
                  color: tipsTheme.ink,
                }}
              />
              {resetError ? (
                <Text style={{ fontSize: ds.fontSize(12), color: tipsTheme.alert, marginTop: ds.spacing(6) }}>
                  {resetError}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(14) }}>
                <TouchableOpacity
                  onPress={() => setResetVisible(false)}
                  disabled={resetBusy}
                  activeOpacity={0.82}
                  style={{
                    flex: 1,
                    borderRadius: radii.pill,
                    borderWidth: glassHairlineWidth,
                    borderColor: tipsTheme.hairline,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: tipsTheme.ink }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleResetSubmit}
                  disabled={resetBusy || resetPin.length !== 4}
                  activeOpacity={0.82}
                  style={{
                    flex: 1,
                    borderRadius: radii.pill,
                    backgroundColor: tipsTheme.accent,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: resetBusy || resetPin.length !== 4 ? 0.5 : 1,
                  }}
                >
                  {resetBusy ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: '#FFFFFF' }}>
                      Reset PIN
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
