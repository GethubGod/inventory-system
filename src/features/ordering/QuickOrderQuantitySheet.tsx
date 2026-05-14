import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Modal,
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
import {
  colors,
  glassColors,
  glassHairlineWidth,
  grayScale,
} from "@/theme/design";
import {
  getParsedItemDisplayName,
  getParsedItemIssue,
  getParsedItemKey,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from "./quickOrderItems";
import type { PreviousQuantitySuggestion } from "./quickOrderHistorySuggestions";
import {
  findUnitOption,
  formatAddQuantityCta,
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
  isSaving: boolean;
  onClose: () => void;
  /** Apply the picked quantity/unit to the current item, then advance. */
  onApply: (result: QuickOrderQuantityResult) => void;
  /** Leave the current item unresolved and advance (multi-item flow only). */
  onSkip: () => void;
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
  isSaving,
  onClose,
  onApply,
  onSkip,
  current,
}: SheetBodyProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

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
      ? "Quantity needed"
      : issue.kind === "pick-unit"
        ? "Unit needed"
        : issue.label
    : null;

  const { options, defaultValue } = useMemo(
    () => resolveQuantityUnitOptions({ item, inventoryItem, suggestion }),
    [inventoryItem, item, suggestion],
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

  const ctaLabel = quantityOk
    ? `${formatAddQuantityCta(quantity, selectedLabel)}`
    : "Add quantity";

  const sheetMaxHeight = Math.max(
    windowHeight - insets.top - keyboardHeight - ds.spacing(20),
    ds.spacing(280),
  );

  const progressRatio = isMulti
    ? Math.min(1, Math.max(0, (index + 1) / queue.length))
    : 0;

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
      <View
        style={[
          styles.sheet,
          {
            maxHeight: sheetMaxHeight,
            borderTopLeftRadius: ds.radius(26),
            borderTopRightRadius: ds.radius(26),
            paddingHorizontal: ds.spacing(22),
            paddingTop: ds.spacing(10),
            paddingBottom: Math.max(
              insets.bottom + ds.spacing(8),
              ds.spacing(18),
            ),
          },
        ]}
      >
        <View style={styles.grabberRow}>
          <View
            style={[styles.grabber, { backgroundColor: colors.textMuted }]}
          />
        </View>

        {isMulti ? (
          <View
            style={[
              styles.progressRow,
              { gap: ds.spacing(12), marginBottom: ds.spacing(14) },
            ]}
          >
            <Text
              style={[styles.progressLabel, { fontSize: ds.fontSize(14) }]}
              numberOfLines={1}
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
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  width: ds.spacing(34),
                  height: ds.spacing(34),
                  borderRadius: ds.radius(17),
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Ionicons
                name="close"
                size={ds.icon(18)}
                color={colors.textPrimary}
              />
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.headerRow,
            { gap: ds.spacing(14), marginTop: ds.spacing(4) },
          ]}
        >
          <View style={styles.headerTextCluster}>
            <Text
              style={[styles.title, { fontSize: ds.fontSize(26) }]}
              numberOfLines={2}
            >
              {name}
            </Text>
            {issueLabel ? (
              <View
                style={[
                  styles.issueRow,
                  { marginTop: ds.spacing(6), gap: ds.spacing(6) },
                ]}
              >
                <View
                  style={[styles.issueDot, { backgroundColor: colors.primary }]}
                />
                <Text
                  style={[styles.issueText, { fontSize: ds.fontSize(14) }]}
                  numberOfLines={1}
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
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  width: ds.spacing(40),
                  height: ds.spacing(40),
                  borderRadius: ds.radius(20),
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Ionicons
                name="close"
                size={ds.icon(20)}
                color={colors.textPrimary}
              />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          style={[styles.flexShrink, { marginTop: ds.spacing(20) }]}
          contentContainerStyle={{
            gap: ds.spacing(16),
            paddingBottom: ds.spacing(4),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {usableSuggestion ? (
            <PreviousQuantitySuggestionCard
              suggestion={usableSuggestion}
              onUse={handleUseSuggestion}
              disabled={isSaving}
            />
          ) : null}

          <QuantityStepper
            value={quantity}
            unitLabel={selectedLabel}
            onChange={(next) => {
              setQuantity(next);
              setQuantityTouched(true);
              setError(null);
            }}
            disabled={isSaving}
          />

          <UnitSegmentedControl
            options={options}
            value={unit}
            onChange={setUnit}
            disabled={isSaving}
          />

          {error ? (
            <Text style={[styles.errorText, { fontSize: ds.fontSize(13) }]}>
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { marginTop: ds.spacing(16), gap: ds.spacing(10) },
          ]}
        >
          {isMulti ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip this item"
              disabled={isSaving}
              onPress={onSkip}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderRadius: ds.radius(999),
                  minHeight: ds.spacing(52),
                  opacity: isSaving ? 0.6 : pressed ? 0.82 : 1,
                },
              ]}
            >
              <Text
                style={[styles.secondaryText, { fontSize: ds.fontSize(16) }]}
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
            style={({ pressed }) => [
              styles.primaryButton,
              {
                borderRadius: ds.radius(999),
                minHeight: ds.spacing(56),
                backgroundColor: canSubmit
                  ? colors.primary
                  : colors.glassCircle,
                opacity: canSubmit && pressed ? 0.86 : 1,
              },
            ]}
          >
            {isSaving ? (
              <ActivityIndicator
                color={canSubmit ? colors.textOnPrimary : colors.textMuted}
              />
            ) : (
              <View style={styles.primaryInner}>
                <Text
                  style={[
                    styles.primaryText,
                    {
                      fontSize: ds.fontSize(16),
                      color: canSubmit
                        ? colors.textOnPrimary
                        : colors.textMuted,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {isMulti ? "Add & next" : ctaLabel}
                </Text>
                <Ionicons
                  name="arrow-forward"
                  size={ds.icon(18)}
                  color={canSubmit ? colors.textOnPrimary : colors.textMuted}
                  style={{ marginLeft: ds.spacing(10) }}
                />
              </View>
            )}
          </Pressable>
        </View>
      </View>
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
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.background,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 12,
  },
  grabberRow: {
    alignItems: "center",
    paddingBottom: 10,
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: 2,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
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
    backgroundColor: grayScale[200],
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.primary,
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: colors.white,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textSecondary,
    fontWeight: "600",
    letterSpacing: 0,
  },
  issueRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  issueDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  issueText: {
    color: colors.primary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  errorText: {
    color: colors.statusRed,
    fontWeight: "700",
    letterSpacing: 0,
  },
  footer: {
    flexDirection: "row",
  },
  secondaryButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.glassCircle,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  primaryButton: {
    flex: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryText: {
    fontWeight: "800",
    letterSpacing: 0,
    flexShrink: 1,
  },
  doneText: {
    marginLeft: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
});
