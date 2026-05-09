import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  LinearTransition,
} from 'react-native-reanimated';
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';
import type { UnitType } from '@/types';
import type { StockCheckItem } from '../types';
import {
  computeNeedToOrder,
  findUnitOptionIndex,
  formatParSubtitle,
  getUnitOptionsForItem,
  type UnitOption,
} from '../utils/stockMath';
import {
  WheelPickerGroup,
  type WheelPickerOption,
} from './wheel-picker';

/* ──────────────────────────────────────────────────────────────────────────
 * Types & ref API
 * ──────────────────────────────────────────────────────────────────────── */

export interface SetStockBottomSheetRef {
  /** Imperative open. Idempotent — calling twice while open is a no-op. */
  present: () => void;
  /** Imperative close (animates). */
  dismiss: () => void;
}

export interface SetStockBottomSheetProps {
  /** Active item. When `null`, the sheet renders an empty/skeleton body
   *  so it can stay mounted (avoids tear-down/recreation on every open). */
  item: StockCheckItem | null;
  /**
   * Fired by the "Done" button. Parent owns persistence (we never write to
   * the store from inside this component).
   */
  onCommit: (
    itemId: string,
    entry: { stockUnit: UnitType; stockAmount: number; stockPieces: number },
    noteText: string,
  ) => void;
  /**
   * Fired whenever the sheet is dismissed (drag, scrim, X close, or
   * post-commit auto-dismiss). Parent uses this to clear the active-id
   * state that drives the row's red outline.
   */
  onDismiss: () => void;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Constants
 * ──────────────────────────────────────────────────────────────────────── */

const AMOUNT_MAX = 99;
const PIECES_MAX = 99;

/** Wheel row height — must match `WheelPickerGroup`'s default. */
const WHEEL_ROW_HEIGHT = 40;
/** Visible rows above + below the band. 2 → 5 rows total. */
const WHEEL_VISIBLE_RANGE = 2;

/**
 * Snap points: ~60% default (just enough for header + wheels + summary +
 * Done) and ~92% expanded (when the user taps "Note" to reveal the input).
 * Index 0 = collapsed (notes hidden), Index 1 = expanded (notes visible).
 */
const SNAP_POINTS = ['60%', '92%'] as const;

/** Quick-suggestion chips relocated from the legacy InlineNoteEditor. */
const QUICK_NOTE_SUGGESTIONS = [
  'Extra for weekend',
  'Use backup supplier',
  'Quality issue last time',
  'Chef requested',
  'Running low',
] as const;

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers (pure)
 * ──────────────────────────────────────────────────────────────────────── */

function buildIntegerWheelOptions(
  max: number,
): WheelPickerOption<number>[] {
  const out: WheelPickerOption<number>[] = new Array(max + 1);
  for (let i = 0; i <= max; i++) {
    out[i] = { key: String(i), label: String(i), value: i };
  }
  return out;
}

function buildUnitWheelOptions(
  options: UnitOption[],
): WheelPickerOption<UnitType>[] {
  return options.map((o) => ({ key: o.key, label: o.label, value: o.key }));
}

function clampWheelInteger(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  if (i < 0) return 0;
  if (i > max) return max;
  return i;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Compact icon button — used for the X close + the Note toggle. The pill-
 * shaped Cancel button has been removed (per Phase 1 condensation spec).
 * ──────────────────────────────────────────────────────────────────────── */

interface IconCircleButtonProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  accessibilityLabel: string;
  /** When true, button paints in the accent tint (used for "note attached"). */
  accent?: boolean;
}

const IconCircleButton = memo(function IconCircleButton({
  icon,
  onPress,
  accessibilityLabel,
  accent,
}: IconCircleButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={6}
      style={{
        width: 34,
        height: 34,
        borderRadius: glassRadii.round,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? 'rgba(232, 80, 58, 0.14)' : grayScale[100],
      }}
    >
      <Ionicons
        name={icon}
        size={18}
        color={accent ? glassColors.accent : glassColors.textPrimary}
      />
    </TouchableOpacity>
  );
});

