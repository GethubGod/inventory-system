import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import {
  GlassSurface,
  StackScreenHeader,
} from '@/components';
import { SettingsSectionLabel } from '@/components/settings';
import { useSettingsNavigationContext } from '@/hooks/useSettingsBackRoute';
import { useSettingsStore } from '@/store';
import { DEFAULT_EXPORT_FORMAT_SETTINGS } from '@/types/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/design/tokens';

export default function ExportFormatSettingsScreen() {
  const ds = useScaledStyles();
  const { exportFormat, setExportFormat } = useSettingsStore();
  const { backTo, hasExplicitBackTo } = useSettingsNavigationContext('manager');
  const [template, setTemplate] = useState(exportFormat.template);

  const navigateBack = () => {
    if (hasExplicitBackTo) {
      router.replace(backTo);
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(backTo);
  };

  const handleSave = () => {
    setExportFormat({ template });
    navigateBack();
  };

  const handleReset = () => {
    Alert.alert(
      'Reset format',
      'Reset the message template to the default format?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => setTemplate(DEFAULT_EXPORT_FORMAT_SETTINGS.template),
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ManagerScaleContainer>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={{ backgroundColor: glassColors.background }}>
            <StackScreenHeader
              title="Export Format"
              subtitle="Keep the supplier message template aligned with the rest of the manager workflow."
              right={
                <TouchableOpacity
                  onPress={handleReset}
                  activeOpacity={0.82}
                  style={{
                    minHeight: 36,
                    paddingHorizontal: ds.spacing(12),
                    borderRadius: glassRadii.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.mediumFill,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '700',
                      color: glassColors.dangerText,
                    }}
                  >
                    Reset
                  </Text>
                </TouchableOpacity>
              }
            />
          </View>

          <View style={{ flex: 1 }}>
            <SettingsSectionLabel
              label="Template"
              description="Edit the supplier export text without dropping into a separate styling system."
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
              <Text
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                Supplier message
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(6),
                  fontSize: ds.fontSize(13),
                  lineHeight: ds.fontSize(18),
                  color: glassColors.textSecondary,
                }}
              >
                Use placeholders to keep exports consistent while still matching
                the current Babytuna workflow.
              </Text>

              <TextInput
                value={template}
                onChangeText={setTemplate}
                multiline
                numberOfLines={12}
                textAlignVertical="top"
                placeholder="Write the export template"
                placeholderTextColor={glassColors.textMuted}
                style={{
                  marginTop: ds.spacing(14),
                  minHeight: 240,
                  borderRadius: glassRadii.surface,
                  borderWidth: glassHairlineWidth,
                  borderColor: glassColors.controlBorder,
                  backgroundColor: glassColors.mediumFill,
                  paddingHorizontal: ds.spacing(14),
                  paddingVertical: ds.spacing(14),
                  fontSize: ds.fontSize(14),
                  lineHeight: ds.fontSize(20),
                  color: glassColors.textPrimary,
                }}
              />
            </GlassSurface>

            <SettingsSectionLabel
              label="Placeholders"
              description="These values are inserted automatically when the export message is generated."
            />

            <GlassSurface
              intensity="subtle"
              blurred={false}
              style={{
                marginHorizontal: glassSpacing.screen,
                borderRadius: glassRadii.surface,
                overflow: 'hidden',
              }}
            >
              {[
                '{{supplier}} - Supplier name',
                '{{date}} - Current date',
                '{{items}} - Item list',
              ].map((entry, index, items) => (
                <View
                  key={entry}
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(14),
                    borderBottomWidth:
                      index < items.length - 1 ? glassHairlineWidth : 0,
                    borderBottomColor: glassColors.divider,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      color: glassColors.textPrimary,
                    }}
                  >
                    {entry}
                  </Text>
                </View>
              ))}
            </GlassSurface>
          </View>

          <View
            style={{
              paddingHorizontal: glassSpacing.screen,
              paddingTop: ds.spacing(14),
              paddingBottom: ds.spacing(20),
              backgroundColor: glassColors.background,
            }}
          >
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.82}
              style={{
                minHeight: Math.max(48, ds.buttonH),
                borderRadius: glassRadii.button,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                backgroundColor: glassColors.accent,
              }}
            >
              <Ionicons
                name="save-outline"
                size={ds.icon(18)}
                color={glassColors.textOnPrimary}
              />
              <Text
                style={{
                  marginLeft: ds.spacing(8),
                  fontSize: ds.fontSize(15),
                  fontWeight: '700',
                  color: glassColors.textOnPrimary,
                }}
              >
                Save Format
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
