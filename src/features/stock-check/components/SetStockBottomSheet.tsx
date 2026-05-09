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
  FadeIn,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
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
 * Fixed sheet height. The note UI swaps inside the same fixed sheet instead
 * of expanding it, which prevents picker gestures from competing with sheet
 * content panning.
 */
const SNAP_POINTS = ['58%'] as const;

/** Quick-suggestion chips relocated from the legacy InlineNoteEditor. */
const QUICK_NOTE_SUGGESTIONS = [
  'Extra for weekend',
  'Use backup supplier',
  'Quality issue last time',
  'Chef requested',
  'Running low',
] as const;

type SheetViewMode = 'quantity' | 'note';

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
  size?: number;
  iconSize?: number;
}

const IconCircleButton = memo(function IconCircleButton({
  icon,
  onPress,
  accessibilityLabel,
  accent,
  size = 34,
  iconSize = 18,
}: IconCircleButtonProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={10}
      style={{
        width: size,
        height: size,
        borderRadius: glassRadii.round,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? 'rgba(232, 80, 58, 0.14)' : grayScale[100],
      }}
    >
      <Ionicons
        name={icon}
        size={iconSize}
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

  /* ── Fixed sheet view state ────────────────────────────────────────── */

  const snapPoints = useMemo(() => SNAP_POINTS as unknown as string[], []);
  const [viewMode, setViewMode] = useState<SheetViewMode>('quantity');
  const noteOpen = viewMode === 'note';

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
    setViewMode('quantity');
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

  const handleToggleNote = useCallback(() => {
    setViewMode((prev) => (prev === 'note' ? 'quantity' : 'note'));
  }, []);

  /* ── Footer / actions ──────────────────────────────────────────────── */

  const handleCancel = useCallback(() => {
    modalRef.current?.dismiss();
  }, []);

  const handleDismiss = useCallback(() => {
    setViewMode('quantity');
    onDismiss();
  }, [onDismiss]);

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
  const contentPaddingBottom = footerHeight + footerBottomInset + ds.spacing(12);

  /* Whether the user has dialed in any stock or note edits — used as a
   * conservative dirty-check for accessibility hints on the X close. */
  const isDirty =
    !!item &&
    (item.stockUnit !== stockUnit ||
      item.stockAmount !== stockAmount ||
      item.stockPieces !== stockPieces ||
      (item.noteText ?? '') !== noteDraft);

  const renderHandle = useCallback(
    () => (
      <View
        style={{
          paddingHorizontal: ds.spacing(20),
          paddingTop: ds.spacing(8),
          paddingBottom: item ? ds.spacing(10) : ds.spacing(4),
          backgroundColor: colors.white,
          borderTopLeftRadius: glassRadii.surface + 4,
          borderTopRightRadius: glassRadii.surface + 4,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 42,
            height: 5,
            borderRadius: glassRadii.pill,
            backgroundColor: grayScale[300],
            marginBottom: item ? ds.spacing(12) : 0,
          }}
        />

        {item ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
              <Text
                style={{
                  fontSize: ds.fontSize(22),
                  fontWeight: '900',
                  color: glassColors.textPrimary,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {item.name}
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
                    ? 'arrow-back'
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
                size={40}
                iconSize={20}
              />
              <IconCircleButton
                icon="close"
                onPress={handleCancel}
                accessibilityLabel={
                  isDirty
                    ? 'Cancel and discard wheel changes'
                    : 'Close'
                }
                size={48}
                iconSize={26}
              />
            </View>
          </View>
        ) : null}
      </View>
    ),
    [
      ds,
      handleCancel,
      handleToggleNote,
      isDirty,
      item,
      noteOpen,
      parSubtitle,
    ],
  );

  return (
    <BottomSheetModal
      ref={modalRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enableContentPanningGesture={false}
      enableHandlePanningGesture
      enablePanDownToClose
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : 'extend'}
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleComponent={renderHandle}
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
            <View
              style={{
                flex: 1,
                paddingHorizontal: ds.spacing(20),
                paddingTop: ds.spacing(2),
                paddingBottom: contentPaddingBottom,
              }}
            >
              {noteOpen ? (
                <Animated.View
                  key="note-view"
                  entering={FadeIn.duration(180).easing(
                    Easing.bezier(0.2, 0, 0.2, 1).factory(),
                  )}
                  exiting={FadeOut.duration(120).easing(
                    Easing.bezier(0.4, 0, 0.6, 1).factory(),
                  )}
                  layout={LinearTransition.duration(180)}
                  style={{ flex: 1 }}
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
                      flex: 1,
                      minHeight: 150,
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
              ) : (
                <Animated.View
                  key="quantity-view"
                  entering={FadeIn.duration(180).easing(
                    Easing.bezier(0.2, 0, 0.2, 1).factory(),
                  )}
                  exiting={FadeOut.duration(120).easing(
                    Easing.bezier(0.4, 0, 0.6, 1).factory(),
                  )}
                  layout={LinearTransition.duration(180)}
                >
                  {/* ── Wheel pickers ──────────────────────────────── */}
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

                  {/* ── Summary box ────────────────────────────────── */}
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
                </Animated.View>
              )}
            </View>

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
