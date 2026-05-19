import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string;
  onRetry?: () => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn('[ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>
            {this.props.title ?? 'Something went wrong'}
          </Text>
          <Text style={styles.message}>
            This screen hit an unexpected error. Try again or go back and reopen
            it.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={this.handleRetry}
            style={({ pressed }) => [
              styles.retryButton,
              { opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0,
  },
  message: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0,
  },
  retryButton: {
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  retryText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
