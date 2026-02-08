import { useDisplayStore } from '@/store/displayStore';

export function useScaledStyles() {
  const store = useDisplayStore();

  return {
    // Scaling functions
    fontSize: store.scaledFontSize,
    spacing: store.scaledSpacing,
    radius: store.scaledRadius,
    icon: store.iconSize,

    // Button values
    buttonH: store.buttonHeight(),
    buttonFont: store.buttonFontSize(),
    buttonPadH: store.buttonPaddingH(),

    // Layout values
    cardPad: store.cardPadding(),
    rowH: store.itemRowHeight(),

    // Raw values for direct access
    textScale: store.textScale,
    isLarge: store.uiScale === 'large',
    isCompact: store.uiScale === 'compact',
    reduceMotion: store.reduceMotion,
    theme: store.theme,
  };
}
