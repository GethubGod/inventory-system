import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  RefreshControl,
  SectionList,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { EmptyStateCard, LoadingIndicator, LocationSelectorButton } from '@/components';
import { useResolvedActiveLocation } from '@/hooks/useResolvedActiveLocation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  triggerConfirmationHaptic,
  triggerImpactHaptic,
  triggerNotificationHaptic,
} from '@/lib/haptics';
import {
  getOrGenerateMyChecklist,
  regenerateMyChecklist,
  sendChecklistOrder,
  type Checklist,
} from '@/services/orderChecklist';
import { useAuthStore, useInventoryStore } from '@/store';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import type { InventoryItem, Location } from '@/types';
import { LocationSwitcherDropdown } from '@/features/stock-check/components/LocationSwitcherDropdown';
import {
  buildSendLines,
  countChecked,
  EMPTY_SELECTION_STATE,
  getCheckedLines,
  locationGroupForLocation,
  sectionizeLines,
  selectionReducer,
  type SelectionLine,
} from './checklistSelection';
import { AddItemsSheet } from './components/AddItemsSheet';
import { ChecklistItemRow } from './components/ChecklistItemRow';
import { ConfirmOrderSheet } from './components/ConfirmOrderSheet';

interface ChecklistSection {
  key: 'frequent' | 'occasional' | 'added' | 'rare';
  title: string | null;
  data: SelectionLine[];
  collapsedCount?: number;
}

const TAB_BAR_CLEARANCE = 60;

