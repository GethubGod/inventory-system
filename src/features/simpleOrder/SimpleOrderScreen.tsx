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
import { router, useFocusEffect } from 'expo-router';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { EmptyStateCard, LoadingIndicator } from '@/components';
import { getFloatingPillClearance } from '@/components/navigation';
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
  prepareDirectSend,
  regenerateMyChecklist,
  saveChecklistAsDefault,
  sendChecklistOrder,
  type Checklist,
  type DirectSendGroup,
} from '@/services/orderChecklist';
import { getMyOrderSendMode, type OrderSendMode } from '@/services/orderSendMode';
import type { SendAllQueueProgress } from '@/features/fulfillment/sendAll/sendAllQueue';
import { useAuthStore, useInventoryStore, useSettingsStore } from '@/store';
import { useSimpleOrderUiStore } from '@/store/simpleOrderUiStore';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import type { InventoryItem, Location } from '@/types';
import { LocationSwitcherDropdown } from '@/features/stock-check/components/LocationSwitcherDropdown';
import {
  addedLineKey,
  buildDefaultLines,
  buildSendLines,
  EMPTY_SELECTION_STATE,
  getCheckedLines,
  locationGroupForLocation,
  selectionReducer,
  type SelectionLine,
  type SelectionState,
} from './checklistSelection';
import { buildDirectSendLines } from './directSendFlow';
import { deriveDisplaySections, type DisplaySection } from './displaySections';
import { filterCatalogItems, type VoiceAddition } from './catalogSearch';
import { unitOptionsForLine } from './unitOptions';
import { ChecklistItemRow } from './components/ChecklistItemRow';
import { ChecklistSettingsSheet } from './components/ChecklistSettingsSheet';
import { ChecklistToast, type ChecklistToastState } from './components/ChecklistToast';
import { ConfirmOrderSheet } from './components/ConfirmOrderSheet';
import { DirectSendQueue } from './components/DirectSendQueue';
import { NoteSheet } from './components/NoteSheet';
import { PinnedOrderBar } from './components/PinnedOrderBar';
import { QuantityCardSheet } from './components/QuantityCardSheet';
import { QuickActionsSheet, type QuickAction } from './components/QuickActionsSheet';
import { RecentOrdersSheet } from './components/RecentOrdersSheet';
import { VoiceAddSheet } from './components/VoiceAddSheet';

