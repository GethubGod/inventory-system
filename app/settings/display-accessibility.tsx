import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDisplayStore } from '@/store';
import { colors } from '@/constants';
import {
  MultiOptionToggle,
  SettingToggle,
  SettingsGroup,
  SettingsScreenLayout,
  SettingsSectionLabel,
} from '@/components/settings';
import { GlassSurface } from '@/components';
import { TEXT_SCALE_LABELS } from '@/types/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/design/tokens';

function PreviewCard() {
  const ds = useScaledStyles();

  return (
    <GlassSurface
      intensity="subtle"
      blurred={false}
      style={{
        marginHorizontal: glassSpacing.screen,
        borderRadius: glassRadii.surface,
      }}
    >
      <View style={{ padding: ds.cardPad }}>
        <Text
          style={{
            fontSize: ds.fontSize(11),
            fontWeight: '700',
            color: glassColors.textSecondary,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Live Preview
        </Text>

        <View
          style={{
            marginTop: ds.spacing(12),
            borderRadius: glassRadii.surface,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
            backgroundColor: glassColors.mediumFill,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              paddingHorizontal: ds.spacing(14),
              paddingVertical: ds.spacing(12),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
              <Text
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
                numberOfLines={1}
              >
                Atlantic Salmon
              </Text>
              <View
                style={{
                  marginTop: ds.spacing(6),
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    paddingHorizontal: ds.spacing(8),
                    paddingVertical: ds.spacing(3),
                    borderRadius: glassRadii.tag,
                    backgroundColor: colors.errorBg,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '600',
                      color: colors.error,
                    }}
                  >
                    Fish & Seafood
                  </Text>
                </View>
                <Text
                  style={{
                    marginLeft: ds.spacing(8),
                    fontSize: ds.fontSize(12),
                    color: glassColors.textSecondary,
                  }}
                >
                  10 lb/case
                </Text>
              </View>
            </View>
            <TouchableOpacity
              activeOpacity={0.82}
              style={{
                minWidth: ds.spacing(72),
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(9),
                borderRadius: glassRadii.button,
                backgroundColor: glassColors.accent,
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: ds.buttonFont,
                  fontWeight: '700',
                  color: glassColors.textOnPrimary,
                }}
              >
                Add
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text
          style={{
            marginTop: ds.spacing(10),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
            lineHeight: ds.fontSize(16),
          }}
        >
          The preview updates with your text scale, spacing, and button-size
          choices so the rest of the app stays readable and balanced.
        </Text>
      </View>
    </GlassSurface>
  );
}

function DisplaySection() {
  const {
    textScale,
    setTextScale,
    uiScale,
    setUIScale,
    buttonSize,
    setButtonSize,
    hapticFeedback,
    setHapticFeedback,
    reduceMotion,
    setReduceMotion,
    resetToDefaults,
  } = useDisplayStore();
  const ds = useScaledStyles();

  const handleReset = () => {
    Alert.alert(
      'Reset display settings?',
      'Restore the current display and accessibility preferences to their defaults.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: resetToDefaults,
        },
      ],
    );
  };

  return (
    <>
      <PreviewCard />

      <SettingsSectionLabel
        label="Typography"
        description="Choose the reading scale that feels most comfortable across the app."
      />
      <SettingsGroup>
        <View style={{ padding: ds.spacing(16) }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
              marginBottom: ds.spacing(12),
            }}
          >
            Text Size
          </Text>
          <MultiOptionToggle
            options={TEXT_SCALE_LABELS.map((label, index) => ({
              label,
              value: [0.8, 0.9, 1.0, 1.1, 1.4][index] as
                | 0.8
                | 0.9
                | 1.0
                | 1.1
                | 1.4,
            }))}
            value={textScale}
            onValueChange={setTextScale}
          />
          <Text
            style={{
              marginTop: ds.spacing(10),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
          >
            Preview: The quick brown fox jumps over the lazy dog.
          </Text>
        </View>
      </SettingsGroup>

      <SettingsSectionLabel
        label="Layout"
        description="Adjust density and control size while staying inside the refined Babytuna layout system."
      />
      <SettingsGroup>
        <View style={{ padding: ds.spacing(16) }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
              marginBottom: ds.spacing(12),
            }}
          >
            UI Scale
          </Text>
          <MultiOptionToggle
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large', disabled: true },
            ]}
            value={uiScale}
            onValueChange={setUIScale}
          />

          <Text
            style={{
              marginTop: ds.spacing(10),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
          >
            Large UI scale is unavailable on the current screen size.
          </Text>

          <View
            style={{
              height: glassHairlineWidth,
              backgroundColor: glassColors.divider,
              marginVertical: ds.spacing(16),
            }}
          />

          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
              marginBottom: ds.spacing(12),
            }}
          >
            Button Size
          </Text>
          <MultiOptionToggle
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large', disabled: true },
            ]}
            value={buttonSize}
            onValueChange={setButtonSize}
          />

          <View
            style={{
              marginTop: ds.spacing(16),
              alignItems: 'center',
            }}
          >
            <TouchableOpacity
              activeOpacity={0.82}
              style={{
                minHeight: ds.buttonH,
                paddingHorizontal: ds.buttonPadH + ds.spacing(6),
                borderRadius: glassRadii.button,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.accent,
              }}
            >
              <Text
                style={{
                  fontSize: ds.buttonFont,
                  fontWeight: '700',
                  color: glassColors.textOnPrimary,
                }}
              >
                Sample Button
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SettingsGroup>

      <SettingsSectionLabel
        label="Accessibility"
        description="Keep feedback readable and intentional without adding noise to navigation."
      />
      <SettingsGroup>
        <SettingToggle
          title="Haptic Feedback"
          subtitle="Allow vibration on meaningful actions outside the quiet settings flow."
          value={hapticFeedback}
          onValueChange={setHapticFeedback}
        />
        <SettingToggle
          title="Reduce Motion"
          subtitle="Minimize page and control animations when supported."
          value={reduceMotion}
          onValueChange={setReduceMotion}
          showBorder={false}
        />
      </SettingsGroup>

      <TouchableOpacity
        onPress={handleReset}
        activeOpacity={0.82}
        style={{
          marginHorizontal: glassSpacing.screen,
          marginTop: ds.spacing(18),
          minHeight: Math.max(48, ds.buttonH),
          borderRadius: glassRadii.button,
          borderWidth: glassHairlineWidth,
          borderColor: 'rgba(239, 68, 68, 0.14)',
          backgroundColor: glassColors.dangerSoft,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name="refresh-outline"
          size={ds.icon(18)}
          color={glassColors.dangerText}
        />
        <Text
          style={{
            marginLeft: ds.spacing(8),
            fontSize: ds.fontSize(15),
            fontWeight: '700',
            color: glassColors.dangerText,
          }}
        >
          Reset to Defaults
        </Text>
      </TouchableOpacity>
    </>
  );
}

export default function DisplayAccessibilitySettingsScreen() {
  return (
    <SettingsScreenLayout title="Display">
      <DisplaySection />
    </SettingsScreenLayout>
  );
}
