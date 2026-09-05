import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { getFloatingPillClearance } from '@/components/navigation';
import { useResolvedActiveLocation } from '@/hooks/useResolvedActiveLocation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { ChangeCredentialSheet } from '@/components/settings/ChangeCredentialSheet';
import {
  isRealAccountEmail,
  updateMyDisplayName,
  updateMyEmail,
} from '@/services/selfProfile';
import { useAuthStore } from '@/store';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { PRIVACY_URL } from '@/features/auth/legal';
import { openExternalUrl } from './components/AboutLegalSheet';
import { SettingsCard, SettingsCardRow } from './components/SettingsCardRow';

/**
 * Employee Profile — the App Store compliance set, all rows functional:
 * Name (editable, syncs the name sign-in identity), Email (optional, for
 * account recovery), Location (read-only, set by the manager), Change PIN or
 * password, Privacy choices, Delete account (existing deletion flow).
 */

type EditSheet = 'name' | 'email' | 'credential' | 'privacy' | null;

export function EmployeeProfileScreen() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const { user, setUser, deleteSelfAccount } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
      deleteSelfAccount: state.deleteSelfAccount,
    })),
  );
  const { location } = useResolvedActiveLocation();

  const [activeSheet, setActiveSheet] = useState<EditSheet>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const displayName = user?.name?.trim() || 'You';
  const initial = (displayName[0] ?? '?').toUpperCase();
  const realEmail = isRealAccountEmail(user?.email) ? user?.email ?? null : null;
  const locationLabel = location?.name ?? 'Not set';

  const openSheet = useCallback(
    (sheet: EditSheet) => {
      setSheetError(null);
      setIsSaving(false);
      if (sheet === 'name') setNameDraft(user?.name ?? '');
      if (sheet === 'email') setEmailDraft(realEmail ?? '');
      setActiveSheet(sheet);
    },
    [realEmail, user?.name],
  );

  const closeSheet = useCallback(() => {
    if (isSaving) return;
    setActiveSheet(null);
  }, [isSaving]);

  const handleSaveName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setSheetError('Enter a name.');
      return;
    }
    setIsSaving(true);
    setSheetError(null);
    try {
      await updateMyDisplayName(trimmed);
      if (user) setUser({ ...user, name: trimmed });
      setActiveSheet(null);
    } catch (error) {
      setSheetError(
        error instanceof Error ? error.message : 'Could not update your name.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [nameDraft, setUser, user]);

  const handleSaveEmail = useCallback(async () => {
    setIsSaving(true);
    setSheetError(null);
    try {
      await updateMyEmail(emailDraft);
      setActiveSheet(null);
      Alert.alert(
        'Check your inbox',
        `We sent a confirmation link to ${emailDraft.trim()}. The change applies once you confirm it.`,
      );
    } catch (error) {
      setSheetError(
        error instanceof Error ? error.message : 'Could not update your email.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [emailDraft]);

  const openDeleteConfirmation = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setDeleteConfirmText('');
            setShowDeleteModal(true);
          },
        },
      ],
    );
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'DELETE' || isDeletingAccount) return;
    setIsDeletingAccount(true);
    try {
      await deleteSelfAccount('DELETE');
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    } catch (error) {
      Alert.alert(
        'Unable to delete account',
        error instanceof Error ? error.message : 'Please try again in a moment.',
      );
    } finally {
      setIsDeletingAccount(false);
    }
  }, [deleteConfirmText, deleteSelfAccount, isDeletingAccount]);

  const bottomPadding = getFloatingPillClearance(insets.bottom) + ds.spacing(16);

  const sheetInputStyle = {
    minHeight: 48,
    backgroundColor: tipsTheme.card,
    borderWidth: glassHairlineWidth,
    borderColor: tipsTheme.hairline,
    borderRadius: 14,
    paddingHorizontal: ds.spacing(14),
    fontSize: ds.fontSize(15),
    color: tipsTheme.ink,
  } as const;

  const sheetCta = (label: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={isSaving}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        minHeight: 50,
        borderRadius: radii.pill,
        backgroundColor: isSaving ? tipsTheme.disabled : tipsTheme.accent,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: ds.spacing(14),
      }}
    >
      {isSaving ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );

  const sheetErrorView = sheetError ? (
    <View
      style={{
        backgroundColor: tipsTheme.tint,
        borderRadius: 12,
        paddingHorizontal: ds.spacing(12),
        paddingVertical: ds.spacing(9),
        marginTop: ds.spacing(10),
      }}
    >
      <Text style={{ fontSize: ds.fontSize(12.5), color: tipsTheme.alert }}>{sheetError}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tipsTheme.page }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: ds.spacing(18),
          paddingBottom: bottomPadding,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: ds.spacing(8),
            paddingTop: ds.spacing(2),
            paddingBottom: ds.spacing(6),
          }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 38,
              height: 38,
              borderRadius: radii.circle,
              backgroundColor: tipsTheme.card,
              borderWidth: glassHairlineWidth,
              borderColor: 'rgba(0, 0, 0, 0.07)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="chevron-back" size={ds.icon(18)} color={tipsTheme.ink} />
          </TouchableOpacity>
          <Text style={{ fontSize: ds.fontSize(24), fontWeight: '700', color: tipsTheme.ink }}>
            Profile
          </Text>
        </View>

        <View style={{ alignItems: 'center', marginVertical: ds.spacing(12) }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radii.circle,
              backgroundColor: tipsTheme.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: ds.fontSize(26), fontWeight: '700', color: tipsTheme.accent }}>
              {initial}
            </Text>
          </View>
        </View>

        <SettingsCard style={{ marginBottom: ds.spacing(10) }}>
          <SettingsCardRow
            icon="person-outline"
            title="Name"
            subtitle={displayName}
            onPress={() => openSheet('name')}
          />
          <SettingsCardRow
            icon="mail-outline"
            title="Email"
            subtitle={realEmail ?? 'Optional · for account recovery'}
            onPress={() => openSheet('email')}
            rightElement={
              realEmail ? undefined : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: ds.spacing(5) }}>
                  <Text style={{ fontSize: ds.fontSize(12), color: tipsTheme.ink3 }}>Add</Text>
                  <Ionicons name="chevron-forward" size={ds.icon(16)} color={tipsTheme.ink3} />
                </View>
              )
            }
          />
          <SettingsCardRow
            icon="location-outline"
            title="Location"
            subtitle={`${locationLabel} · set by the manager`}
            showChevron={false}
            isLast
          />
        </SettingsCard>

        <SettingsCard style={{ marginBottom: ds.spacing(10) }}>
          <SettingsCardRow
            icon="key-outline"
            title="Change PIN or password"
            onPress={() => openSheet('credential')}
          />
          <SettingsCardRow
            icon="shield-checkmark-outline"
            title="Privacy choices"
            subtitle="Data we store and why"
            onPress={() => openSheet('privacy')}
            isLast
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsCardRow
            icon="trash-outline"
            title="Delete account"
            subtitle="Removes your account and personal data"
            onPress={openDeleteConfirmation}
            destructive
            isLast
          />
        </SettingsCard>
      </ScrollView>

      {/* Name */}
      <BottomSheetShell
        visible={activeSheet === 'name'}
        onClose={closeSheet}
        bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
      >
        <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
          Your name
        </Text>
        <Text
          style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
        >
          Also used to sign in, so it stays unique on the team.
        </Text>
        <TextInput
          value={nameDraft}
          onChangeText={setNameDraft}
          placeholder="Full name"
          placeholderTextColor={tipsTheme.ink3}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel="Your name"
          style={sheetInputStyle}
        />
        {sheetErrorView}
        {sheetCta('Save name', () => void handleSaveName())}
      </BottomSheetShell>

      {/* Email */}
      <BottomSheetShell
        visible={activeSheet === 'email'}
        onClose={closeSheet}
        bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
      >
        <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
          {realEmail ? 'Change email' : 'Add email'}
        </Text>
        <Text
          style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
        >
          Optional. Used only to help you recover your account.
        </Text>
        <TextInput
          value={emailDraft}
          onChangeText={setEmailDraft}
          placeholder="you@example.com"
          placeholderTextColor={tipsTheme.ink3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          accessibilityLabel="Recovery email"
          style={sheetInputStyle}
        />
        {sheetErrorView}
        {sheetCta('Save email', () => void handleSaveEmail())}
      </BottomSheetShell>

      <ChangeCredentialSheet visible={activeSheet === 'credential'} onClose={closeSheet} />

      {/* Privacy choices */}
      <BottomSheetShell
        visible={activeSheet === 'privacy'}
        onClose={closeSheet}
        bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
      >
        <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
          Privacy choices
        </Text>
        <Text
          style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
        >
          Data we store and why.
        </Text>
        <View
          style={{
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            borderRadius: 16,
            padding: ds.spacing(14),
            marginBottom: ds.spacing(12),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink, lineHeight: 19 }}>
            We store your name, your sign-in credential (hashed, never readable), an optional
            recovery email, and the orders and stock checks you record — that{'\u2019'}s what makes the
            app work. Nothing is sold or shared outside the restaurant. Deleting your account
            removes your personal data.
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void openExternalUrl(PRIVACY_URL)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Read the full privacy policy"
          style={{ alignItems: 'center', paddingVertical: ds.spacing(6) }}
        >
          <Text style={{ fontSize: ds.fontSize(13.5), fontWeight: '700', color: tipsTheme.accent }}>
            Read the full privacy policy
          </Text>
        </TouchableOpacity>
      </BottomSheetShell>

      {/* Delete confirmation */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeletingAccount) setShowDeleteModal(false);
        }}
      >
        <Pressable
          onPress={() => {
            if (!isDeletingAccount) setShowDeleteModal(false);
          }}
          style={{
            flex: 1,
            backgroundColor: 'rgba(20, 18, 14, 0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: ds.spacing(24),
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              width: '100%',
              backgroundColor: tipsTheme.page,
              borderRadius: 22,
              padding: ds.spacing(20),
            }}
          >
            <Text style={{ fontSize: ds.fontSize(18), fontWeight: '700', color: tipsTheme.ink }}>
              Delete your account?
            </Text>
            <Text
              style={{
                fontSize: ds.fontSize(13),
                color: tipsTheme.ink2,
                marginTop: ds.spacing(4),
                marginBottom: ds.spacing(12),
              }}
            >
              Type DELETE to confirm. This cannot be undone.
            </Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={tipsTheme.ink3}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Type DELETE to confirm"
              style={sheetInputStyle}
            />
            <TouchableOpacity
              onPress={() => void handleDeleteAccount()}
              disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Permanently delete account"
              style={{
                minHeight: 50,
                borderRadius: radii.pill,
                backgroundColor:
                  deleteConfirmText === 'DELETE' && !isDeletingAccount
                    ? tipsTheme.alert
                    : tipsTheme.disabled,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: ds.spacing(14),
              }}
            >
              {isDeletingAccount ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
                  Delete account
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!isDeletingAccount) setShowDeleteModal(false);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={{ alignItems: 'center', paddingVertical: ds.spacing(12) }}
            >
              <Text style={{ fontSize: ds.fontSize(14), fontWeight: '600', color: tipsTheme.ink2 }}>
                Cancel
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