export function SimpleOrderScreen() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const { location, locations, setLocation } = useResolvedActiveLocation();
  const fetchLocations = useAuthStore((state) => state.fetchLocations);
  const { items: inventoryItems, fetchItems } = useInventoryStore(
    useShallow((state) => ({
      items: state.items,
      fetchItems: state.fetchItems,
    })),
  );

  const locationGroup = useMemo(
    () => locationGroupForLocation(location?.name, location?.short_code),
    [location?.name, location?.short_code],
  );

  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [selection, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rareExpanded, setRareExpanded] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentItemCount, setSentItemCount] = useState<number | null>(null);
  const loadRequestRef = useRef(0);

  const loadChecklist = useCallback(
    async (mode: 'load' | 'refresh') => {
      const requestId = loadRequestRef.current + 1;
      loadRequestRef.current = requestId;

      if (mode === 'load') {
        setIsLoading(true);
      }
      setLoadError(null);

      try {
        const result =
          mode === 'refresh'
            ? await regenerateMyChecklist(locationGroup)
            : await getOrGenerateMyChecklist(locationGroup);
        if (loadRequestRef.current !== requestId) return;
        setChecklist(result);
        dispatch({ type: 'init', checklist: result });
      } catch (error) {
        if (loadRequestRef.current !== requestId) return;
        const message =
          error instanceof Error
            ? error.message
            : 'Could not load your order checklist.';
        setLoadError(message);
      } finally {
        if (loadRequestRef.current === requestId) {
          setIsLoading(false);
        }
      }
    },
    [locationGroup],
  );

  useEffect(() => {
    setSentItemCount(null);
    void loadChecklist('load');
  }, [loadChecklist]);

  useEffect(() => {
    void fetchItems();
    void fetchLocations();
  }, [fetchItems, fetchLocations]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadChecklist('refresh');
    } finally {
      setIsRefreshing(false);
    }
  }, [loadChecklist]);

  const handleSelectLocation = useCallback(
    (next: Location) => {
      setLocationDropdownOpen(false);
      if (next.id === location?.id) return;
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
      setLocation(next);
    },
    [location?.id, setLocation],
  );

  const handleToggleLine = useCallback((key: string) => {
    dispatch({ type: 'toggle', key });
  }, []);

  const handleAdjustQuantity = useCallback((key: string, delta: number) => {
    dispatch({ type: 'adjustQuantity', key, delta });
  }, []);

  const handleSetQuantity = useCallback((key: string, quantity: number) => {
    dispatch({ type: 'setQuantity', key, quantity });
  }, []);

  const handleRemoveLine = useCallback((key: string) => {
    dispatch({ type: 'removeLine', key });
  }, []);

  const handleAddInventoryItem = useCallback((item: InventoryItem) => {
    dispatch({ type: 'addInventoryItem', item });
  }, []);

  const searchableItems = useMemo(
    () =>
      inventoryItems
        .filter((item) => !item.location_id || item.location_id === location?.id)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [inventoryItems, location?.id],
  );

  const checkedLines = useMemo(() => getCheckedLines(selection), [selection]);
  const checkedCount = checkedLines.length;
  const selectedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of checkedLines) {
      if (line.itemId) ids.add(line.itemId);
    }
    return ids;
  }, [checkedLines]);

  const { lines: sendLines, unmatchedNames } = useMemo(
    () => buildSendLines(selection),
    [selection],
  );
  const sendableCheckedLines = useMemo(
    () => checkedLines.filter((line) => line.itemId !== null),
    [checkedLines],
  );

  const listSections = useMemo<ChecklistSection[]>(() => {
    const grouped = sectionizeLines(selection);
    const sections: ChecklistSection[] = [];
    if (grouped.frequent.length > 0) {
      sections.push({ key: 'frequent', title: 'Usual order', data: grouped.frequent });
    }
    if (grouped.occasional.length > 0) {
      sections.push({
        key: 'occasional',
        title: 'Sometimes ordered',
        data: grouped.occasional,
      });
    }
    // Always present so its footer can host the "Add more items" button
    // between the everyday sections and the collapsed rare section.
    sections.push({
      key: 'added',
      title: grouped.added.length > 0 ? 'Added by you' : null,
      data: grouped.added,
    });
    if (grouped.rare.length > 0) {
      sections.push({
        key: 'rare',
        title: 'Rarely ordered',
        data: rareExpanded ? grouped.rare : [],
        collapsedCount: grouped.rare.length,
      });
    }
    return sections;
  }, [rareExpanded, selection]);

  const handleOpenConfirm = useCallback(() => {
    if (checkedCount === 0) return;
    void triggerImpactHaptic();
    setSendError(null);
    setConfirmVisible(true);
  }, [checkedCount]);

  const handleConfirmSend = useCallback(async () => {
    if (!selection.checklistId || sendLines.length === 0 || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await sendChecklistOrder(selection.checklistId, sendLines);
      void triggerConfirmationHaptic();
      setConfirmVisible(false);
      setSentItemCount(sendLines.length);
    } catch (error) {
      void triggerNotificationHaptic(NotificationFeedbackType.Error);
      setSendError(
        error instanceof Error
          ? error.message
          : 'Could not send your order. Please try again.',
      );
    } finally {
      setIsSending(false);
    }
  }, [isSending, selection.checklistId, sendLines]);

  const handleSuccessDone = useCallback(() => {
    setSentItemCount(null);
    if (checklist) {
      dispatch({ type: 'init', checklist });
    }
  }, [checklist]);

  const renderItem = useCallback(
    ({
      item,
      index,
      section,
    }: {
      item: SelectionLine;
      index: number;
      section: ChecklistSection;
    }) => (
      <ChecklistItemRow
        line={item}
        isLast={index === section.data.length - 1}
        onToggle={handleToggleLine}
        onAdjustQuantity={handleAdjustQuantity}
        onSetQuantity={handleSetQuantity}
      />
    ),
    [handleAdjustQuantity, handleSetQuantity, handleToggleLine],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: ChecklistSection }) => {
      if (section.key === 'rare') {
        return (
          <TouchableOpacity
            onPress={() => {
              void triggerImpactHaptic(ImpactFeedbackStyle.Light);
              setRareExpanded((prev) => !prev);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: rareExpanded }}
            accessibilityLabel={`Rarely ordered, ${section.collapsedCount ?? 0} items`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 48,
              marginTop: ds.spacing(16),
              backgroundColor: colors.background,
            }}
          >
            <Text
              style={{
                flex: 1,
                fontSize: ds.fontSize(12),
                fontWeight: '700',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: glassColors.textSecondary,
              }}
            >
              Rarely ordered ({section.collapsedCount ?? 0})
            </Text>
            <Ionicons
              name={rareExpanded ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(18)}
              color={glassColors.textSecondary}
            />
          </TouchableOpacity>
        );
      }

      if (!section.title) return null;

      return (
        <View
          style={{
            minHeight: 36,
            justifyContent: 'flex-end',
            paddingBottom: ds.spacing(4),
            marginTop: ds.spacing(12),
            backgroundColor: colors.background,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(12),
              fontWeight: '700',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: glassColors.textSecondary,
            }}
          >
            {section.title}
          </Text>
        </View>
      );
    },
    [ds, rareExpanded],
  );

  const renderSectionFooter = useCallback(
    ({ section }: { section: ChecklistSection }) => {
      if (section.key !== 'added') return null;
      return (
        <TouchableOpacity
          onPress={() => {
            void triggerImpactHaptic(ImpactFeedbackStyle.Light);
            setAddSheetVisible(true);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add more items"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
            marginTop: ds.spacing(12),
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.accentBorder,
            backgroundColor: colors.primaryPale,
          }}
        >
          <Ionicons
            name="add-circle-outline"
            size={ds.icon(20)}
            color={glassColors.accent}
            style={{ marginRight: ds.spacing(8) }}
          />
          <Text
            style={{
              fontSize: ds.fontSize(16),
              fontWeight: '700',
              color: glassColors.accent,
            }}
          >
            Add more items
          </Text>
        </TouchableOpacity>
      );
    },
    [ds],
  );

  const tabBarBottomOffset =
    TAB_BAR_CLEARANCE + Math.max(insets.bottom, glassSpacing.tabBarBottom);
  const sendButtonHeight = Math.max(56, ds.buttonH);
  const listBottomPadding =
    tabBarBottomOffset + sendButtonHeight + ds.spacing(32);

  const locationLabel = location?.name ?? 'Choose location';

  let content: React.ReactNode;
  if (sentItemCount !== null) {
    content = (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: tabBarBottomOffset,
        }}
      >
        <Ionicons
          name="checkmark-circle"
          size={ds.icon(72)}
          color={glassColors.successText}
          style={{ marginBottom: ds.spacing(12) }}
        />
        <Text
          style={{
            fontSize: ds.fontSize(22),
            fontWeight: '700',
            color: glassColors.textPrimary,
            marginBottom: ds.spacing(4),
          }}
        >
          Order sent
        </Text>
        <Text
          style={{
            fontSize: ds.fontSize(15),
            color: glassColors.textSecondary,
            textAlign: 'center',
            paddingHorizontal: ds.spacing(32),
            marginBottom: ds.spacing(20),
          }}
        >
          {sentItemCount === 1 ? '1 item' : `${sentItemCount} items`} went to
          your manager for review.
        </Text>
        <TouchableOpacity
          onPress={handleSuccessDone}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Back to checklist"
          style={{
            minHeight: 52,
            paddingHorizontal: ds.spacing(28),
            borderRadius: glassRadii.submitButton,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(17),
              fontWeight: '700',
              color: colors.white,
            }}
          >
            Done
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else if (isLoading) {
    content = <LoadingIndicator />;
  } else if (loadError) {
    content = (
      <View style={{ paddingTop: ds.spacing(24) }}>
        <EmptyStateCard
          icon="alert-circle-outline"
          title="Checklist unavailable"
          message={loadError}
          actionLabel="Try again"
          onPressAction={() => void loadChecklist('load')}
        />
      </View>
    );
  } else if (selection.lines.length === 0) {
    content = (
      <View style={{ paddingTop: ds.spacing(24) }}>
        <EmptyStateCard
          icon="clipboard-outline"
          title="No checklist yet"
          message="Once you have order history here, your usual items appear automatically. You can still add items below."
          actionLabel="Add items"
          onPressAction={() => setAddSheetVisible(true)}
        />
      </View>
    );
  } else {
    content = (
      <SectionList
        sections={listSections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setLocationDropdownOpen(false)}
        contentContainerStyle={{ paddingBottom: listBottomPadding }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={glassColors.accent}
          />
        }
      />
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={{ flex: 1, paddingHorizontal: glassSpacing.screen }}>
        <View
          style={{
            zIndex: 10,
            position: 'relative',
            paddingTop: ds.spacing(2),
            paddingBottom: ds.spacing(12),
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <LocationSelectorButton
              label={locationLabel}
              expanded={locationDropdownOpen}
              onPress={() => setLocationDropdownOpen((prev) => !prev)}
            />
          </View>
          <LocationSwitcherDropdown
            isOpen={locationDropdownOpen}
            locations={locations}
            selectedLocationId={location?.id ?? null}
            onSelect={handleSelectLocation}
            onRequestClose={() => setLocationDropdownOpen(false)}
          />
        </View>

        {content}
      </View>

      {sentItemCount === null && !isLoading && !loadError && checkedCount > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: glassSpacing.screen,
            right: glassSpacing.screen,
            bottom: tabBarBottomOffset + ds.spacing(8),
          }}
        >
          <TouchableOpacity
            onPress={handleOpenConfirm}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Send order with ${checkedCount} items`}
            style={{
              minHeight: sendButtonHeight,
              borderRadius: glassRadii.submitButton,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: colors.black,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 12,
              elevation: 4,
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(17),
                fontWeight: '700',
                color: colors.white,
              }}
            >
              Send Order ({checkedCount})
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <AddItemsSheet
        visible={addSheetVisible}
        items={searchableItems}
        selectedItemIds={selectedItemIds}
        onAddItem={handleAddInventoryItem}
        onClose={() => setAddSheetVisible(false)}
      />

      <ConfirmOrderSheet
        visible={confirmVisible}
        lines={sendableCheckedLines}
        unmatchedNames={unmatchedNames}
        isSending={isSending}
        sendError={sendError}
        onAdjustQuantity={handleAdjustQuantity}
        onRemoveLine={handleRemoveLine}
        onConfirm={() => void handleConfirmSend()}
        onClose={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
