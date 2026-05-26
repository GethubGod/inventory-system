import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { triggerSelectionHaptic } from "@/lib/haptics";
import {
  colors,
  quickOrderAccent,
} from "@/theme/design";
import {
  getParsedItemDisplayName,
  getParsedItemIssue,
  getParsedItemKey,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from "./quickOrderItems";
import type { PreviousQuantitySuggestion } from "./quickOrderHistorySuggestions";
import type { ComposerMode } from "./quickOrderComposer";
import {
  findUnitOption,
  formatAddQuantityCta,
  formatQuantityWithUnit,
  getQuantitySheetInitialState,
  getUsablePreviousQuantitySuggestion,
  resolveQuantityUnitOptions,
} from "./quickOrderQuantityFlow";
import { PreviousQuantitySuggestionCard } from "./PreviousQuantitySuggestionCard";
import { QuantityStepper } from "./QuantityStepper";
import { UnitSegmentedControl } from "./UnitSegmentedControl";

/** One entry in the quantity-fix walk-through. */
export type QuickOrderQuantitySheetItem = {
  item: ParsedQuickOrderItem;
  /** Inventory row backing the item, when known — drives the unit choices. */
  inventoryItem: QuickOrderInventoryItem | null;
  /** Prior-order suggestion for this item, when one exists. */
  suggestion: PreviousQuantitySuggestion | null;
};

export type QuickOrderQuantityResult = {
  quantity: number;
  unit: string;
};

type QuickOrderQuantitySheetProps = {
  visible: boolean;
  /**
   * Items still being worked through. Entries that have already been resolved
   * are passed as `null` so the surviving indices keep lining up with the
   * progress counter. The sheet only ever reads `queue[index]`.
   */
  queue: (QuickOrderQuantitySheetItem | null)[];
  index: number;
  /** Drives copy that differs between ordering and inventory counting. */
  composerMode: ComposerMode;
  isSaving: boolean;
  onClose: () => void;
  /** Apply the picked quantity/unit to the current item, then advance. */
  onApply: (result: QuickOrderQuantityResult) => void;
  /** Leave the current item unresolved and advance (multi-item flow only). */
  onSkip: () => void;
  /** Remove the current item from the order (parent should confirm). */
  onRemove: () => void;
};

/**
 * Bottom sheet that walks the user through filling in missing quantities. With
 * a single item it shows the one-shot variant ("Add 2 cases →"); with several it
 * becomes a progress flow ("Item 1 of 3" + Skip / Add & next). The previous-order
 * card, the stepper, and the unit segmented control are shared between both.
 */
export function QuickOrderQuantitySheet(props: QuickOrderQuantitySheetProps) {
  const current = props.queue[props.index] ?? null;
  return (
    <Modal
      visible={props.visible && Boolean(current)}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      {current ? (
        <SheetBody
          key={`${getParsedItemKey(current.item)}::${props.index}`}
          {...props}
          current={current}
        />
      ) : null}
    </Modal>
  );
}

type SheetBodyProps = QuickOrderQuantitySheetProps & {
  current: QuickOrderQuantitySheetItem;
};

function SheetBody({
  queue,
  index,
  composerMode,
  isSaving,
  onClose,
  onApply,
  onSkip,
  onRemove,
  current,
}: SheetBodyProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const sheetTranslateY = React.useRef(new Animated.Value(0)).current;

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event: KeyboardEvent) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const { item, inventoryItem, suggestion } = current;
  const isMulti = queue.length > 1;
  const name = getParsedItemDisplayName(item);
  const issue = getParsedItemIssue(item);
  const issueLabel = issue
    ? issue.kind === "pick-quantity"
      ? composerMode === "inventory"
        ? "Current quantity"
        : "Quantity needed"
      : issue.kind === "pick-unit"
        ? "Unit needed"
        : issue.label
    : null;

  const { options, defaultValue } = useMemo(
    () => resolveQuantityUnitOptions({ item, inventoryItem, suggestion }),
    [inventoryItem, item, suggestion],
  );
  const availableOptions = useMemo(
    () => options.filter((option) => option.available !== false),
    [options],
  );
  const usableSuggestion = useMemo(
    () => getUsablePreviousQuantitySuggestion(suggestion, options),
    [options, suggestion],
  );
  const initialState = useMemo(
    () =>
      getQuantitySheetInitialState({
        item,
        options,
        defaultValue,
        suggestion: usableSuggestion,
      }),
    [defaultValue, item, options, usableSuggestion],
  );

  const [unitOverride, setUnitOverride] = useState<string | null>(
    initialState.unit,
  );
  const unit = unitOverride ?? initialState.unit;
  const [quantity, setQuantity] = useState(initialState.quantity);
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [unitTouched, setUnitTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quantityTouched && quantity !== initialState.quantity) {
      setQuantity(initialState.quantity);
    }
    if (!unitTouched && unitOverride !== initialState.unit) {
      setUnitOverride(initialState.unit);
    }
  }, [
    initialState.quantity,
    initialState.unit,
    quantity,
    quantityTouched,
    unitOverride,
    unitTouched,
  ]);

  const setUnit = (value: string) => {
    setUnitOverride(value);
    setUnitTouched(true);
    setError(null);
  };

  const selectedLabel = findUnitOption(options, unit)?.label ?? unit ?? "";
  const quantityOk = Number.isFinite(quantity) && quantity > 0;
  const canSubmit = quantityOk && Boolean(unit) && !isSaving;

  const handleUseSuggestion = () => {
    if (!usableSuggestion) return;
    setQuantity(usableSuggestion.quantity);
    setQuantityTouched(true);
    const matched = findUnitOption(options, usableSuggestion.unit);
    if (matched) setUnitOverride(matched.value);
    setUnitTouched(true);
    setError(null);
  };

  const handleApply = () => {
    if (!quantityOk) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    if (!unit) {
      setError("Pick a unit.");
      return;
    }
    onApply({ quantity, unit });
  };

  // CTA text: "Add 2 cases →" — uses formatAddQuantityCta for consistency
  const ctaLabel = quantityOk
    ? `${formatAddQuantityCta(quantity, selectedLabel)}`
    : "Add quantity";

  // Pluralized unit label for the stepper display (e.g. "cases" not "case")
  const stepperUnitLabel = quantityOk
    ? formatQuantityWithUnit(quantity, selectedLabel).replace(/^\d+\s*/, '')
    : selectedLabel;

  const sheetMaxHeight = Math.max(
    windowHeight - insets.top - keyboardHeight - 8,
    320,
  );

  const progressRatio = isMulti
    ? Math.min(1, Math.max(0, (index + 1) / queue.length))
    : 0;

  // Safe-area bottom padding ensures the CTA is never hidden behind the home
  // indicator. Use a generous minimum so the button feels "lifted" on notched
  // phones and still has breathing room on older devices.
  const safeBottom = Math.max(insets.bottom + 8, 18);
  const sheetHorizontalPadding = 18;
  const contentWidth = Math.max(0, windowWidth - sheetHorizontalPadding * 2);
  const dismissWithDrag = React.useCallback(() => {
    Animated.timing(sheetTranslateY, {
      toValue: windowHeight,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [onClose, sheetTranslateY, windowHeight]);

  const handleRemovePress = () => {
    if (isSaving) return;
    void triggerSelectionHaptic();
    onRemove();
  };

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          sheetTranslateY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 1.2) {
            dismissWithDrag();
            return;
          }
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            damping: 18,
            stiffness: 180,
            mass: 0.7,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            damping: 18,
            stiffness: 180,
            mass: 0.7,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dismissWithDrag, sheetTranslateY],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.flex}
    >
      <Pressable
        accessibilityLabel="Dismiss quantity editor"
        style={styles.backdrop}
        onPress={onClose}
      />
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.sheet,
          {
            maxHeight: sheetMaxHeight,
            borderTopLeftRadius: 34,
            borderTopRightRadius: 34,
            paddingHorizontal: sheetHorizontalPadding,
            paddingTop: 10,
            paddingBottom: safeBottom,
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
      >
        {/* Drag handle */}
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>

        {/* Multi-item progress bar */}
        {isMulti ? (
          <View
            style={[
              styles.progressRow,
              { gap: 10, marginBottom: 12 },
            ]}
          >
            <Text
              style={[styles.progressLabel, { fontSize: 14 }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {`Item ${index + 1} of ${queue.length}`}
            </Text>
            <View
              style={[styles.progressTrack, { borderRadius: ds.radius(999) }]}
            >
              <View
                style={[
                  styles.progressFill,
                  { flex: progressRatio, borderRadius: ds.radius(999) },
                ]}
              />
              <View style={{ flex: 1 - progressRatio }} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              onPress={onClose}
              style={[
                styles.closeButton,
                {
                  width: ds.spacing(36),
                  height: ds.spacing(36),
                  borderRadius: ds.radius(18),
                },
              ]}
            >
              <Ionicons name="close" size={ds.icon(18)} color={colors.textPrimary} />
            </Pressable>
          </View>
        ) : null}

        {/* Header: item name + remove pill (left), close (right) */}
        <View
          style={[
            styles.headerRow,
            { gap: 12, marginTop: 2 },
          ]}
        >
          <View style={styles.headerTextCluster}>
            <Text
              style={styles.title}
              numberOfLines={2}
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${name} from order`}
              disabled={isSaving}
              hitSlop={8}
              onPress={handleRemovePress}
              style={({ pressed }) => ({
                marginTop: ds.spacing(8),
                alignSelf: "flex-start",
                opacity: isSaving ? 0.5 : pressed ? 0.82 : 1,
              })}
            >
              <View style={styles.removeButtonInner}>
                <Ionicons
                  name="trash-outline"
                  size={15}
                  color={colors.statusRed}
                  style={{ flexShrink: 0 }}
                />
                <Text
                  style={styles.removeButtonText}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  Remove
                </Text>
              </View>
            </Pressable>
            {issueLabel ? (
              <View
                style={[
                  styles.issueRow,
                  { marginTop: 8, gap: 8 },
                ]}
              >
                <View style={styles.issueDot} />
                <Text
                  style={styles.issueText}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {issueLabel}
                </Text>
              </View>
            ) : null}
          </View>
          {!isMulti ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              onPress={onClose}
              style={[
                styles.closeButton,
                {
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                },
              ]}
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          ) : null}
        </View>

        {/* Scrollable content: suggestion card + stepper + unit selector */}
        <ScrollView
          style={[styles.flexShrink, { marginTop: 18 }]}
          contentContainerStyle={{
            alignItems: "center",
            paddingBottom: 2,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.contentStack, { width: contentWidth, gap: 14 }]}>
            {usableSuggestion ? (
              <PreviousQuantitySuggestionCard
                suggestion={usableSuggestion}
                onUse={handleUseSuggestion}
                disabled={isSaving}
              />
            ) : null}

            <QuantityStepper
              value={quantity}
              unitLabel={stepperUnitLabel}
              onChange={(next) => {
                setQuantity(next);
                setQuantityTouched(true);
                setError(null);
              }}
              disabled={isSaving}
            />

            {availableOptions.length > 1 ? (
              <UnitSegmentedControl
                options={availableOptions}
                value={unit}
                onChange={setUnit}
                disabled={isSaving}
              />
            ) : null}

            {error ? (
              <Text style={styles.errorText} allowFontScaling={false}>
                {error}
              </Text>
            ) : null}
          </View>
        </ScrollView>

        {/* Footer: Skip (multi only) + primary CTA */}
        <View
          style={[
            styles.footer,
            { width: contentWidth, marginTop: 16, gap: 8 },
          ]}
        >
          {isMulti ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip this item"
              disabled={isSaving}
              onPress={onSkip}
              style={[
                styles.secondaryButton,
                {
                  borderRadius: ds.radius(999),
                  minHeight: ds.spacing(56),
                  paddingHorizontal: ds.spacing(20),
                  opacity: isSaving ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[styles.secondaryText, { fontSize: ds.fontSize(16) }]}
                allowFontScaling={false}
              >
                Skip
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            accessibilityLabel={isMulti ? "Add and go to next item" : ctaLabel}
            disabled={!canSubmit}
            onPress={handleApply}
            style={[
              styles.primaryButton,
              isMulti ? styles.primaryButtonMulti : styles.primaryButtonSingle,
              {
                borderRadius: 999,
                minHeight: 58,
                paddingHorizontal: 20,
                backgroundColor: quickOrderAccent,
                opacity: !canSubmit ? 0.85 : 1,
              },
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <View style={styles.primaryInner}>
                <Text
                  style={[
                    styles.primaryText,
                    { color: colors.textOnPrimary },
                  ]}
                  numberOfLines={1}
                  allowFontScaling={false}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {isMulti ? "Add & next" : ctaLabel}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={19}
                  color={colors.textOnPrimary}
                  style={{ marginLeft: 8 }}
                />
              </View>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  contentStack: {
    alignSelf: "center",
    alignItems: "stretch",
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrimStrong,
  },
  sheet: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    overflow: "hidden",
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 14,
  },
  grabberRow: {
    alignItems: "center",
    paddingBottom: 16,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#C9C6C0",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  headerTextCluster: {
    flex: 1,
    minWidth: 0,
  },
  progressLabel: {
    color: colors.textSecondary,
    fontWeight: "800",
    letterSpacing: 0,
    flexShrink: 0,
  },
  progressTrack: {
    flex: 1,
    flexDirection: "row",
    height: 6,
    backgroundColor: colors.divider,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    backgroundColor: quickOrderAccent,
  },
  removeButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  removeButtonText: {
    color: colors.statusRed,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: colors.white,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: "800",
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  issueRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  issueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: quickOrderAccent,
  },
  issueText: {
    color: quickOrderAccent,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
  },
  errorText: {
    color: colors.statusRed,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  footer: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
  },
  secondaryButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: quickOrderAccent,
  },
  primaryButtonSingle: {
    flex: 1,
  },
  primaryButtonMulti: {
    flex: 1.6,
  },
  primaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  primaryText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
    flexShrink: 1,
  },
});
