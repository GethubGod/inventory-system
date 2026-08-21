import type { ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { authTheme } from '@/theme/design';
import { LegalFooter } from './LegalFooter';

interface AuthScreenShellProps {
  children: ReactNode;
  /** The Ready screen omits the footer, matching the flow spec. */
  showLegalFooter?: boolean;
}

/** Black full-bleed shell shared by the onboarding/auth screens. */
export function AuthScreenShell({ children, showLegalFooter = true }: AuthScreenShellProps) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: authTheme.background }}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: authTheme.background }}
      >
        <Pressable
          style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16 }}
          onPress={Keyboard.dismiss}
          accessible={false}
        >
          {children}
        </Pressable>
        {showLegalFooter ? <LegalFooter /> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
