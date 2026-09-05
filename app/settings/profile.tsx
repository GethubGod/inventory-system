import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  ChangePasswordModal,
  SettingsGroup,
  SettingsRow,
  SettingsScreenLayout,
  SettingsSectionLabel,
  settingsIconPalettes,
} from '@/components/settings';
import { isRealAccountEmail, updateMyDisplayName } from '@/services/selfProfile';
import { useAuthStore, useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';

/**
 * Profile — the same grouped-card language as the rest of the settings stack:
 * SettingsScreenLayout supplies the shared StackScreenHeader (and its back
 * control), then an identity card followed by labelled SettingsGroup sections
 * of SettingsRows. Editing behaviour is unchanged from the previous layout.
 */

export default function ProfileSettingsScreen() {
  const ds = useScaledStyles();
  const { user, location, deleteSelfAccount, setUser } = useAuthStore();
  const { avatarUri, setAvatarUri } = useSettingsStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user?.name || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const displayName = user?.name?.trim() || 'Unnamed User';
  const initial = useMemo(
    () => (displayName.trim()[0] ?? '?').toUpperCase(),
    [displayName],
  );
  const roleLabel = user?.role || 'employee';
  const locationName = location?.name || null;
  // Invite-minted accounts carry a synthetic @members.babytunasystems.com
  // address that means nothing to the person reading it, so it is treated as
  // "no email on file" rather than shown and truncated.
  const realEmail = isRealAccountEmail(user?.email) ? user?.email?.trim() ?? null : null;

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        'Allow photo library access to change your profile image.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const openDeleteConfirmation = () => {
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
  };

  const handleSaveName = async () => {
    const trimmed = tempName.trim();
    if (!trimmed) {
      setNameError('Enter a name.');
      return;
    }
    if (trimmed === user?.name) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    setNameError(null);
    try {
      await updateMyDisplayName(trimmed);
      // Signing out or switching accounts mid-save must not be undone by this
      // write landing afterwards.
      const current = useAuthStore.getState().user;
      if (current && current.id === user?.id) {
        setUser({ ...current, name: trimmed });
      }
      setIsEditingName(false);
    } catch (error) {
      setNameError(
        error instanceof Error ? error.message : 'Could not update your name.',
      );
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelEditName = () => {
    if (isSavingName) return;
    setNameError(null);
    setIsEditingName(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE' || isDeletingAccount) {
      return;
    }

    setIsDeletingAccount(true);

    try {
      await deleteSelfAccount('DELETE');
      setShowDeleteModal(false);
      setDeleteConfirmText('');
      if (typeof ToastAndroid !== 'undefined') {
        ToastAndroid.show('Account deleted', ToastAndroid.SHORT);
      } else {
        Alert.alert('Account deleted');
      }
    } catch (error) {
      Alert.alert(
        'Unable to delete account',
        error instanceof Error ? error.message : 'Please try again in a moment.',
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <SettingsScreenLayout title="Profile">
      {/* Identity card — avatar, name, and the role/location summary line. */}
      <SettingsGroup style={{ marginTop: ds.spacing(12) }}>
        <TouchableOpacity
          onPress={pickImage}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: ds.spacing(16),
            paddingVertical: ds.spacing(16),
          }}
        >
          <View
            style={{
              width: Math.max(56, ds.icon(56)),
              height: Math.max(56, ds.icon(56)),
              borderRadius: glassRadii.round,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: glassColors.accent,
            }}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={{ width: '100%', height: '100%' }} />
            ) : (
              <Text
                style={{
                  fontSize: ds.fontSize(22),
                  fontWeight: '700',
                  color: glassColors.textOnPrimary,
                }}
              >
                {initial}
              </Text>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0, marginLeft: ds.spacing(14) }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: ds.fontSize(18),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              {displayName}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                marginTop: ds.spacing(2),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
                textTransform: 'capitalize',
              }}
            >
              {locationName ? `${locationName} · ${roleLabel}` : roleLabel}
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(12),
                fontWeight: '600',
                color: glassColors.accent,
              }}
            >
              Change photo
            </Text>
          </View>
        </TouchableOpacity>
      </SettingsGroup>

      <SettingsSectionLabel label="Account details" />

      <SettingsGroup>
        <SettingsRow
          icon="person-outline"
          iconColor={settingsIconPalettes.profile.icon}
          iconBgColor={settingsIconPalettes.profile.background}
          title="Full name"
          subtitle={isEditingName ? tempName || 'Not set' : user?.name || 'Not set'}
          showChevron={false}
          rightElement={
            isEditingName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={handleCancelEditName}
                  disabled={isSavingName}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing your name"
                  style={{
                    width: 40,
                    height: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name="close"
                    size={ds.icon(18)}
                    color={glassColors.textSecondary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveName}
                  disabled={isSavingName}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm your name"
                  style={{
                    width: 40,
                    height: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: isSavingName ? 0.5 : 1,
                  }}
                >
                  {isSavingName ? (
                    <ActivityIndicator size="small" color={glassColors.accent} />
                  ) : (
                    <Ionicons name="checkmark" size={ds.icon(18)} color={glassColors.accent} />
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setTempName(user?.name || '');
                  setIsEditingName(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit your name"
                style={{
                  width: 40,
                  height: 40,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name="pencil-outline"
                  size={ds.icon(18)}
                  color={glassColors.textSecondary}
                />
              </TouchableOpacity>
            )
          }
        />

        {isEditingName ? (
          <View
            style={{
              paddingHorizontal: ds.spacing(16),
              paddingBottom: ds.spacing(14),
            }}
          >
            <TextInput
              value={tempName}
              onChangeText={setTempName}
              autoFocus
              placeholder="Full name"
              placeholderTextColor={glassColors.textMuted}
              accessibilityLabel="Full name"
              style={{
                minHeight: Math.max(48, ds.buttonH),
                borderRadius: glassRadii.button,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
                backgroundColor: glassColors.mediumFill,
                paddingHorizontal: ds.spacing(14),
                fontSize: ds.fontSize(15),
                color: glassColors.textPrimary,
              }}
              editable={!isSavingName}
              onSubmitEditing={handleSaveName}
              returnKeyType="done"
            />
            {nameError ? (
              <Text
                style={{
                  marginTop: ds.spacing(8),
                  fontSize: ds.fontSize(13),
                  color: glassColors.dangerText,
                }}
              >
                {nameError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <SettingsRow
          icon="mail-outline"
          iconColor={settingsIconPalettes.profile.icon}
          iconBgColor={settingsIconPalettes.profile.background}
          title="Email"
          subtitle={realEmail ?? 'Not set'}
          showChevron={false}
          rightElement={
            <Ionicons
              name="lock-closed"
              size={ds.icon(16)}
              color={glassColors.textSecondary}
            />
          }
        />

        <SettingsRow
          icon="location-outline"
          iconColor={settingsIconPalettes.profile.icon}
          iconBgColor={settingsIconPalettes.profile.background}
          title="Location"
          subtitle={locationName ?? 'Not set'}
          showChevron={false}
          showBorder={false}
          rightElement={
            <Ionicons
              name="lock-closed"
              size={ds.icon(16)}
              color={glassColors.textSecondary}
            />
          }
        />
      </SettingsGroup>

      <SettingsSectionLabel label="Account" />

      <SettingsGroup>
        <SettingsRow
          icon="key-outline"
          iconColor={settingsIconPalettes.neutral.icon}
          iconBgColor={settingsIconPalettes.neutral.background}
          title="Change PIN or password"
          subtitle="Update your sign-in details"
          onPress={() => setShowPasswordModal(true)}
        />
        <SettingsRow
          icon="trash-outline"
          iconColor={settingsIconPalettes.danger.icon}
          iconBgColor={settingsIconPalettes.danger.background}
          title={isDeletingAccount ? 'Deleting account...' : 'Delete account'}
          subtitle="Permanently removes your account and personal data"
          onPress={openDeleteConfirmation}
          destructive
          disabled={isDeletingAccount}
          showChevron={false}
          showBorder={false}
          rightElement={
            isDeletingAccount ? (
              <ActivityIndicator size="small" color={glassColors.dangerText} />
            ) : undefined
          }
        />
      </SettingsGroup>

      <ChangePasswordModal
        visible={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />

      <Modal
        visible={showDeleteModal}
        animationType="fade"
        transparent
        onRequestClose={() => {
          if (!isDeletingAccount) {
            setShowDeleteModal(false);
          }
        }}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: glassSpacing.screen,
            backgroundColor: colors.scrimStrong,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 420,
              borderRadius: glassRadii.surface,
              padding: ds.spacing(16),
              backgroundColor: glassColors.background,
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(18),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              Confirm permanent deletion
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(8),
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
              }}
            >
              Type DELETE to permanently remove your account.
            </Text>

            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              editable={!isDeletingAccount}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Type DELETE"
              placeholderTextColor={glassColors.textMuted}
              accessibilityLabel="Type DELETE to confirm"
              style={{
                marginTop: ds.spacing(12),
                borderRadius: glassRadii.button,
                minHeight: Math.max(48, ds.buttonH),
                paddingHorizontal: ds.spacing(14),
                fontSize: ds.fontSize(16),
                color: glassColors.textPrimary,
                backgroundColor: glassColors.mediumFill,
              }}
            />

            <View
              style={{
                marginTop: ds.spacing(14),
                flexDirection: 'row',
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  if (!isDeletingAccount) {
                    setShowDeleteModal(false);
                  }
                }}
                disabled={isDeletingAccount}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={{
                  flex: 1,
                  marginRight: ds.spacing(10),
                  minHeight: Math.max(44, ds.buttonH - 2),
                  borderRadius: glassRadii.button,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.mediumFill,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(15),
                    fontWeight: '700',
                    color: glassColors.textSecondary,
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                accessibilityRole="button"
                accessibilityLabel="Permanently delete account"
                style={{
                  flex: 1,
                  minHeight: Math.max(44, ds.buttonH - 2),
                  borderRadius: glassRadii.button,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.dangerText,
                  opacity:
                    deleteConfirmText !== 'DELETE' || isDeletingAccount ? 0.45 : 1,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(15),
                    fontWeight: '700',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SettingsScreenLayout>
  );
}