/* ──────────────────────────────────────────────────────────────────────────
 * Memoized chip — keeps the suggestions row from re-rendering on every keystroke
 * ──────────────────────────────────────────────────────────────────────── */

const QuickNoteChip = memo(function QuickNoteChip({
  label,
  onPress,
}: {
  label: string;
  onPress: (label: string) => void;
}) {
  const ds = useScaledStyles();
  const handlePress = useCallback(() => onPress(label), [label, onPress]);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Add quick note: ${label}`}
      onPress={handlePress}
      activeOpacity={0.85}
      style={{
        paddingHorizontal: ds.spacing(12),
        paddingVertical: ds.spacing(6),
        borderRadius: glassRadii.pill,
        backgroundColor: colors.white,
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
      }}
    >
      <Text
        style={{
          fontSize: ds.fontSize(12),
          fontWeight: '600',
          color: glassColors.textPrimary,
        }}
        numberOfLines={1}
      >
        + {label}
      </Text>
    </TouchableOpacity>
  );
});

/* ──────────────────────────────────────────────────────────────────────────
 * SetStockBottomSheet
 * ──────────────────────────────────────────────────────────────────────── */

function SetStockBottomSheetImpl(
  { item, onCommit, onDismiss }: SetStockBottomSheetProps,
  ref: React.Ref<SetStockBottomSheetRef>,
) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const modalRef = useRef<BottomSheetModal>(null);

  /* ── Imperative ref API ────────────────────────────────────────────── */

  useImperativeHandle(
    ref,
    () => ({
      present: () => {
        modalRef.current?.present();
      },
      dismiss: () => {
        modalRef.current?.dismiss();
      },
    }),
    [],
  );

  /* ── Snap-point management ─────────────────────────────────────────── */

  const snapPoints = useMemo(() => SNAP_POINTS as unknown as string[], []);

  /**
   * Tracks the currently-active snap index so the Note section knows when
   * to render. Source of truth is gorhom's `onChange` — both manual drags
   * and our own `snapToIndex` calls flow through it, keeping the toggle
   * state always in sync with the visible sheet height.
   */
  const [snapIndex, setSnapIndex] = useState(0);
  const noteOpen = snapIndex >= 1;

  const handleSheetChange = useCallback((index: number) => {
    // gorhom emits -1 on dismiss; ignore — onDismiss handles teardown.
    if (index < 0) return;
    setSnapIndex(index);
  }, []);

  /* ── Backdrop ──────────────────────────────────────────────────────── */

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.42}
        pressBehavior="close"
      />
    ),
    [],
  );

  /* ── Wheel option lists ────────────────────────────────────────────── */

  const unitOptions: UnitOption[] = useMemo(
    () =>
      item
        ? getUnitOptionsForItem(item)
        : [{ key: 'pack', label: '' }],
    [item],
  );
  const unitWheelOptions = useMemo(
    () => buildUnitWheelOptions(unitOptions),
    [unitOptions],
  );
  // Wheel option arrays are stable across the entire app session — caching
  // outside the component would also work, but `useMemo([])` is plenty.
  const amountWheelOptions = useMemo(
    () => buildIntegerWheelOptions(AMOUNT_MAX),
    [],
  );
  const piecesWheelOptions = useMemo(
    () => buildIntegerWheelOptions(PIECES_MAX),
    [],
  );

  /* ── Transient sheet-local state ───────────────────────────────────────
   * The sheet keeps a *draft* of the wheel triple + note text. We only
   * write back to the store on commit, so X / drag-dismiss naturally
   * discards changes. With Phase 6's settle-only wheel architecture,
   * these state setters fire AT MOST once per wheel gesture (not per row
   * crossed) — so the sheet renders are cheap and the wheels stay glassy.
   * ─────────────────────────────────────────────────────────────────── */

  const [stockUnit, setStockUnit] = useState<UnitType>('pack');
  const [stockAmount, setStockAmount] = useState(0);
  const [stockPieces, setStockPieces] = useState(0);
  const [noteDraft, setNoteDraft] = useState('');

  /**
   * Reset the draft state whenever the parent provides a different item.
   * Also force the sheet back to its collapsed snap so a previous note
   * expansion doesn't carry into a fresh row's session.
   */
  useEffect(() => {
    if (!item) return;
    setStockUnit(item.stockUnit);
    setStockAmount(clampWheelInteger(item.stockAmount, AMOUNT_MAX));
    setStockPieces(clampWheelInteger(item.stockPieces, PIECES_MAX));
    setNoteDraft(item.noteText ?? '');
    // Snap back to compact view on every new item — keeps muscle memory
    // consistent (the sheet always starts the same way).
    modalRef.current?.snapToIndex(0);
  }, [item]);

  /* ── Indices for the wheel pickers ─────────────────────────────────── */

  const unitIndex = useMemo(
    () => findUnitOptionIndex(unitOptions, stockUnit),
    [stockUnit, unitOptions],
  );

  const handleUnitIndexChange = useCallback(
    (next: number) => {
      const opt = unitOptions[next];
      if (!opt) return;
      setStockUnit(opt.key);
    },
    [unitOptions],
  );

  const handleAmountIndexChange = useCallback((next: number) => {
    setStockAmount(clampWheelInteger(next, AMOUNT_MAX));
  }, []);

  const handlePiecesIndexChange = useCallback((next: number) => {
    setStockPieces(clampWheelInteger(next, PIECES_MAX));
  }, []);

  /* ── Live derived values for the Summary box ───────────────────────── */

  const liveStockLabel = useMemo(() => {
    if (!item) return '';
    const opt = unitOptions[unitIndex];
    const unitLabel = opt?.label ?? '';
    const head = `${stockAmount} ${unitLabel}`.trim();
    if (stockPieces > 0) {
      return `${head} · ${stockPieces} pcs`;
    }
    return head;
  }, [item, stockAmount, stockPieces, unitIndex, unitOptions]);

  const liveNeedToOrder = useMemo(() => {
    if (!item) return 0;
    return computeNeedToOrder({
      parLevel: item.parLevel,
      unitType: item.unitType,
      packSize: item.packSize,
      stockUnit,
      stockAmount,
      stockPieces,
    });
  }, [item, stockAmount, stockPieces, stockUnit]);

  const parSubtitle = useMemo(
    () => (item ? formatParSubtitle(item) : ''),
    [item],
  );

  /* ── Note interactions ─────────────────────────────────────────────── */

  const handleAppendNote = useCallback((suggestion: string) => {
    setNoteDraft((prev) => {
      if (prev.trim().length === 0) return suggestion;
      const needsSpace = !/\s$/.test(prev);
      return `${prev}${needsSpace ? ' ' : ''}${suggestion}`;
    });
  }, []);

  /**
   * Toggle that drives the "expand for note" / "collapse" snap animation.
   * Both directions go through `snapToIndex`, so the sheet's own
   * `onChange` keeps `snapIndex` (and therefore `noteOpen`) in sync.
   */
  const handleToggleNote = useCallback(() => {
    if (snapIndex >= 1) {
      modalRef.current?.snapToIndex(0);
    } else {
      modalRef.current?.snapToIndex(1);
    }
  }, [snapIndex]);

  /* ── Footer / actions ──────────────────────────────────────────────── */

  const handleCancel = useCallback(() => {
    modalRef.current?.dismiss();
  }, []);

  const handleDone = useCallback(() => {
    if (!item) return;
    onCommit(
      item.id,
      {
        stockUnit,
        stockAmount: clampWheelInteger(stockAmount, AMOUNT_MAX),
        stockPieces: clampWheelInteger(stockPieces, PIECES_MAX),
      },
      noteDraft,
    );
  }, [item, noteDraft, onCommit, stockAmount, stockPieces, stockUnit]);

  /* ── Layout ────────────────────────────────────────────────────────── */

  // Pinned-footer offset against the safe-area inset.
  const footerBottomInset = Math.max(insets.bottom, ds.spacing(10));
  const footerHeight = ds.spacing(54);
  const scrollPaddingBottom = footerHeight + footerBottomInset + ds.spacing(8);

  /* Whether the user has dialed in any stock or note edits — used as a
   * conservative dirty-check for accessibility hints on the X close. */
  const isDirty =
    !!item &&
    (item.stockUnit !== stockUnit ||
      item.stockAmount !== stockAmount ||
      item.stockPieces !== stockPieces ||
      (item.noteText ?? '') !== noteDraft);

  return (
    <BottomSheetModal
      ref={modalRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onDismiss={onDismiss}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : 'extend'}
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleIndicatorStyle={{
        backgroundColor: grayScale[300],
        width: 38,
        height: 4,
      }}
      backgroundStyle={{
        backgroundColor: colors.white,
        borderTopLeftRadius: glassRadii.surface + 4,
        borderTopRightRadius: glassRadii.surface + 4,
      }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {!item ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: ds.spacing(20),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
              }}
            >
              No item selected.
            </Text>
          </View>
        ) : (
          <>
            <BottomSheetScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: ds.spacing(20),
                // Tight top — the drag indicator already provides visual
                // breathing room, no need for an extra 8-12pt gap.
                paddingTop: ds.spacing(2),
                paddingBottom: scrollPaddingBottom,
              }}
            >
              {/* ── Header ───────────────────────────────────────────
                  Compact: title block on the left, two small icon buttons
                  on the right (Note toggle + X close). Replaces the
                  bulky "Cancel" pill from Phase 5. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  marginBottom: ds.spacing(10),
                }}
              >
                <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '700',
                      letterSpacing: 1.2,
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                    }}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    style={{
                      marginTop: ds.spacing(2),
                      fontSize: ds.fontSize(20),
                      fontWeight: '800',
                      color: glassColors.textPrimary,
                    }}
                    numberOfLines={1}
                  >
                    Set stock
                  </Text>
                  <Text
                    style={{
                      marginTop: ds.spacing(2),
                      fontSize: ds.fontSize(12),
                      color: glassColors.textSecondary,
                    }}
                    numberOfLines={1}
                  >
                    {parSubtitle}
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: ds.spacing(8),
                  }}
                >
                  <IconCircleButton
                    icon={
                      noteOpen
                        ? 'document-text'
                        : item.hasNote
                          ? 'document-text-outline'
                          : 'create-outline'
                    }
                    onPress={handleToggleNote}
                    accent={noteOpen || item.hasNote}
                    accessibilityLabel={
                      noteOpen
                        ? 'Hide note'
                        : item.hasNote
                          ? 'Edit note'
                          : 'Add note'
                    }
                  />
                  <IconCircleButton
                    icon="close"
                    onPress={handleCancel}
                    accessibilityLabel={
                      isDirty
                        ? 'Cancel and discard wheel changes'
                        : 'Close'
                    }
                  />
                </View>
              </View>

              {/* ── Wheel pickers ──────────────────────────────────── */}
              <WheelPickerGroup
                itemHeight={WHEEL_ROW_HEIGHT}
                visibleRange={WHEEL_VISIBLE_RANGE}
                unitLabel="Unit"
                unitOptions={unitWheelOptions}
                unitIndex={unitIndex}
                onUnitIndexChange={handleUnitIndexChange}
                amountLabel="Amount"
                amountOptions={amountWheelOptions}
                amountIndex={clampWheelInteger(stockAmount, AMOUNT_MAX)}
                onAmountIndexChange={handleAmountIndexChange}
                piecesLabel="Pieces"
                piecesOptions={piecesWheelOptions}
                piecesIndex={clampWheelInteger(stockPieces, PIECES_MAX)}
                onPiecesIndexChange={handlePiecesIndexChange}
              />

              {/* ── Note section (revealed only at expanded snap) ──── */}
              {noteOpen ? (
                <Animated.View
                  // Smooth enter/exit so the panel doesn't pop on snap.
                  // The sheet's own height animation runs in parallel —
                  // these layout transitions stay in lockstep with it.
                  entering={FadeInUp.duration(200).easing(
                    Easing.bezier(0.2, 0, 0.2, 1).factory(),
                  )}
                  exiting={FadeOutUp.duration(140).easing(
                    Easing.bezier(0.4, 0, 0.6, 1).factory(),
                  )}
                  layout={LinearTransition.duration(200)}
                  style={{ marginTop: ds.spacing(14) }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '700',
                      letterSpacing: 1.0,
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                      marginBottom: ds.spacing(6),
                    }}
                  >
                    Add a note
                  </Text>

                  <BottomSheetTextInput
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    placeholder="Bump up — chef expecting big weekend rush"
                    placeholderTextColor={glassColors.textMuted}
                    multiline
                    textAlignVertical="top"
                    style={{
                      minHeight: 52,
                      maxHeight: 96,
                      backgroundColor: grayScale[100],
                      borderRadius: glassRadii.surface,
                      paddingHorizontal: ds.spacing(12),
                      paddingVertical: ds.spacing(10),
                      fontSize: ds.fontSize(14),
                      color: glassColors.textPrimary,
                    }}
                  />

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={{
                      gap: ds.spacing(6),
                      paddingTop: ds.spacing(8),
                    }}
                  >
                    {QUICK_NOTE_SUGGESTIONS.map((s) => (
                      <QuickNoteChip
                        key={s}
                        label={s}
                        onPress={handleAppendNote}
                      />
                    ))}
                  </ScrollView>
                </Animated.View>
              ) : null}

              {/* ── Summary box ────────────────────────────────────── */}
              <View
                style={{
                  marginTop: ds.spacing(14),
                  paddingHorizontal: ds.spacing(14),
                  paddingVertical: ds.spacing(12),
                  borderRadius: glassRadii.surface,
                  backgroundColor: 'rgba(232, 80, 58, 0.06)',
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(10),
                      fontWeight: '700',
                      letterSpacing: 1.4,
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                    }}
                  >
                    Stock
                  </Text>
                  <Text
                    style={{
                      marginTop: ds.spacing(2),
                      fontSize: ds.fontSize(17),
                      fontWeight: '800',
                      color: glassColors.textPrimary,
                    }}
                    numberOfLines={1}
                  >
                    {liveStockLabel}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(10),
                      fontWeight: '700',
                      letterSpacing: 1.4,
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                    }}
                  >
                    Need to order
                  </Text>
                  <Text
                    style={{
                      marginTop: ds.spacing(2),
                      fontSize: ds.fontSize(17),
                      fontWeight: '800',
                      color: glassColors.accent,
                    }}
                  >
                    {liveNeedToOrder}
                  </Text>
                </View>
              </View>
            </BottomSheetScrollView>

            {/* ── Pinned Done CTA ─────────────────────────────────────
                Anchored to the absolute bottom of the sheet (just above
                the safe-area inset). The scroll content's
                `paddingBottom` clears the button's footprint, so wheel
                rows + summary are never occluded. */}
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                paddingHorizontal: ds.spacing(20),
                paddingBottom: footerBottomInset,
                paddingTop: ds.spacing(8),
                backgroundColor: colors.white,
              }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save stock and close"
                onPress={handleDone}
                activeOpacity={0.9}
                style={{
                  height: footerHeight,
                  borderRadius: glassRadii.submitButton,
                  backgroundColor: glassColors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: 'rgba(15, 23, 42, 0.35)',
                  shadowOpacity: 0.18,
                  shadowRadius: 16,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(16),
                    fontWeight: '800',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

export const SetStockBottomSheet = memo(
  forwardRef<SetStockBottomSheetRef, SetStockBottomSheetProps>(
    SetStockBottomSheetImpl,
  ),
);
