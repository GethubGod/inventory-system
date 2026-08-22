// Invite someone: name + works-at + feature toggles with the live preview
// card directly underneath (a pure function of the form state), then Create
// link. Employee invites only — manager invites stay on the web dashboard.

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { createInvite, type InviteLocationGroup } from '@/services/invites';
import {
  getBuiltInEmployeeDefaults,
  getEmployeeInviteDefaults,
  type EmployeeInviteDefaults,
} from '@/services/employeeDefaults';
import { deriveInvitePreview } from './invitePreview';
import { InvitePreviewCard } from './components/InvitePreviewCard';
import { ModuleToggleRow, TeamCard, TeamSectionLabel, WorksAtSegmented } from './components/TeamUI';

/** Screen-local labels per the flow spec (MODULE_LABELS stays app-wide). */
const TOGGLE_ROWS: { key: keyof EmployeeInviteDefaults & string; label: string; tag?: string }[] = [
  { key: 'ordering_simple', label: 'Ordering checklist', tag: 'DEFAULT' },
  { key: 'ordering_advanced', label: 'Advanced ordering' },
  { key: 'stock_check', label: 'Stock check' },
  { key: 'tips', label: 'Tips' },
];

const EXPIRY_OPTIONS: { hours: number; label: string }[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
];

export default function InviteScreen() {
  const ds = useScaledStyles();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<InviteLocationGroup>('sushi');
  const [toggles, setToggles] = useState<EmployeeInviteDefaults>(getBuiltInEmployeeDefaults());
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Seed the toggles from the org-wide defaults (same seed create-invite
    // applies server-side when no preset is sent).
    let cancelled = false;
    getEmployeeInviteDefaults()
      .then((defaults) => {
        if (!cancelled) setToggles(defaults);
      })
      .catch(() => {
        // Built-ins already in place.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(
    () => deriveInvitePreview(name, group, toggles),
    [name, group, toggles],
  );

  const canSubmit = name.trim().length > 0 && !busy;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite({
        invitedName: name.trim(),
        role: 'employee',
        expiresInHours,
        modulePreset: { ...toggles },
        locationGroup: group,
      });
      const expiryLabel =
        EXPIRY_OPTIONS.find((option) => option.hours === expiresInHours)?.label ?? '7 days';
      router.replace({
        pathname: '/(manager)/manager-settings/team-invite-link',
        params: {
          name: name.trim(),
          joinUrl: invite.joinUrl,
          expiryLabel,
          group,
        },
      } as Parameters<typeof router.replace>[0]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create the invite.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tipsTheme.page }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View style={{ backgroundColor: tipsTheme.page }}>
          <StackScreenHeader title="Invite someone" subtitle="They set up their own app from the link" />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: ds.spacing(20),
            paddingBottom: ds.spacing(28),
          }}
          keyboardShouldPersistTaps="handled"
        >
          <TeamSectionLabel label="Name" />
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (error) setError(null);
            }}
            placeholder="First name, like on the schedule"
            placeholderTextColor={tipsTheme.ink3}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!busy}
            style={{
              backgroundColor: tipsTheme.well,
              borderRadius: 12,
              paddingHorizontal: ds.spacing(13),
              minHeight: Math.max(44, ds.buttonH - ds.spacing(8)),
              fontSize: ds.fontSize(14),
              fontWeight: '600',
              color: tipsTheme.ink,
            }}
          />

          <TeamSectionLabel label="Works at" />
          <WorksAtSegmented value={group} onChange={setGroup} disabled={busy} />

          <TeamSectionLabel label={`What ${name.trim() || 'they'} can use`} />
          <TeamCard style={{ paddingHorizontal: ds.spacing(13) }}>
            {TOGGLE_ROWS.map((row, index) => (
              <ModuleToggleRow
                key={row.key}
                label={row.label}
                tag={row.tag}
                value={toggles[row.key] === true}
                disabled={busy}
                showBorder={index < TOGGLE_ROWS.length - 1}
                onChange={(value) => setToggles((current) => ({ ...current, [row.key]: value }))}
              />
            ))}
          </TeamCard>

          <View style={{ height: ds.spacing(9) }} />
          <InvitePreviewCard model={preview} />

          <TeamSectionLabel label="Link expires in" />
          <View style={{ flexDirection: 'row', gap: ds.spacing(8) }}>
            {EXPIRY_OPTIONS.map((option) => {
              const selected = option.hours === expiresInHours;
              return (
                <TouchableOpacity
                  key={option.hours}
                  onPress={() => setExpiresInHours(option.hours)}
                  disabled={busy}
                  activeOpacity={0.82}
                  style={{
                    flex: 1,
                    borderRadius: radii.pill,
                    borderWidth: selected ? 1.5 : glassHairlineWidth,
                    borderColor: selected ? tipsTheme.accent : tipsTheme.hairline,
                    backgroundColor: selected ? tipsTheme.tint : tipsTheme.card,
                    paddingVertical: ds.spacing(7),
                    alignItems: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11.5),
                      fontWeight: '700',
                      color: selected ? tipsTheme.accent : tipsTheme.ink2,
                    }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {error ? (
            <Text
              style={{
                fontSize: ds.fontSize(12.5),
                color: tipsTheme.alert,
                marginTop: ds.spacing(12),
              }}
            >
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            onPress={handleCreate}
            disabled={!canSubmit}
            activeOpacity={0.82}
            style={{
              marginTop: ds.spacing(16),
              backgroundColor: tipsTheme.accent,
              borderRadius: radii.pill,
              minHeight: Math.max(48, ds.buttonH),
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={{ fontSize: ds.fontSize(14.5), fontWeight: '700', color: '#FFFFFF' }}>
                Create link
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
