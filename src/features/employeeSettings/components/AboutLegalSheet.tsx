import React from 'react';
import { Alert, Linking, Text } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { tipsTheme } from '@/theme/design';
import { PRIVACY_URL, SUPPORT_URL, TERMS_URL } from '@/features/auth/legal';
import { SettingsCard, SettingsCardRow } from './SettingsCardRow';

/**
 * About and legal: privacy policy, terms, open-source licenses, contact
 * support, app version. App Store compliance set — every row works.
 */

export async function openExternalUrl(url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open the link', url);
  }
}

interface AboutLegalSheetProps {
  visible: boolean;
  onClose: () => void;
  onShowLicenses: () => void;
}

export function AboutLegalSheet({ visible, onClose, onShowLicenses }: AboutLegalSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
        About and legal
      </Text>
      <Text
        style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
      >
        Smelter {appVersion}
      </Text>

      <SettingsCard>
        <SettingsCardRow
          icon="shield-checkmark-outline"
          title="Privacy policy"
          onPress={() => void openExternalUrl(PRIVACY_URL)}
        />
        <SettingsCardRow
          icon="receipt-outline"
          title="Terms of service"
          onPress={() => void openExternalUrl(TERMS_URL)}
        />
        <SettingsCardRow
          icon="document-text-outline"
          title="Open-source licenses"
          onPress={onShowLicenses}
        />
        <SettingsCardRow
          icon="help-circle-outline"
          title="Contact support"
          onPress={() => void openExternalUrl(SUPPORT_URL)}
          isLast
        />
      </SettingsCard>
    </BottomSheetShell>
  );
}

const LICENSED_PACKAGES: { name: string; license: string }[] = [
  { name: 'React & React Native', license: 'MIT License · Meta Platforms, Inc.' },
  { name: 'Expo SDK & Expo Router', license: 'MIT License · 650 Industries, Inc.' },
  { name: 'Supabase JS', license: 'MIT License · Supabase, Inc.' },
  { name: 'Zustand', license: 'MIT License · Poimandres' },
  { name: 'React Native Reanimated', license: 'MIT License · Software Mansion' },
  { name: 'React Navigation', license: 'MIT License · React Navigation contributors' },
  { name: 'Ionicons (@expo/vector-icons)', license: 'MIT License · Ionic' },
  { name: 'react-native-safe-area-context', license: 'MIT License · Th3rd Wave' },
  { name: 'react-native-svg', license: 'MIT License · Software Mansion' },
  { name: 'AsyncStorage', license: 'MIT License · React Native Community' },
];

interface LicensesSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function LicensesSheet({ visible, onClose }: LicensesSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
        Open-source licenses
      </Text>
      <Text
        style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
      >
        This app is built with open-source software, including:
      </Text>

      <SettingsCard>
        {LICENSED_PACKAGES.map((pkg, index) => (
          <SettingsCardRow
            key={pkg.name}
            icon="cube-outline"
            title={pkg.name}
            subtitle={pkg.license}
            isLast={index === LICENSED_PACKAGES.length - 1}
            showChevron={false}
          />
        ))}
      </SettingsCard>

      <Text
        style={{
          fontSize: ds.fontSize(11.5),
          color: tipsTheme.ink3,
          marginTop: ds.spacing(10),
        }}
      >
        Plus other MIT-licensed packages listed in the app{'\u2019'}s package manifest.
        License texts are available from each project{'\u2019'}s repository.
      </Text>
    </BottomSheetShell>
  );
}