export function SimpleOrderScreen() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const { location, locations, setLocation } = useResolvedActiveLocation();
  const fetchLocations = useAuthStore((state) => state.fetchLocations);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { items: inventoryItems, fetchItems } = useInventoryStore(
    useShallow((state) => ({
      items: state.items,
      fetchItems: state.fetchItems,
    })),
  );
  const density = useSettingsStore((state) => state.simpleOrderDensity);
  const setSimpleOrderDensity = useSettingsStore(
    (state) => state.setSimpleOrderDensity,
  );
  const showCategories = useSettingsStore((state) => state.simpleOrderShowCategories);
  const setShowCategories = useSettingsStore(
    (state) => state.setSimpleOrderShowCategories,
  );

  const quickActionsToken = useSimpleOrderUiStore((state) => state.quickActionsToken);
  const consumePendingReorder = useSimpleOrderUiStore(
    (state) => state.consumePendingReorder,
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
  const [rareExpanded, setRareExpanded] = useState(true);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [displaySheetVisible, setDisplaySheetVisible] = useState(false);
  const [quickActionsVisible, setQuickActionsVisible] = useState(false);
  const [noteSheetVisible, setNoteSheetVisible] = useState(false);
  const [note, setNote] = useState('');
  const [quantityKey, setQuantityKey] = useState<string | null>(null);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [orderBarHeight, setOrderBarHeight] = useState(62);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentItemCount, setSentItemCount] = useState<number | null>(null);
  const [sendMode, setSendMode] = useState<OrderSendMode>('review');
  const [directSendGroups, setDirectSendGroups] = useState<DirectSendGroup[] | null>(null);
  const [recentOrdersVisible, setRecentOrdersVisible] = useState(false);
  const [toast, setToast] = useState<ChecklistToastState | null>(null);
  const loadRequestRef = useRef(0);
  const toastIdRef = useRef(0);
  const quickActionsTokenRef = useRef(quickActionsToken);

  const showToast = useCallback(
    (message: string, action?: { actionLabel: string; onAction: () => void }) => {
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, message, ...action });
    },
    [],
  );

  // The floating pill's dots button requests the quick-actions sheet from
  // outside this screen via the ui store's monotonic token.
  useEffect(() => {
    if (quickActionsToken !== quickActionsTokenRef.current) {
      quickActionsTokenRef.current = quickActionsToken;
      setLocationDropdownOpen(false);
      setQuickActionsVisible(true);
    }
  }, [quickActionsToken]);

  // History's Reorder stages lines in the ui store; apply them when the
  // Order tab gains focus.
  useFocusEffect(
    useCallback(() => {
      const staged = consumePendingReorder();
      if (staged && staged.items.length > 0) {
        dispatch({ type: 'applyReorder', items: staged.items });
        showToast(
          `Loaded ${staged.items.length} ${staged.items.length === 1 ? 'item' : 'items'} from ${staged.sourceLabel}`,
        );
      }
    }, [consumePendingReorder, showToast]),
  );

  // Manager-configured 5b preference; unknown/error safely means review mode.
  useEffect(() => {
    let active = true;
    getMyOrderSendMode()
      .then((mode) => {
        if (active) setSendMode(mode);
      })
      .catch(() => {
        if (active) setSendMode('review');
      });
    return () => {
      active = false;
    };
  }, []);

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

  const handleOpenQuantityCard = useCallback((key: string) => {
    setQuantityKey(key);
  }, []);

  const handleAddInventoryItem = useCallback((item: InventoryItem) => {
    dispatch({ type: 'addInventoryItem', item });
  }, []);

  const inventoryById = useMemo(
    () => new Map(inventoryItems.map((item) => [item.id, item])),
    [inventoryItems],
  );

  const categoryForItemId = useCallback(
    (itemId: string | null) =>
      itemId ? (inventoryById.get(itemId)?.category ?? null) : null,
    [inventoryById],
  );

  const searchableItems = useMemo(
    () =>
      inventoryItems
        .filter((item) => !item.location_id || item.location_id === location?.id)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [inventoryItems, location?.id],
  );

  const searchResults = useMemo(
    () => filterCatalogItems(searchableItems, searchQuery),
    [searchQuery, searchableItems],
  );

  const handleVoiceApply = useCallback(
    (additions: VoiceAddition[]) => {
      for (const addition of additions) {
        dispatch({ type: 'addInventoryItem', item: addition.item });
        if (addition.quantity !== null) {
          const existing = selection.lines.find(
            (line) => line.itemId === addition.item.id,
          );
          dispatch({
            type: 'setQuantity',
            key: existing ? existing.key : addedLineKey(addition.item.id),
            quantity: addition.quantity,
          });
        }
      }
    },
    [selection.lines],
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

  const listSections = useMemo(
    () =>
      deriveDisplaySections(selection, {
        showCategories,
        rareExpanded,
        categoryForItemId,
      }),
    [categoryForItemId, rareExpanded, selection, showCategories],
  );

  const quantityLine = useMemo(
    () => selection.lines.find((line) => line.key === quantityKey) ?? null,
    [quantityKey, selection.lines],
  );
  const quantityUnitOptions = useMemo(
    () =>
      quantityLine
        ? unitOptionsForLine(
            quantityLine.unit,
            quantityLine.itemId ? inventoryById.get(quantityLine.itemId) ?? null : null,
          )
        : [],
    [inventoryById, quantityLine],
  );

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      setQuickActionsVisible(false);
      switch (action) {
        case 'clear': {
          const snapshot: SelectionState = selection;
          dispatch({ type: 'clearAll' });
          setNote('');
          showToast('Checklist cleared', {
            actionLabel: 'Undo',
            onAction: () => {
              dispatch({ type: 'restore', state: snapshot });
              setToast(null);
            },
          });
          break;
        }
        case 'saveDefault': {
          const defaults = buildDefaultLines(selection);
          if (defaults.length === 0) {
            showToast('Check some items first, then save them as your default');
            break;
          }
          void saveChecklistAsDefault(locationGroup, defaults)
            .then((count) => {
              void triggerConfirmationHaptic();
              showToast(`Saved as default · ${count} ${count === 1 ? 'item' : 'items'}`);
            })
            .catch((error: unknown) => {
              void triggerNotificationHaptic(NotificationFeedbackType.Error);
              showToast(
                error instanceof Error ? error.message : 'Could not save your default.',
              );
            });
          break;
        }
        case 'note':
          setNoteSheetVisible(true);
          break;
        case 'display':
          setDisplaySheetVisible(true);
          break;
        case 'receive':
          // Cast: .expo/types/router.d.ts is a stale generated artifact
          // (last regenerated June '26); the route file exists.
          router.push('/(tabs)/receive-delivery' as Parameters<typeof router.push>[0]);
          break;
        case 'recent':
          setRecentOrdersVisible(true);
          break;
      }
    },
    [locationGroup, selection, showToast],
  );

  const handleSaveNote = useCallback(
    (nextNote: string) => {
      const hadNote = note.trim().length > 0;
      setNote(nextNote);
      setNoteSheetVisible(false);
      if (nextNote.trim()) {
        showToast(hadNote ? 'Note updated' : 'Note added');
      } else if (hadNote) {
        showToast('Note removed');
      }
    },
    [note, showToast],
  );

  const handleOpenConfirm = useCallback(() => {
    if (checkedCount === 0) return;
    void triggerImpactHaptic();
    setSendError(null);
    setConfirmVisible(true);
  }, [checkedCount]);

  const handleConfirmSend = useCallback(async () => {
    if (isSending) return;

    // 5b direct mode: group checked lines per supplier and run the Phase 1
    // style card queue instead of creating a manager-review order.
    if (sendMode === 'direct') {
      const { lines: directLines } = buildDirectSendLines(selection);
      if (directLines.length === 0) return;
      setIsSending(true);
      setSendError(null);
      try {
        const groups = await prepareDirectSend(directLines, locationGroup, note);
        void triggerConfirmationHaptic();
        setConfirmVisible(false);
        setDirectSendGroups(groups);
      } catch (error) {
        void triggerNotificationHaptic(NotificationFeedbackType.Error);
        setSendError(
          error instanceof Error
            ? error.message
            : 'Could not prepare your supplier orders. Please try again.',
        );
      } finally {
        setIsSending(false);
      }
      return;
    }

    if (!selection.checklistId || sendLines.length === 0) return;
    setIsSending(true);
    setSendError(null);
    try {
      await sendChecklistOrder(selection.checklistId, sendLines, { note });
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
  }, [isSending, locationGroup, note, selection, sendLines, sendMode]);

  const handleDirectSendDone = useCallback(
    (progress: SendAllQueueProgress) => {
      setDirectSendGroups(null);
      // Anything was sent: reset the checklist back to its defaults, same as
      // the review-mode success state. All-skipped keeps the selection intact.
      if (progress.sent > 0 && checklist) {
        dispatch({ type: 'init', checklist });
        setNote('');
      }
    },
    [checklist],
  );

  const handleSuccessDone = useCallback(() => {
    setSentItemCount(null);
    setNote('');
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
      section: DisplaySection;
    }) => (
      <ChecklistItemRow
        line={item}
        isLast={index === section.data.length - 1}
        density={density}
        onToggle={handleToggleLine}
        onAdjustQuantity={handleAdjustQuantity}
        onOpenQuantityCard={handleOpenQuantityCard}
      />
    ),
    [density, handleAdjustQuantity, handleOpenQuantityCard, handleToggleLine],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: DisplaySection }) => {
      if (section.isRare) {
        return (
          <TouchableOpacity
            onPress={() => {
              void triggerImpactHaptic(ImpactFeedbackStyle.Light);
              setRareExpanded((prev) => !prev);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: rareExpanded }}
            accessibilityLabel={`Rarely ordered, ${section.rareCount ?? 0} items`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 42,
              marginTop: ds.spacing(10),
              backgroundColor: tipsTheme.page,
            }}
          >
            <Text
              style={{
                flex: 1,
                fontSize: ds.fontSize(12),
                fontWeight: '700',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                color: tipsTheme.ink2,
              }}
            >
              {section.title}
            </Text>
            <Ionicons
              name={rareExpanded ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(16)}
              color={tipsTheme.ink2}
            />
          </TouchableOpacity>
        );
      }

      if (!section.title) return null;

      return (
        <View
          style={{
            minHeight: density === 'dense' ? 26 : 32,
            justifyContent: 'flex-end',
            paddingBottom: ds.spacing(2),
            marginTop: ds.spacing(density === 'dense' ? 8 : 12),
            backgroundColor: tipsTheme.page,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(density === 'dense' ? 11 : 12),
              fontWeight: '700',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: tipsTheme.ink2,
            }}
          >
            {section.title}
          </Text>
        </View>
      );
    },
    [density, ds, rareExpanded],
  );

  const pillClearance = getFloatingPillClearance(insets.bottom);
  const orderBarRestingBottom = pillClearance + ds.spacing(2);
  // Pill toolbar + the pinned composer both float over the checklist, so the
  // last row has to scroll a full row gap clear of the composer's top edge.
  const listBottomPadding = orderBarRestingBottom + orderBarHeight + ds.spacing(32);

  const locationLabel = (location?.name ?? 'Location').replace(/^Babytuna\s+/i, '');

  let content: React.ReactNode;
  if (directSendGroups !== null) {
    content = (
      <DirectSendQueue groups={directSendGroups} onDone={handleDirectSendDone} />
    );
  } else if (sentItemCount !== null) {
    content = (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: pillClearance,
        }}
      >
        <Ionicons
          name="checkmark-circle"
          size={ds.icon(72)}
          color="#22883E"
          style={{ marginBottom: ds.spacing(12) }}
        />
        <Text
          style={{
            fontSize: ds.fontSize(22),
            fontWeight: '700',
            color: tipsTheme.ink,
            marginBottom: ds.spacing(4),
          }}
        >
          Order sent
        </Text>
        <Text
          style={{
            fontSize: ds.fontSize(15),
            color: tipsTheme.ink2,
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
            borderRadius: radii.pill,
            backgroundColor: tipsTheme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: ds.fontSize(16), fontWeight: '700', color: '#FFFFFF' }}>
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
          message="Once you have order history here, your usual items appear automatically. Use the search bar below to add items."
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
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => setLocationDropdownOpen(false)}
        contentContainerStyle={{ paddingBottom: listBottomPadding }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={tipsTheme.accent}
          />
        }
      />
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: tipsTheme.page }}
    >
      <View style={{ flex: 1, paddingHorizontal: ds.spacing(18) }}>
        {/* Tight top: status bar → header → list, no dead band. */}
        <View
          style={{
            zIndex: 10,
            position: 'relative',
            paddingTop: ds.spacing(2),
            paddingBottom: ds.spacing(6),
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: ds.spacing(8) }}>
            <Text
              style={{
                flex: 1,
                fontSize: ds.fontSize(24),
                fontWeight: '700',
                color: tipsTheme.ink,
              }}
            >
              Checklist
            </Text>
            <TouchableOpacity
              onPress={() => {
                void triggerImpactHaptic(ImpactFeedbackStyle.Light);
                setLocationDropdownOpen((prev) => !prev);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ expanded: locationDropdownOpen }}
              accessibilityLabel={`Location: ${locationLabel}. Change location`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: ds.spacing(7),
                backgroundColor: tipsTheme.card,
                borderWidth: glassHairlineWidth,
                borderColor: 'rgba(0, 0, 0, 0.07)',
                borderRadius: radii.pill,
                paddingHorizontal: ds.spacing(12),
                paddingVertical: ds.spacing(7),
              }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: radii.circle,
                  backgroundColor: tipsTheme.accent,
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  maxWidth: ds.spacing(120),
                  fontSize: ds.fontSize(13),
                  fontWeight: '600',
                  color: tipsTheme.ink,
                }}
              >
                {locationLabel}
              </Text>
              <Ionicons name="chevron-down" size={ds.icon(13)} color={tipsTheme.ink2} />
            </TouchableOpacity>
          </View>
          {/* Absolute wrapper: the dropdown always occupies layout space (it
              animates opacity/scale), so anchoring it like Browse does keeps
              the header tight — no dead band above the list. */}
          <View
            pointerEvents="box-none"
            style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 30 }}
          >
            <LocationSwitcherDropdown
              isOpen={locationDropdownOpen}
              locations={locations}
              selectedLocationId={location?.id ?? null}
              onSelect={handleSelectLocation}
              onRequestClose={() => setLocationDropdownOpen(false)}
            />
          </View>
        </View>

        {content}
      </View>

      {directSendGroups === null &&
      sentItemCount === null &&
      !isLoading &&
      !loadError ? (
        <PinnedOrderBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          results={searchResults}
          selectedItemIds={selectedItemIds}
          onAddItem={handleAddInventoryItem}
          checkedCount={checkedCount}
          onPressSend={handleOpenConfirm}
          voiceAvailable
          onPressMic={() => setVoiceVisible(true)}
          hasNote={note.trim().length > 0}
          onPressNote={() => setNoteSheetVisible(true)}
          restingBottom={orderBarRestingBottom}
          onHeightChange={setOrderBarHeight}
        />
      ) : null}

      <QuickActionsSheet
        visible={quickActionsVisible}
        hasNote={note.trim().length > 0}
        density={density}
        showCategories={showCategories}
        onAction={handleQuickAction}
        onClose={() => setQuickActionsVisible(false)}
      />

      <ChecklistSettingsSheet
        visible={displaySheetVisible}
        density={density}
        showCategories={showCategories}
        onSelectDensity={setSimpleOrderDensity}
        onToggleCategories={setShowCategories}
        onClose={() => setDisplaySheetVisible(false)}
      />

      <NoteSheet
        visible={noteSheetVisible}
        note={note}
        onSave={handleSaveNote}
        onClose={() => setNoteSheetVisible(false)}
      />

      <QuantityCardSheet
        visible={quantityKey !== null}
        line={quantityLine}
        unitOptions={quantityUnitOptions}
        onSetUnit={(key, unit) => dispatch({ type: 'setUnit', key, unit })}
        onCommit={(key, quantity) => {
          dispatch({ type: 'setQuantity', key, quantity });
          setQuantityKey(null);
        }}
        onClose={() => setQuantityKey(null)}
      />

      <VoiceAddSheet
        visible={voiceVisible}
        locationId={location?.id ?? null}
        userId={userId}
        inventoryItems={searchableItems}
        onApply={handleVoiceApply}
        onClose={() => setVoiceVisible(false)}
      />

      <ConfirmOrderSheet
        visible={confirmVisible}
        mode={sendMode}
        // Direct mode can send unmatched lines too — they go out via the
        // share-sheet-only Unassigned card instead of being skipped.
        lines={sendMode === 'direct' ? checkedLines : sendableCheckedLines}
        unmatchedNames={sendMode === 'direct' ? [] : unmatchedNames}
        note={note}
        onEditNote={() => {
          setConfirmVisible(false);
          setNoteSheetVisible(true);
        }}
        isSending={isSending}
        sendError={sendError}
        onConfirm={() => void handleConfirmSend()}
        onClose={() => setConfirmVisible(false)}
      />

      <RecentOrdersSheet
        visible={recentOrdersVisible}
        onClose={() => setRecentOrdersVisible(false)}
      />

      <ChecklistToast
        toast={toast}
        bottom={orderBarRestingBottom + orderBarHeight + ds.spacing(12)}
        onExpire={() => setToast(null)}
      />
    </SafeAreaView>
  );
}
