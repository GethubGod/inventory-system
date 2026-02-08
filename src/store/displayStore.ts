import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PixelRatio } from 'react-native';
import type { TextScale, UIScale, ButtonSize, Theme } from '@/types/settings';

// Multiplier lookup tables
const UI_FONT_MULTIPLIER: Record<UIScale, number> = {
  compact: 0.9,
  default: 1.0,
  large: 1.15,
};

const SPACING_MULTIPLIER: Record<UIScale, number> = {
  compact: 0.85,
  default: 1.0,
  large: 1.2,
};

const RADIUS_MULTIPLIER: Record<UIScale, number> = {
  compact: 0.9,
  default: 1.0,
  large: 1.1,
};

const ICON_MULTIPLIER: Record<UIScale, number> = {
  compact: 1.0,
  default: 1.0,
  large: 1.2,
};

const BUTTON_HEIGHT: Record<ButtonSize, number> = {
  small: 40,
  medium: 48,
  large: 58,
};

const BUTTON_FONT: Record<ButtonSize, number> = {
  small: 13,
  medium: 15,
  large: 18,
};

const BUTTON_PADDING_H: Record<ButtonSize, number> = {
  small: 12,
  medium: 16,
  large: 22,
};

const CARD_PADDING: Record<UIScale, number> = {
  compact: 12,
  default: 16,
  large: 22,
};

const ITEM_ROW_HEIGHT: Record<UIScale, number> = {
  compact: 56,
  default: 68,
  large: 84,
};

interface DisplayState {
  // Raw settings
  textScale: TextScale;
  uiScale: UIScale;
  buttonSize: ButtonSize;
  theme: Theme;
  hapticFeedback: boolean;
  reduceMotion: boolean;

  // Setters
  setTextScale: (scale: TextScale) => void;
  setUIScale: (scale: UIScale) => void;
  setButtonSize: (size: ButtonSize) => void;
  setTheme: (theme: Theme) => void;
  setHapticFeedback: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;
  resetToDefaults: () => void;

  // Computed scaling functions
  scaledFontSize: (basePx: number) => number;
  scaledSpacing: (basePx: number) => number;
  scaledRadius: (basePx: number) => number;
  iconSize: (baseSize: number) => number;

  // Computed fixed values
  buttonHeight: () => number;
  buttonFontSize: () => number;
  buttonPaddingH: () => number;
  cardPadding: () => number;
  itemRowHeight: () => number;
}

const DEFAULT_STATE = {
  textScale: 1.0 as TextScale,
  uiScale: 'default' as UIScale,
  buttonSize: 'medium' as ButtonSize,
  theme: 'system' as Theme,
  hapticFeedback: true,
  reduceMotion: false,
};

export const useDisplayStore = create<DisplayState>()(
  persist(
    (set, get) => {
      // Helper to compute font size with system Dynamic Type integration
      const computeScaledFont = (basePx: number): number => {
        const { textScale, uiScale } = get();
        const systemScale = PixelRatio.getFontScale();
        const combinedTextScale = Math.min(textScale * systemScale, 2.0);
        const uiMult = UI_FONT_MULTIPLIER[uiScale];
        const raw = basePx * combinedTextScale * uiMult;
        const max = basePx > 20 ? 36 : 24;
        return Math.round(Math.max(10, Math.min(raw, max)));
      };

      const computeScaledSpacing = (basePx: number): number => {
        const { uiScale } = get();
        return Math.round(basePx * SPACING_MULTIPLIER[uiScale]);
      };

      const computeScaledRadius = (basePx: number): number => {
        const { uiScale } = get();
        return Math.round(basePx * RADIUS_MULTIPLIER[uiScale]);
      };

      const computeIconSize = (baseSize: number): number => {
        const { uiScale } = get();
        return Math.round(baseSize * ICON_MULTIPLIER[uiScale]);
      };

      return {
        ...DEFAULT_STATE,

        // Setters
        setTextScale: (textScale) => set({ textScale }),
        setUIScale: (uiScale) => set({ uiScale }),
        setButtonSize: (buttonSize) => set({ buttonSize }),
        setTheme: (theme) => set({ theme }),
        setHapticFeedback: (hapticFeedback) => set({ hapticFeedback }),
        setReduceMotion: (reduceMotion) => set({ reduceMotion }),
        resetToDefaults: () => set(DEFAULT_STATE),

        // Computed scaling functions
        scaledFontSize: computeScaledFont,
        scaledSpacing: computeScaledSpacing,
        scaledRadius: computeScaledRadius,
        iconSize: computeIconSize,

        // Computed fixed values
        buttonHeight: () => Math.min(BUTTON_HEIGHT[get().buttonSize], 64),
        buttonFontSize: () => BUTTON_FONT[get().buttonSize],
        buttonPaddingH: () => BUTTON_PADDING_H[get().buttonSize],
        cardPadding: () => CARD_PADDING[get().uiScale],
        itemRowHeight: () => ITEM_ROW_HEIGHT[get().uiScale],
      };
    },
    {
      name: 'display-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        textScale: state.textScale,
        uiScale: state.uiScale,
        buttonSize: state.buttonSize,
        theme: state.theme,
        hapticFeedback: state.hapticFeedback,
        reduceMotion: state.reduceMotion,
      }),
    }
  )
);
