import React, { useState } from 'react';
import {
  Alert,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  GlassSurface,
  StackScreenHeader,
} from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { SettingsSectionLabel } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import { updateAccessCodes } from '@/services';
import { useAuthStore } from '@/store';

const ACCESS_CODE_REGEX = /^\d{4}$/;

function AccessCodeField({
  label,
  value,
  onChangeText,
  secureTextEntry,
  onToggleSecureEntry,
  icon,
  onShare,
  canShare,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry: boolean;
  onToggleSecureEntry: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  onShare: () => void;
  canShare: boolean;
}) {
  const ds = useScaledStyles();

  return (
    <View style={{ marginBottom: ds.spacing(16) }}>
      <Text
        style={{
          marginBottom: ds.spacing(8),
          fontSize: ds.fontSize(12),
          fontWeight: '700',
          color: glassColors.textSecondary,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <GlassSurface
        intensity="medium"
        blurred={false}
        style={{
          borderRadius: glassRadii.surface,
          paddingHorizontal: ds.spacing(14),
          minHeight: Math.max(52, ds.buttonH),
          justifyContent: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: Math.max(38, ds.icon(38)),
              height: Math.max(38, ds.icon(38)),
              borderRadius: glassRadii.iconTile,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: glassColors.mediumFill,
            }}
          >
            <Ionicons
              name={icon}
              size={ds.icon(18)}
              color={glassColors.textSecondary}
            />
          </View>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry={secureTextEntry}
            placeholder={`4-digit ${label.toLowerCase()}`}
            placeholderTextColor={glassColors.textMuted}
            style={{
              flex: 1,
              marginLeft: ds.spacing(10),
              fontSize: ds.fontSize(17),
              fontWeight: '600',
              color: glassColors.textPrimary,
              letterSpacing: 2,
            }}
          />
          <TouchableOpacity
            onPress={onToggleSecureEntry}
            activeOpacity={0.82}
            style={{
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={secureTextEntry ? 'eye-outline' : 'eye-off-outline'}
              size={ds.icon(18)}
              color={glassColors.textSecondary}
            />
          </TouchableOpacity>
          {canShare ? (
            <TouchableOpacity
              onPress={onShare}
              activeOpacity={0.82}
              style={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="share-outline"
                size={ds.icon(18)}
                color={glassColors.accent}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </GlassSurface>
    </View>
  );
}

export default function ManagerAccessCodesScreen() {
  const ds = useScaledStyles();
  const { user } = useAuthStore();
  const [employeeAccessCode, setEmployeeAccessCode] = useState('');
  const [managerAccessCode, setManagerAccessCode] = useState('');
  const [showEmployeeAccessCode, setShowEmployeeAccessCode] = useState(false);
  const [showManagerAccessCode, setShowManagerAccessCode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  const sanitizeCode = (value: string) => value.replace(/\D/g, '').slice(0, 4);
  const canShare = (code: string) => ACCESS_CODE_REGEX.test(code);

  const handleShare = async (role: 'employee' | 'manager') => {
    const code = role === 'employee' ? employeeAccessCode : managerAccessCode;
    const roleLabel = role === 'employee' ? 'Employee' : 'Manager';

    try {
      await Share.share({
        message: `Your ${roleLabel.toLowerCase()} access code for Babytuna is: ${code}\n\nUse this code when creating your account.`,
      });
    } catch {
      // Share sheet dismissed.
    }
  };

  const handleUpdateCodes = async () => {
    if (user?.role !== 'manager') {
      Alert.alert('Access denied', 'Only managers can update access codes.');
      return;
    }

    if (
      !ACCESS_CODE_REGEX.test(employeeAccessCode) ||
      !ACCESS_CODE_REGEX.test(managerAccessCode)
    ) {
      setErrorMessage('Both access codes must be exactly 4 digits.');
      return;
    }

    if (employeeAccessCode === managerAccessCode) {
      setErrorMessage('Employee and manager codes cannot be the same.');
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);
      await updateAccessCodes({
        employeeAccessCode,
        managerAccessCode,
      });
      setIsSaved(true);

      Alert.alert('Access codes updated', 'Share the employee code if needed.', [
        {
          text: 'Share Employee Code',
          onPress: () => {
            void handleShare('employee');
          },
        },
        { text: 'Done' },
      ]);
    } catch (error: any) {
      Alert.alert(
        'Update failed',
        error?.message || 'Unable to update access codes.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ManagerScaleContainer>
        <View style={{ backgroundColor: glassColors.background }}>
          <StackScreenHeader
            title="Access Codes"
            subtitle="Manager-only sign-up access for employees and managers."
          />
        </View>

        <View style={{ flex: 1 }}>
          <SettingsSectionLabel
            label="Security"
            description="Keep both codes readable, distinct, and ready to share without breaking the current settings flow."
          />

          <GlassSurface
            intensity="subtle"
            blurred={false}
            style={{
              marginHorizontal: glassSpacing.screen,
              borderRadius: glassRadii.surface,
              padding: ds.spacing(16),
            }}
          >
            <AccessCodeField
              label="Employee Access Code"
              value={employeeAccessCode}
              onChangeText={(value) => {
                setEmployeeAccessCode(sanitizeCode(value));
                setIsSaved(false);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              secureTextEntry={!showEmployeeAccessCode}
              onToggleSecureEntry={() =>
                setShowEmployeeAccessCode((current) => !current)
              }
              icon="person-outline"
              canShare={canShare(employeeAccessCode)}
              onShare={() => {
                void handleShare('employee');
              }}
            />

            <AccessCodeField
              label="Manager Access Code"
              value={managerAccessCode}
              onChangeText={(value) => {
                setManagerAccessCode(sanitizeCode(value));
                setIsSaved(false);
                if (errorMessage) {
                  setErrorMessage(null);
                }
              }}
              secureTextEntry={!showManagerAccessCode}
              onToggleSecureEntry={() =>
                setShowManagerAccessCode((current) => !current)
              }
              icon="shield-checkmark-outline"
              canShare={canShare(managerAccessCode)}
              onShare={() => {
                void handleShare('manager');
              }}
            />

            {errorMessage ? (
              <View
                style={{
                  borderRadius: glassRadii.button,
                  borderWidth: glassHairlineWidth,
                  borderColor: 'rgba(239, 68, 68, 0.18)',
                  backgroundColor: glassColors.dangerSoft,
                  paddingHorizontal: ds.spacing(14),
                  paddingVertical: ds.spacing(12),
                  marginBottom: ds.spacing(12),
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    color: glassColors.dangerText,
                    fontWeight: '600',
                  }}
                >
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {isSaved ? (
              <View
                style={{
                  borderRadius: glassRadii.button,
                  borderWidth: glassHairlineWidth,
                  borderColor: 'rgba(52, 168, 83, 0.16)',
                  backgroundColor: glassColors.successSoft,
                  paddingHorizontal: ds.spacing(14),
                  paddingVertical: ds.spacing(12),
                  marginBottom: ds.spacing(12),
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={ds.icon(18)}
                  color={glassColors.successText}
                />
                <Text
                  style={{
                    marginLeft: ds.spacing(8),
                    fontSize: ds.fontSize(13),
                    color: glassColors.successText,
                    fontWeight: '600',
                  }}
                >
                  Codes saved successfully.
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleUpdateCodes}
              disabled={isSaving}
              activeOpacity={0.82}
              style={{
                minHeight: Math.max(48, ds.buttonH),
                borderRadius: glassRadii.button,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.accent,
                opacity: isSaving ? 0.6 : 1,
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '700',
                  color: glassColors.textOnPrimary,
                }}
              >
                {isSaving ? 'Updating...' : 'Update Codes'}
              </Text>
            </TouchableOpacity>
          </GlassSurface>

          <GlassSurface
            intensity="subtle"
            blurred={false}
            style={{
              marginHorizontal: glassSpacing.screen,
              marginTop: ds.spacing(16),
              borderRadius: glassRadii.surface,
              padding: ds.spacing(16),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color: glassColors.textPrimary,
              }}
            >
              Keep codes separate
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(8),
                fontSize: ds.fontSize(13),
                lineHeight: ds.fontSize(18),
                color: glassColors.textSecondary,
              }}
            >
              Employee and manager codes should stay distinct so sign-up access
              remains intentional and role boundaries stay clear.
            </Text>
          </GlassSurface>
        </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
