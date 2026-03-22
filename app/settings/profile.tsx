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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ChangePasswordModal, SettingsGroup, SettingsScreenLayout } from '@/components/settings';
import { useAuthStore, useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';

function ProfileInfoRow({
  label,
  value,
  icon,
  right,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  right?: React.ReactNode;
}) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        paddingHorizontal: ds.spacing(16),
        paddingTop: ds.spacing(12),
      }}
    >
      <View
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(14),
          borderWidth: 1,
          borderColor: 'rgba(15, 23, 42, 0.1)',
          borderRadius: glassRadii.button,
          backgroundColor: glassColors.background,
          shadowColor: 'rgba(15, 23, 42, 0.04)',
          shadowOpacity: 1,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flex: 1,
            paddingRight: ds.spacing(10),
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: ds.fontSize(11),
                fontWeight: '700',
                color: glassColors.textSecondary,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {label}
            </Text>
            <View
              style={{
                marginTop: ds.spacing(8),
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  width: Math.max(36, ds.icon(34)),
                  height: Math.max(36, ds.icon(34)),
                  borderRadius: glassRadii.iconTile,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.mediumFill,
                }}
              >
                <Ionicons
                  name={icon}
                  size={ds.icon(17)}
                  color={glassColors.textSecondary}
                />
              </View>
              <Text
                style={{
                  flex: 1,
                  marginLeft: ds.spacing(10),
                  fontSize: ds.fontSize(15),
                  color: glassColors.textPrimary,
                  fontWeight: '600',
                }}
                numberOfLines={2}
              >
                {value}
              </Text>
            </View>
          </View>
        </View>
        {right}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  destructive = false,
  disabled = false,
  loading = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const ds = useScaledStyles();

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
      style={{
        minHeight: Math.max(48, ds.buttonH),
        borderRadius: glassRadii.button,
        borderWidth: 1,
        borderColor: destructive
          ? 'rgba(239, 68, 68, 0.16)'
          : 'rgba(15, 23, 42, 0.12)',
        backgroundColor: destructive
          ? glassColors.dangerSoft
          : glassColors.background,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={destructive ? glassColors.dangerText : glassColors.accent}
        />
      ) : (
        <Ionicons
          name={icon}
          size={ds.icon(18)}
          color={destructive ? glassColors.dangerText : glassColors.accent}
        />
      )}
      <Text
        style={{
          marginLeft: ds.spacing(8),
          fontSize: ds.fontSize(15),
          fontWeight: '700',
          color: destructive ? glassColors.dangerText : glassColors.accent,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function ProfileSettingsScreen() {
  const ds = useScaledStyles();
  const { user, location, deleteSelfAccount } = useAuthStore();
  const { avatarUri, setAvatarUri } = useSettingsStore();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(user?.name || '');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const firstName = useMemo(
    () => user?.name?.trim().split(/\s+/)[0] || 'User',
    [user?.name],
  );

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
      router.replace('/(auth)/login');
    } catch (error: any) {
      Alert.alert(
        'Unable to delete account',
        error?.message || 'Please try again in a moment.',
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <SettingsScreenLayout title="Profile">
      <SettingsGroup style={{ marginTop: ds.spacing(18) }}>
        <View
          style={{
            paddingHorizontal: ds.spacing(16),
            paddingTop: ds.spacing(18),
            paddingBottom: ds.spacing(12),
            alignItems: 'center',
          }}
        >
          <TouchableOpacity
            onPress={pickImage}
            activeOpacity={0.82}
            style={{ alignItems: 'center' }}
          >
            <View
              style={{
                width: Math.max(84, ds.icon(88)),
                height: Math.max(84, ds.icon(88)),
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
                    fontSize: ds.fontSize(30),
                    fontWeight: '800',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  {firstName.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <Text
              style={{
                marginTop: ds.spacing(10),
                fontSize: ds.fontSize(14),
                fontWeight: '600',
                color: glassColors.accent,
              }}
            >
              Change Photo
            </Text>
          </TouchableOpacity>

          <Text
            style={{
              marginTop: ds.spacing(14),
              fontSize: ds.fontSize(22),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            {user?.name || 'Unnamed User'}
          </Text>
          <View
            style={{
              marginTop: ds.spacing(8),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(6),
              borderRadius: glassRadii.pill,
              backgroundColor: glassColors.mediumFill,
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(12),
                fontWeight: '700',
                color: glassColors.textSecondary,
                textTransform: 'capitalize',
              }}
            >
              {user?.role || 'employee'}
            </Text>
          </View>
        </View>

        <ProfileInfoRow
          label="Full Name"
          value={isEditingName ? tempName || 'Not set' : user?.name || 'Not set'}
          icon="person-outline"
          right={
            isEditingName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => setIsEditingName(false)}
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
                  onPress={() => setIsEditingName(false)}
                  style={{
                    width: 40,
                    height: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name="checkmark"
                    size={ds.icon(18)}
                    color={glassColors.accent}
                  />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => {
                  setTempName(user?.name || '');
                  setIsEditingName(true);
                }}
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
              paddingBottom: ds.spacing(16),
            }}
          >
            <TextInput
              value={tempName}
              onChangeText={setTempName}
              autoFocus
              placeholder="Full name"
              placeholderTextColor={glassColors.textMuted}
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
            />
          </View>
        ) : null}

        <ProfileInfoRow
          label="Email"
          value={user?.email || 'Not set'}
          icon="mail-outline"
          right={
            <Ionicons
              name="lock-closed"
              size={ds.icon(16)}
              color={glassColors.textSecondary}
            />
          }
        />
        <ProfileInfoRow
          label="Location"
          value={location?.name || 'Not set'}
          icon="location-outline"
          right={
            <Ionicons
              name="lock-closed"
              size={ds.icon(16)}
              color={glassColors.textSecondary}
            />
          }
        />
        <View
          style={{
            paddingHorizontal: ds.spacing(16),
            paddingTop: ds.spacing(16),
            paddingBottom: ds.spacing(18),
          }}
        >
          <View
            style={{
              gap: ds.spacing(12),
            }}
          >
            <ActionButton
              label="Change Password"
              icon="key-outline"
              onPress={() => setShowPasswordModal(true)}
            />
            <ActionButton
              label={isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
              icon="trash-outline"
              onPress={openDeleteConfirmation}
              destructive
              disabled={isDeletingAccount}
              loading={isDeletingAccount}
            />
          </View>
        </View>
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
            padding: ds.spacing(20),
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
