import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Animated,
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useOrderStore, useInventoryStore, useAuthStore } from '@/store';
import type { CartItem } from '@/store';
import type { CartContext } from '@/store/orderStore';
import { colors } from '@/constants';
import { Location, InventoryItem, UnitType } from '@/types';
import {
  BrandLogo,
  ConfirmLocationBottomSheet,
  GlassSurface,
  ItemActionSheet,
  LoadingIndicator,
} from '@/components';
import type { ItemActionSheetSection } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { completePendingRemindersForUser } from '@/services/notificationService';
import type { OrderingMode } from '@/features/ordering/types';
import { type HistoricalOrderSummary } from '@/features/ordering/orderInsights';
import { resolveActiveLocationReminders } from '@/services/locationReminderService';
import { OrderSubmissionError } from '@/services/orderSubmission';
import { BROWSE_INVENTORY_ROUTE } from '@/features/browse/config';
import {
  formatOrderConfirmationSummary,
  type OrderConfirmationPayload,
} from './orderConfirmation';
import { resolveLocationSwitchTarget } from './locationSwitch';
import { EmptyCartReorderState } from './EmptyCartReorderState';
import { OrderSubmissionConfirmationOverlay } from './OrderSubmissionConfirmationOverlay';
import { triggerConfirmationHaptic } from '@/lib/haptics';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';
import { segmentedControlColors } from '@/theme/segmentedControls';

interface CartItemWithDetails extends CartItem {
  inventoryItem?: InventoryItem;
}

interface CartScreenViewProps {
  mode: OrderingMode;
}

const ORDER_SUBMIT_UI_TIMEOUT_MS = 20_000;

function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function formatActionValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0';
  }

  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

function getItemActionSummary(item: CartItemWithDetails): string {
  const unitLabel =
    item.unitType === 'pack'
      ? item.inventoryItem?.pack_unit ?? 'pack'
      : item.inventoryItem?.base_unit ?? 'unit';
  const valueText =
    item.inputMode === 'remaining'
      ? `Remaining ${formatActionValue(item.remainingReported ?? 0)} ${unitLabel}`
      : `${formatActionValue(item.quantityRequested ?? item.quantity)} ${unitLabel}`;

  return item.note ? `${valueText} • Note added` : valueText;
}

export function CartScreenView({
  mode,
}: CartScreenViewProps) {
  const ds = useScaledStyles();
  const context: CartContext = mode.scope;
  const quickOrderRoute = mode.quickOrderRoute;
  const browseRoute = mode.browseRoute;
  const pastOrdersRoute = mode.pastOrdersRoute;
  const requiresLocationConfirm = mode.requireLocationConfirm ?? context === 'employee';
  const emptyCartBrowseRoute = context === 'employee' ? BROWSE_INVENTORY_ROUTE : browseRoute;

  const {
    activeCartByLocation,
    getCartItems,
    addToCart,
    updateCartItem,
    removeFromCart,
    moveCartItem,
    moveLocationCartItems,
    clearLocationCart,
    createAndSubmitOrder,
    createAndSubmitOrderFromSourceLocation,
    setCartItemNote,
  } = useOrderStore(useShallow((state) => ({
    activeCartByLocation: context === 'manager' ? state.managerCartByLocation : state.cartByLocation,
    getCartItems: state.getCartItems,
    addToCart: state.addToCart,
    updateCartItem: state.updateCartItem,
    removeFromCart: state.removeFromCart,
    moveCartItem: state.moveCartItem,
    moveLocationCartItems: state.moveLocationCartItems,
    clearLocationCart: state.clearLocationCart,
    createAndSubmitOrder: state.createAndSubmitOrder,
    createAndSubmitOrderFromSourceLocation: state.createAndSubmitOrderFromSourceLocation,
    setCartItemNote: state.setCartItemNote,
  })));
  const { items, fetchItems } = useInventoryStore(useShallow((state) => ({
    items: state.items,
    fetchItems: state.fetchItems,
  })));
  const { user, profile, locations } = useAuthStore(useShallow((state) => ({
    user: state.user,
    profile: state.profile,
    locations: state.locations,
  })));

  // Track expanded items
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Cart location change modal state
  const [showCartLocationModal, setShowCartLocationModal] = useState(false);
  const [cartLocationToMove, setCartLocationToMove] = useState<Location | null>(null);

  // Item menu state
  const [showItemMenu, setShowItemMenu] = useState(false);
  const [showItemLocationModal, setShowItemLocationModal] = useState(false);
  const [showItemNoteModal, setShowItemNoteModal] = useState(false);
  const [itemLocationAction, setItemLocationAction] = useState<'add' | 'move' | null>(null);
  const [itemNoteDraft, setItemNoteDraft] = useState('');
  const [menuTarget, setMenuTarget] = useState<{
    locationId: string;
    cartItemId: string;
  } | null>(null);
  const [showConfirmLocationSheet, setShowConfirmLocationSheet] = useState(false);
  const [confirmLocationId, setConfirmLocationId] = useState<string | null>(null);
  const [confirmSourceLocationId, setConfirmSourceLocationId] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmationPayload | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const cartScreenBlurTargetRef = useRef<View>(null);

  const selectedLocation = useAuthStore((state) => state.location);
  const cartLocationIds = useMemo(
    () =>
      Object.keys(activeCartByLocation).filter(
        (locationId) => getCartItems(locationId, context).length > 0
      ),
    [activeCartByLocation, context, getCartItems]
  );
  const totalCartCount = useMemo(
    () =>
      cartLocationIds.reduce(
        (total, locationId) => total + getCartItems(locationId, context).length,
        0
      ),
    [cartLocationIds, context, getCartItems]
  );
  const totalCartCountLabel = `${totalCartCount} item${totalCartCount === 1 ? '' : 's'}`;
  const toastBottomOffset = context === 'employee' ? ds.spacing(88) : ds.spacing(24);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Get locations with cart items
  const locationsWithCart = useMemo(() => {
    return cartLocationIds.map((locationId) => {
      const match = locations.find((loc) => loc.id === locationId);
      if (match) return match;
      return {
        id: locationId,
        name: 'Unknown Location',
        short_code: '?',
        active: true,
        created_at: '',
      } as Location;
    });
  }, [locations, cartLocationIds]);

  const availableLocations = useMemo(() => {
    const activeLocations = locations.filter((location) => location.active !== false);
    return activeLocations.length > 0 ? activeLocations : locations;
  }, [locations]);

  const submitLocationOptions = useMemo(() => {
    const optionsById = new Map<string, { id: string; name: string; shortCode?: string }>();

    availableLocations.forEach((location) => {
      optionsById.set(location.id, {
        id: location.id,
        name: location.name,
        shortCode: location.short_code,
      });
    });

    locationsWithCart.forEach((location) => {
      if (optionsById.has(location.id)) return;
      optionsById.set(location.id, {
        id: location.id,
        name: location.name,
        shortCode: location.short_code,
      });
    });

    return Array.from(optionsById.values());
  }, [availableLocations, locationsWithCart]);

  const locationNameById = useMemo(() => {
    const next = new Map<string, string>();
    submitLocationOptions.forEach((location) => {
      next.set(location.id, location.name);
    });
    return next;
  }, [submitLocationOptions]);

  const inventoryItemsById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [items]);

  const showStatusToast = useCallback((message: string, type: 'success' | 'error') => {
    setStatusToast({ message, type });
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.delay(1700),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStatusToast(null);
    });
  }, [toastOpacity]);

  // Get cart items with inventory details for a location
  const getCartWithDetails = useCallback((locationId: string): CartItemWithDetails[] => {
    const cartItems = getCartItems(locationId, context);
    return cartItems.map((cartItem) => ({
      ...cartItem,
      inventoryItem: inventoryItemsById.get(cartItem.inventoryItemId),
    }));
  }, [context, getCartItems, inventoryItemsById]);

  const menuItem = useMemo(() => {
    if (!menuTarget) {
      return null;
    }

    const cartItem = getCartItems(menuTarget.locationId, context).find(
      (item) => item.id === menuTarget.cartItemId,
    );
    if (!cartItem) {
      return null;
    }

    return {
      locationId: menuTarget.locationId,
      item: {
        ...cartItem,
        inventoryItem: inventoryItemsById.get(cartItem.inventoryItemId),
      },
    };
  }, [context, getCartItems, inventoryItemsById, menuTarget]);

  const selectableItemLocations = useMemo(
    () => availableLocations.filter((location) => location.id !== menuItem?.locationId),
    [availableLocations, menuItem?.locationId]
  );

  useEffect(() => {
    if (menuTarget && !menuItem) {
      setShowItemMenu(false);
      setShowItemLocationModal(false);
      setShowItemNoteModal(false);
      setItemLocationAction(null);
      setItemNoteDraft('');
      setMenuTarget(null);
    }
  }, [menuItem, menuTarget]);

  // Toggle item expansion
  const toggleExpand = useCallback((locationId: string, itemId: string) => {
    const key = `${locationId}-${itemId}`;
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }, []);

  useEffect(() => {
    setExpandedItems((previous) => {
      if (previous.size === 0) return previous;

      const validKeys = new Set<string>();
      cartLocationIds.forEach((locationId) => {
        getCartItems(locationId, context).forEach((item) => {
          validKeys.add(`${locationId}-${item.id}`);
        });
      });

      let changed = false;
      const filtered = new Set<string>();
      previous.forEach((key) => {
        if (validKeys.has(key)) {
          filtered.add(key);
          return;
        }
        changed = true;
      });

      return changed ? filtered : previous;
    });
  }, [cartLocationIds, context, getCartItems]);

  const handleItemValueChange = useCallback(
    (locationId: string, item: CartItemWithDetails, nextValue: number, unitType: UnitType) => {
      if (item.inputMode === 'quantity') {
        updateCartItem(locationId, item.inventoryItemId, nextValue, unitType, {
          cartItemId: item.id,
          inputMode: 'quantity',
          quantityRequested: nextValue,
          context,
        });
        return;
      }

      updateCartItem(locationId, item.inventoryItemId, Math.max(0, nextValue), unitType, {
        cartItemId: item.id,
        inputMode: 'remaining',
        remainingReported: Math.max(0, nextValue),
        context,
      });
    },
    [context, updateCartItem]
  );

  // Handle remove item
  const handleRemoveItem = useCallback((locationId: string, itemId: string, itemName: string, cartItemId: string) => {
    Alert.alert(
      'Remove Item',
      `Remove ${itemName} from cart?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFromCart(locationId, itemId, cartItemId, context);
          },
        },
      ]
    );
  }, [context, removeFromCart]);

  const handleOpenCartLocationModal = useCallback((location: Location) => {
    setCartLocationToMove(location);
    setShowCartLocationModal(true);
  }, []);

  const handleMoveCartLocation = useCallback((toLocationId: string, toLocationName: string) => {
    if (!cartLocationToMove) return;
    if (cartLocationToMove.id === toLocationId) {
      setShowCartLocationModal(false);
      return;
    }

    Alert.alert(
      'Change Cart Location',
      `Move all items from ${cartLocationToMove.name} to ${toLocationName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: () => {
            moveLocationCartItems(cartLocationToMove.id, toLocationId, context);
            setShowCartLocationModal(false);
            setCartLocationToMove(null);
          },
        },
      ]
    );
  }, [cartLocationToMove, context, moveLocationCartItems]);

  const handleOpenItemMenu = useCallback((locationId: string, item: CartItemWithDetails) => {
    setMenuTarget({ locationId, cartItemId: item.id });
    setShowItemMenu(true);
  }, []);

  const applyItemModeChange = useCallback((
    locationId: string,
    item: CartItemWithDetails,
    nextMode: 'quantity' | 'remaining'
  ) => {
    const currentValue =
      item.inputMode === 'quantity'
        ? item.quantityRequested ?? item.quantity
        : item.remainingReported ?? 0;

    if (nextMode === 'remaining') {
      const nextRemaining = Math.max(0, currentValue);
      updateCartItem(locationId, item.inventoryItemId, nextRemaining, item.unitType, {
        cartItemId: item.id,
        inputMode: 'remaining',
        remainingReported: nextRemaining,
        context,
      });
    } else {
      const nextQuantity = Math.max(1, item.decidedQuantity ?? currentValue ?? 1);
      updateCartItem(locationId, item.inventoryItemId, nextQuantity, item.unitType, {
        cartItemId: item.id,
        inputMode: 'quantity',
        quantityRequested: nextQuantity,
        clearDecision: true,
        context,
      });
    }

  }, [context, updateCartItem]);

  const handleDuplicateItem = useCallback(() => {
    if (!menuItem) return;
    const { locationId, item } = menuItem;
    if (!item.inventoryItem) return;

    if (item.inputMode === 'remaining') {
      Alert.alert('Not available', 'Remaining-mode items cannot be duplicated.');
      setShowItemMenu(false);
      setMenuTarget(null);
      return;
    }

    const baseQuantity = item.quantityRequested ?? item.quantity;
    updateCartItem(locationId, item.inventoryItemId, baseQuantity + baseQuantity, item.unitType, {
      cartItemId: item.id,
      inputMode: 'quantity',
      quantityRequested: baseQuantity + baseQuantity,
      context,
    });
    setShowItemMenu(false);
    setMenuTarget(null);
  }, [context, menuItem, updateCartItem]);

  const handleToggleItemMode = useCallback(() => {
    if (!menuItem) return;

    const { locationId, item } = menuItem;
    const nextMode = item.inputMode === 'quantity' ? 'remaining' : 'quantity';
    applyItemModeChange(locationId, item, nextMode);
    setShowItemMenu(false);
    setMenuTarget(null);
  }, [applyItemModeChange, menuItem]);

  const handleOpenItemNoteModal = useCallback(() => {
    if (!menuItem) return;
    setItemNoteDraft(menuItem.item.note ?? '');
    setShowItemMenu(false);
    setShowItemNoteModal(true);
  }, [menuItem]);

  const handleSaveItemNote = useCallback(() => {
    if (!menuItem) return;
    setCartItemNote(menuItem.locationId, menuItem.item.id, itemNoteDraft, context);
    setShowItemNoteModal(false);
    setItemNoteDraft('');
    setMenuTarget(null);
  }, [context, menuItem, itemNoteDraft, setCartItemNote]);

  const applyItemLocationAction = useCallback((params: {
    sourceLocationId: string;
    item: CartItemWithDetails;
    action: 'add' | 'move';
    toLocationId: string;
  }) => {
    if (params.sourceLocationId === params.toLocationId) {
      return;
    }

    if (params.action === 'add') {
      if (params.item.inputMode === 'quantity') {
        const qty = params.item.quantityRequested ?? params.item.quantity;
        addToCart(params.toLocationId, params.item.inventoryItemId, qty, params.item.unitType, {
          inputMode: 'quantity',
          quantityRequested: qty,
          note: params.item.note,
          context,
        });
      } else {
        const remaining = params.item.remainingReported ?? 0;
        addToCart(params.toLocationId, params.item.inventoryItemId, remaining, params.item.unitType, {
          inputMode: 'remaining',
          remainingReported: remaining,
          decidedQuantity: params.item.decidedQuantity,
          decidedBy: params.item.decidedBy,
          decidedAt: params.item.decidedAt,
          note: params.item.note,
          context,
        });
      }
    } else {
      moveCartItem(
        params.sourceLocationId,
        params.toLocationId,
        params.item.inventoryItemId,
        params.item.unitType,
        params.item.id,
        context
      );
    }
  }, [addToCart, context, moveCartItem]);

  const handleOpenItemLocationModal = useCallback((action: 'add' | 'move') => {
    if (!menuItem) return;

    setShowItemMenu(false);

    const switchResolution = resolveLocationSwitchTarget({
      currentLocationId: menuItem.locationId,
      availableLocationIds: availableLocations.map((location) => location.id),
    });

    if (switchResolution.mode === 'toggle' && switchResolution.targetLocationId) {
      applyItemLocationAction({
        sourceLocationId: menuItem.locationId,
        item: menuItem.item,
        action,
        toLocationId: switchResolution.targetLocationId,
      });
      setItemLocationAction(null);
      setShowItemLocationModal(false);
      setMenuTarget(null);
      return;
    }

    if (switchResolution.mode === 'selector') {
      setItemLocationAction(action);
      setShowItemLocationModal(true);
      return;
    }

    showStatusToast('No other location available', 'error');
    setItemLocationAction(null);
    setShowItemLocationModal(false);
    setMenuTarget(null);
  }, [availableLocations, menuItem, applyItemLocationAction, showStatusToast]);

  const handleApplyItemLocation = useCallback((toLocationId: string) => {
    if (!menuItem || !itemLocationAction) return;

    applyItemLocationAction({
      sourceLocationId: menuItem.locationId,
      item: menuItem.item,
      action: itemLocationAction,
      toLocationId,
    });

    setShowItemLocationModal(false);
    setItemLocationAction(null);
    setMenuTarget(null);
  }, [menuItem, itemLocationAction, applyItemLocationAction]);

  const itemActionSections = useMemo<ItemActionSheetSection[]>(() => [
    {
      id: 'item-basics',
      title: 'Item',
      items: [
        {
          id: 'duplicate',
          label: 'Duplicate item',
          icon: 'copy-outline',
          detail:
            menuItem?.item.inputMode === 'remaining'
              ? 'Only direct order quantities can be duplicated.'
              : 'Add the same quantity to this cart.',
          onPress: handleDuplicateItem,
          disabled: menuItem?.item.inputMode === 'remaining',
        },
        {
          id: 'toggle-mode',
          label: menuItem?.item.inputMode === 'remaining' ? 'Change to Order' : 'Change to Remaining',
          icon: menuItem?.item.inputMode === 'remaining' ? 'receipt-outline' : 'albums-outline',
          detail:
            menuItem?.item.inputMode === 'remaining'
              ? 'Switch back to a direct order quantity.'
              : 'Track what is left and decide the final order later.',
          onPress: handleToggleItemMode,
        },
        {
          id: 'note',
          label: menuItem?.item.note ? 'Edit Note' : 'Add Note',
          icon: 'document-text-outline',
          detail: 'Attach a note for the manager on this cart line.',
          onPress: handleOpenItemNoteModal,
        },
      ],
    },
    {
      id: 'cart-move',
      title: 'Other Carts',
      items: [
        {
          id: 'add-to-other',
          label: 'Add to other cart',
          icon: 'bag-add-outline',
          detail: 'Copy this line into another location cart.',
          onPress: () => handleOpenItemLocationModal('add'),
        },
        {
          id: 'move-to-other',
          label: 'Move to other cart',
          icon: 'arrow-redo-outline',
          detail: 'Move this line out of the current cart.',
          onPress: () => handleOpenItemLocationModal('move'),
        },
      ],
    },
  ], [
    handleDuplicateItem,
    handleOpenItemLocationModal,
    handleOpenItemNoteModal,
    handleToggleItemMode,
    menuItem?.item.inputMode,
    menuItem?.item.note,
  ]);

  // Handle clear location cart
  const handleClearLocationCart = useCallback((locationId: string, locationName: string) => {
    Alert.alert(
      'Clear Cart',
      `Remove all items for ${locationName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearLocationCart(locationId, context);
          },
        },
      ]
    );
  }, [clearLocationCart, context]);

  // Track which location is currently submitting
  const [submittingLocation, setSubmittingLocation] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const canSubmitLocation = useCallback((locationId: string) => {
    if (submitInFlightRef.current || submittingLocation !== null) {
      return false;
    }

    if (orderConfirmation) {
      return false;
    }

    if (!user) {
      showStatusToast('Please log in first', 'error');
      return false;
    }

    const cartItems = getCartItems(locationId, context);
    if (cartItems.length === 0) {
      showStatusToast('Cart is empty for this location', 'error');
      return false;
    }

    return true;
  }, [context, getCartItems, orderConfirmation, showStatusToast, submittingLocation, user]);

  const handleReorderPastOrder = useCallback((order: HistoricalOrderSummary) => {
    const targetLocationId = selectedLocation?.id ?? order.locationId;
    order.items.forEach((item) => {
      addToCart(targetLocationId, item.inventoryItemId, item.quantity, item.unitType, {
        context,
        inputMode: 'quantity',
        quantityRequested: item.quantity,
        note: item.note,
      });
    });
    showStatusToast(`Added ${order.itemCount} items to cart`, 'success');
  }, [addToCart, context, selectedLocation?.id, showStatusToast]);

  const submitOrderForLocation = useCallback(async (
    submitLocationId: string,
    locationName: string,
    sourceLocationId: string = submitLocationId
  ) => {
    if (submitInFlightRef.current) return;

    if (!user) {
      showStatusToast('Please log in first', 'error');
      return;
    }

    const cartItems = getCartItems(sourceLocationId, context);
    if (cartItems.length === 0) {
      showStatusToast('Cart is empty for this location', 'error');
      return;
    }

    submitInFlightRef.current = true;
    setSubmittingLocation(sourceLocationId);
    try {
      const submitPromise = sourceLocationId !== submitLocationId
        ? createAndSubmitOrderFromSourceLocation(
          sourceLocationId,
          submitLocationId,
          user.id,
          context
        )
        : createAndSubmitOrder(submitLocationId, user.id, context);
      const order = await withPromiseTimeout(
        submitPromise,
        ORDER_SUBMIT_UI_TIMEOUT_MS,
        'Order submission timed out. Please check your connection and try again.'
      );
      const normalizedOrderNumber =
        typeof order.order_number === 'number' || typeof order.order_number === 'string'
          ? String(order.order_number)
          : null;
      const submittedBy =
        profile?.full_name?.trim() ||
        user.name?.trim() ||
        user.email?.trim() ||
        'Staff';
      const itemCount = order.order_items?.length ?? cartItems.length;
      setOrderConfirmation({
        orderId: order.id,
        orderNumber: normalizedOrderNumber,
        locationName,
        itemCount,
        summary: formatOrderConfirmationSummary(itemCount, locationName),
        submittedBy,
        submittedAt: order.created_at,
      });
      void triggerConfirmationHaptic();
      // Mark pending reminders as completed client-side (DB trigger is primary)
      completePendingRemindersForUser(user.id).catch(() => {});
      resolveActiveLocationReminders(submitLocationId).catch(() => {});
    } catch (error: any) {
      const isRetryable = error instanceof OrderSubmissionError ? error.retryable : true;
      const title = isRetryable ? 'Submit Order Failed' : 'Cannot Submit Order';
      const message = error?.message || 'Something went wrong. Please try again.';
      Alert.alert(title, message);
    } finally {
      submitInFlightRef.current = false;
      setSubmittingLocation(null);
    }
  }, [
    context,
    user,
    getCartItems,
    createAndSubmitOrder,
    createAndSubmitOrderFromSourceLocation,
    profile?.full_name,
    showStatusToast,
  ]);

  const handleRequestSubmitOrder = useCallback(async (locationId: string) => {
    if (!canSubmitLocation(locationId)) return;

    void triggerConfirmationHaptic();

    const locationName = locationNameById.get(locationId) ?? 'Selected location';

    if (!requiresLocationConfirm) {
      await submitOrderForLocation(locationId, locationName);
      return;
    }

    setConfirmSourceLocationId(locationId);
    setConfirmLocationId(locationId);
    setShowConfirmLocationSheet(true);
  }, [canSubmitLocation, locationNameById, requiresLocationConfirm, submitOrderForLocation]);

  const handleSelectSubmitLocation = useCallback((locationId: string) => {
    if (confirmLocationId === locationId) {
      return;
    }

    setConfirmLocationId(locationId);
    void triggerConfirmationHaptic();
  }, [confirmLocationId]);

  const handleConfirmSubmitOrder = useCallback(async () => {
    if (!confirmLocationId) return;

    const sourceLocationId = confirmSourceLocationId ?? confirmLocationId;
    if (!canSubmitLocation(sourceLocationId)) {
      setShowConfirmLocationSheet(false);
      setConfirmSourceLocationId(null);
      setConfirmLocationId(null);
      return;
    }

    const selectedLocationName = locationNameById.get(confirmLocationId) ?? 'Selected location';

    void triggerConfirmationHaptic();
    setShowConfirmLocationSheet(false);
    setConfirmSourceLocationId(null);
    setConfirmLocationId(null);

    await submitOrderForLocation(confirmLocationId, selectedLocationName, sourceLocationId);
  }, [
    canSubmitLocation,
    confirmSourceLocationId,
    confirmLocationId,
    locationNameById,
    submitOrderForLocation,
  ]);

  const handleUnavailableSubmitLocationChange = useCallback(() => {
    showStatusToast('No other location available', 'error');
  }, [showStatusToast]);

  // Render a compact cart item
  const renderCartItem = useCallback((locationId: string, item: CartItemWithDetails) => {
    const { unitType } = item;
    const inventoryItem = item.inventoryItem;
    const itemName = inventoryItem?.name || `Item ${item.inventoryItemId.slice(0, 8)}`;
    const isRemainingMode = item.inputMode === 'remaining';
    const value = isRemainingMode ? item.remainingReported ?? 0 : item.quantityRequested ?? item.quantity;
    const packUnitLabel = inventoryItem?.pack_unit || 'pack';
    const baseUnitLabel = inventoryItem?.base_unit || 'unit';
    const unitLabel = unitType === 'pack' ? packUnitLabel : baseUnitLabel;
    const key = `${locationId}-${item.id}`;
    const isExpanded = expandedItems.has(key);

    return (
      <View
        key={`${locationId}-${item.id}`}
        style={{
          borderBottomWidth: glassHairlineWidth,
          borderBottomColor: glassColors.divider,
        }}
      >
        {/* Compact Row — matches reference: name/unit left, stepper right */}
        <TouchableOpacity
          onPress={() => toggleExpand(locationId, item.id)}
          className="flex-row items-center"
          style={{
            minHeight: 64,
            paddingVertical: ds.spacing(10),
          }}
          activeOpacity={0.7}
        >
          <View className="flex-1 mr-3">
            <View className="flex-row items-center">
              <Text
                style={{
                  fontSize: ds.fontSize(17),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                  flexShrink: 1,
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {itemName}
              </Text>
              <Ionicons
                name={isExpanded ? "chevron-up" : "chevron-down"}
                size={ds.icon(16)}
                color={glassColors.textSecondary}
                style={{ marginLeft: ds.spacing(6) }}
              />
            </View>
            <View className="flex-row items-center mt-1">
              <Text
                style={{
                  fontSize: ds.fontSize(14),
                  color: glassColors.textSecondary,
                }}
              >
                per {unitLabel}
              </Text>
              {isRemainingMode && (
                <View
                  style={{
                    marginLeft: ds.spacing(8),
                    borderRadius: glassRadii.tag,
                    backgroundColor: glassColors.warningSoft,
                    paddingHorizontal: ds.spacing(8),
                    paddingVertical: ds.spacing(2),
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '500',
                      color: glassColors.warningText,
                    }}
                  >
                    Remaining
                  </Text>
                </View>
              )}
              {item.note && (
                <View
                  style={{
                    marginLeft: ds.spacing(6),
                    borderRadius: glassRadii.tag,
                    backgroundColor: glassColors.infoSoft,
                    paddingHorizontal: ds.spacing(8),
                    paddingVertical: ds.spacing(2),
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '500',
                      color: glassColors.infoText,
                    }}
                  >
                    Note
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Inline stepper — matches reference */}
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => handleItemValueChange(locationId, item, value - 1, unitType)}
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#E8E8E8',
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="remove" size={22} color={glassColors.textPrimary} />
            </TouchableOpacity>

            <Text
              style={{
                fontSize: ds.fontSize(20),
                fontWeight: '600',
                color: glassColors.textPrimary,
                textAlign: 'center',
                minWidth: 44,
                marginHorizontal: ds.spacing(4),
              }}
            >
              {value}
            </Text>

            <TouchableOpacity
              onPress={() => handleItemValueChange(locationId, item, value + 1, unitType)}
              style={{
                width: 42,
                height: 42,
                borderRadius: 13,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#E8E8E8',
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="add" size={22} color={glassColors.textPrimary} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {/* Expanded Controls — advanced options */}
        {isExpanded && (
          <View style={{ paddingBottom: ds.spacing(10), paddingHorizontal: ds.spacing(4) }}>
            {/* Mode selector row + action buttons */}
            <View className="flex-row items-center justify-between" style={{ marginBottom: ds.spacing(8) }}>
              <View
                className="flex-row"
                style={{
                  backgroundColor: segmentedControlColors.inactiveBackground,
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <TouchableOpacity
                  onPress={() => applyItemModeChange(locationId, item, 'quantity')}
                  style={{
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(7),
                    backgroundColor: !isRemainingMode
                      ? segmentedControlColors.activeBackground
                      : 'transparent',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      fontWeight: '600',
                      color: !isRemainingMode
                        ? segmentedControlColors.activeText
                        : segmentedControlColors.inactiveText,
                    }}
                  >
                    Order Qty
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => applyItemModeChange(locationId, item, 'remaining')}
                  style={{
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(7),
                    backgroundColor: isRemainingMode
                      ? segmentedControlColors.activeBackground
                      : 'transparent',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      fontWeight: '600',
                      color: isRemainingMode
                        ? segmentedControlColors.activeText
                        : segmentedControlColors.inactiveText,
                    }}
                  >
                    Remaining
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Action buttons — menu + trash */}
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => handleOpenItemMenu(locationId, item)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: '#EEEEEE',
                    marginRight: ds.spacing(6),
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={glassColors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRemoveItem(locationId, item.inventoryItemId, itemName, item.id)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={20} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Unit toggle row */}
            <View className="flex-row items-center" style={{ marginBottom: ds.spacing(6) }}>
              <View
                className="flex-row"
                style={{
                  backgroundColor: segmentedControlColors.inactiveBackground,
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <TouchableOpacity
                  onPress={() => handleItemValueChange(locationId, item, value, 'pack')}
                  style={{
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(7),
                    backgroundColor: unitType === 'pack'
                      ? segmentedControlColors.activeBackground
                      : 'transparent',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      fontWeight: '600',
                      color: unitType === 'pack'
                        ? segmentedControlColors.activeText
                        : segmentedControlColors.inactiveText,
                    }}
                  >
                    {packUnitLabel}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleItemValueChange(locationId, item, value, 'base')}
                  style={{
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(7),
                    backgroundColor: unitType === 'base'
                      ? segmentedControlColors.activeBackground
                      : 'transparent',
                  }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      fontWeight: '600',
                      color: unitType === 'base'
                        ? segmentedControlColors.activeText
                        : segmentedControlColors.inactiveText,
                    }}
                  >
                    {baseUnitLabel}
                  </Text>
                </TouchableOpacity>
              </View>
              {!isRemainingMode && (
                <Text
                  style={{ fontSize: ds.fontSize(13), color: glassColors.textSecondary, marginLeft: ds.spacing(10) }}
                  numberOfLines={1}
                >
                  {(inventoryItem?.pack_size ?? 1)} {baseUnitLabel}/{packUnitLabel}
                </Text>
              )}
            </View>

            {/* Notes */}
            {item.note && (
              <Text style={{ fontSize: ds.fontSize(13), color: glassColors.infoText, marginTop: ds.spacing(4) }}>
                Note: {item.note}
              </Text>
            )}
            {isRemainingMode && (
              <Text style={{ fontSize: ds.fontSize(12), color: glassColors.textSecondary, marginTop: ds.spacing(4) }}>
                Confirm quantity before submitting
              </Text>
            )}
          </View>
        )}
      </View>
    );
  }, [
    ds,
    expandedItems,
    toggleExpand,
    handleItemValueChange,
    handleOpenItemMenu,
    handleRemoveItem,
    applyItemModeChange,
  ]);

  // Render location section
  const renderLocationSection = useCallback((location: Location) => {
    const cartWithDetails = getCartWithDetails(location.id);
    const itemCount = cartWithDetails.length;
    const canSubmit = submittingLocation === null && itemCount > 0;
    const isSubmittingThisLocation = submittingLocation === location.id;

    return (
      <GlassSurface
        key={location.id}
        intensity="subtle"
        blurred={false}
        style={{ marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
      >
        {/* Location Header */}
        <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
          <View className="flex-row items-center justify-between">
            <TouchableOpacity
              onPress={() => handleOpenCartLocationModal(location)}
              className="flex-row items-center flex-1 mr-2"
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View
                style={{
                  width: ds.icon(40),
                  height: ds.icon(40),
                  borderRadius: glassRadii.round,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: ds.spacing(12),
                  backgroundColor: glassColors.mediumFill,
                }}
              >
                <BrandLogo variant="inline" size={20} colorMode="light" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text
                    style={{ fontSize: ds.fontSize(17), fontWeight: '700', color: glassColors.textPrimary }}
                    className="flex-shrink"
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {location.name}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={ds.icon(14)}
                    color={colors.gray[500]}
                    style={{ marginLeft: ds.spacing(6) }}
                  />
                </View>
                <Text style={{ fontSize: ds.fontSize(13), color: glassColors.textSecondary }}>
                  {itemCount} item{itemCount !== 1 ? 's' : ''} in cart
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleClearLocationCart(location.id, location.name)}
              style={{ paddingVertical: ds.spacing(6), paddingHorizontal: ds.spacing(8) }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary, fontWeight: '500' }}>
                Clear all
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Items List */}
        <View style={{ paddingHorizontal: ds.spacing(16) }}>
          {cartWithDetails.map((item) => renderCartItem(location.id, item))}
        </View>

        {/* Submit Order Button */}
        <TouchableOpacity
          onPress={() => { void handleRequestSubmitOrder(location.id); }}
          disabled={!canSubmit}
          className="items-center flex-row justify-center"
          style={{
            height: Math.max(56, ds.buttonH + 8),
            marginHorizontal: ds.spacing(16),
            marginBottom: ds.spacing(16),
            borderRadius: glassRadii.submitButton,
            backgroundColor: !canSubmit ? glassColors.accentSoft : glassColors.accent,
          }}
        >
          {isSubmittingThisLocation ? (
            <>
              <LoadingIndicator size="small" />
              <Text style={{ fontSize: ds.fontSize(17), color: colors.white, fontWeight: '700', marginLeft: ds.spacing(8) }}>
                Submitting...
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="send" size={ds.icon(20)} color={colors.white} />
              <Text style={{ fontSize: ds.fontSize(17), color: colors.white, fontWeight: '700', marginLeft: ds.spacing(8) }}>
                Submit Order
              </Text>
            </>
          )}
        </TouchableOpacity>
      </GlassSurface>
    );
  }, [ds, getCartWithDetails, renderCartItem, handleClearLocationCart, submittingLocation, handleOpenCartLocationModal, handleRequestSubmitOrder]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <View
        ref={cartScreenBlurTargetRef}
        collapsable={false}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View
          style={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(12),
            paddingBottom: ds.spacing(12),
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
            <Text style={{ fontSize: ds.fontSize(30), fontWeight: '800', color: glassColors.textPrimary, letterSpacing: -0.6 }}>
              Cart
            </Text>
            <Text style={{ marginTop: ds.spacing(4), fontSize: ds.fontSize(13), color: glassColors.textSecondary, fontWeight: '500' }}>
              {totalCartCountLabel}
            </Text>
          </View>
          {pastOrdersRoute && (
            <GlassSurface intensity="subtle" style={{ borderRadius: glassRadii.pill }}>
              <TouchableOpacity
                onPress={() => router.push(pastOrdersRoute as any)}
                className="flex-row items-center"
                style={{ paddingHorizontal: ds.spacing(13), minHeight: Math.max(36, Math.min(ds.buttonH, 40)) }}
                activeOpacity={0.7}
              >
                <Ionicons name="time-outline" size={ds.icon(15)} color={glassColors.textSecondary} />
                <Text style={{ fontSize: ds.fontSize(13), marginLeft: ds.spacing(6), color: glassColors.textPrimary, fontWeight: '600' }}>
                  My Orders
                </Text>
              </TouchableOpacity>
            </GlassSurface>
          )}
        </View>

        {totalCartCount > 0 ? (
          <FlatList
            data={locationsWithCart}
            keyExtractor={(location) => location.id}
            renderItem={({ item }) => renderLocationSection(item)}
            className="flex-1"
            contentContainerStyle={{
              paddingHorizontal: glassSpacing.screen,
              paddingBottom: glassTabBarHeight + ds.spacing(20),
            }}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={4}
            maxToRenderPerBatch={6}
            windowSize={8}
            ListHeaderComponent={null}
          />
        ) : (
          <EmptyCartReorderState
            browseRoute={emptyCartBrowseRoute}
            locationId={selectedLocation?.id ?? locations[0]?.id ?? null}
            locationName={selectedLocation?.name ?? locations[0]?.name ?? 'Current location'}
            onReorder={handleReorderPastOrder}
            quickOrderRoute={quickOrderRoute}
          />
        )}
      </View>

      {/* Cart Location Modal */}
      <Modal
        visible={showCartLocationModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowCartLocationModal(false);
          setCartLocationToMove(null);
        }}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: colors.scrim }}
          onPress={() => {
            setShowCartLocationModal(false);
            setCartLocationToMove(null);
          }}
        >
          <Pressable
            style={{
              backgroundColor: glassColors.background,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pt-3 pb-2">
              <View style={{ width: 40, height: 4, backgroundColor: glassColors.mediumFill, borderRadius: glassRadii.round }} />
            </View>

            <View style={{ paddingHorizontal: ds.spacing(24) }} className="pb-8">
              <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: glassColors.textPrimary, marginBottom: ds.spacing(8) }}>
                Change Cart Location
              </Text>
              <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary, marginBottom: ds.spacing(16) }}>
                Move all items from {cartLocationToMove?.name || 'this cart'}
              </Text>

              <ScrollView
                style={{ maxHeight: ds.spacing(360) }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: ds.spacing(8) }}
                keyboardShouldPersistTaps="handled"
              >
                {locations.map((loc) => {
                  const isSelected = cartLocationToMove?.id === loc.id;
                  return (
                    <TouchableOpacity
                      key={loc.id}
                      style={{
                        padding: ds.spacing(16),
                        borderRadius: glassRadii.surface,
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginBottom: ds.spacing(12),
                        borderWidth: glassHairlineWidth,
                        borderColor: isSelected ? glassColors.accent : glassColors.cardBorder,
                        backgroundColor: isSelected ? glassColors.accentSoft : glassColors.subtleFill,
                      }}
                      onPress={() => handleMoveCartLocation(loc.id, loc.name)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={{
                          width: ds.icon(44),
                          height: ds.icon(44),
                          borderRadius: ds.icon(22),
                          backgroundColor: glassColors.mediumFill,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <BrandLogo variant="inline" size={18} colorMode="light" />
                      </View>
                      <View className="flex-1 ml-4">
                        <Text style={{ fontSize: ds.fontSize(16), fontWeight: '600', color: glassColors.textPrimary }}>
                          {loc.name}
                        </Text>
                        {isSelected && (
                          <Text style={{ fontSize: ds.fontSize(13), color: glassColors.accent }}>Current location</Text>
                        )}
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={ds.icon(20)} color={glassColors.accent[500]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                onPress={() => {
                  setShowCartLocationModal(false);
                  setCartLocationToMove(null);
                }}
                className="py-4 mt-2"
              >
                <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary, fontWeight: '500', textAlign: 'center' }}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmLocationBottomSheet
        visible={requiresLocationConfirm && showConfirmLocationSheet}
        selectedLocationId={confirmLocationId}
        locationOptions={submitLocationOptions}
        isSubmitting={submittingLocation !== null}
        onLocationChange={handleSelectSubmitLocation}
        onNoLocationAvailable={handleUnavailableSubmitLocationChange}
        onConfirm={() => { void handleConfirmSubmitOrder(); }}
        onClose={() => {
          setShowConfirmLocationSheet(false);
          setConfirmLocationId(null);
          setConfirmSourceLocationId(null);
        }}
      />

      <ItemActionSheet
        visible={showItemMenu && Boolean(menuItem)}
        title={menuItem?.item.inventoryItem?.name || 'Item Actions'}
        subtitle={menuItem ? getItemActionSummary(menuItem.item) : undefined}
        sections={itemActionSections}
        showCancelAction={false}
        onClose={() => {
          setShowItemMenu(false);
          setMenuTarget(null);
        }}
      />

      {/* Item Note Modal */}
      <Modal
        visible={showItemNoteModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowItemNoteModal(false);
          setItemNoteDraft('');
          setMenuTarget(null);
        }}
      >
        <Pressable
          className="flex-1"
          style={{ backgroundColor: colors.scrimStrong }}
          onPress={() => {
            setShowItemNoteModal(false);
            setItemNoteDraft('');
            setMenuTarget(null);
          }}
        >
          <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'flex-end' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            <Pressable
              style={{ paddingHorizontal: ds.spacing(24) }}
              className="pt-4 pb-6"
              onPress={(e) => e.stopPropagation()}
            >
              <GlassSurface
                intensity="subtle"
                blurred={false}
                style={{
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  paddingHorizontal: ds.spacing(24),
                  paddingTop: ds.spacing(16),
                  paddingBottom: ds.spacing(24),
                }}
              >
                <View className="items-center pb-3">
                  <View style={{ width: 40, height: 4, backgroundColor: glassColors.mediumFill, borderRadius: glassRadii.round }} />
                </View>
                <Text style={{ fontSize: ds.fontSize(18), fontWeight: '700', color: glassColors.textPrimary, marginBottom: ds.spacing(4) }}>
                  {menuItem?.item.note ? 'Edit Note' : 'Add Note'}
                </Text>
                <Text style={{ fontSize: ds.fontSize(13), color: glassColors.textSecondary, marginBottom: ds.spacing(16) }}>
                  {menuItem?.item.inventoryItem?.name || 'Item'}
                </Text>

                <TextInput
                  value={itemNoteDraft}
                  onChangeText={setItemNoteDraft}
                  placeholder="Add special request for manager..."
                  placeholderTextColor={colors.gray[400]}
                  multiline
                  maxLength={240}
                  textAlignVertical="top"
                  style={{
                    fontSize: ds.fontSize(14),
                    borderRadius: glassRadii.surface,
                    paddingHorizontal: ds.spacing(16),
                    minHeight: 110,
                    paddingVertical: ds.spacing(12),
                    color: glassColors.textPrimary,
                    backgroundColor: glassColors.mediumFill,
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.cardBorder,
                  }}
                />
                <Text style={{ fontSize: ds.fontSize(12), color: glassColors.textSecondary, marginTop: ds.spacing(8) }}>
                  {itemNoteDraft.length}/240
                </Text>

                <View className="flex-row mt-5">
                  <TouchableOpacity
                    onPress={() => {
                      setShowItemNoteModal(false);
                      setItemNoteDraft('');
                      setMenuTarget(null);
                    }}
                    style={{
                      height: ds.buttonH,
                      borderRadius: glassRadii.button,
                      flex: 1,
                      marginRight: ds.spacing(8),
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: glassColors.mediumFill,
                      borderWidth: glassHairlineWidth,
                      borderColor: glassColors.cardBorder,
                    }}
                  >
                    <Text style={{ fontSize: ds.buttonFont, color: glassColors.textPrimary, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveItemNote}
                    style={{
                      height: ds.buttonH,
                      borderRadius: glassRadii.button,
                      flex: 1,
                      marginLeft: ds.spacing(8),
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: glassColors.accent[500],
                    }}
                  >
                    <Text style={{ fontSize: ds.buttonFont, color: glassColors.textOnPrimary, fontWeight: '600' }}>Save Note</Text>
                  </TouchableOpacity>
                </View>
              </GlassSurface>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Item Location Picker */}
      <Modal
        visible={showItemLocationModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowItemLocationModal(false);
          setItemLocationAction(null);
          setMenuTarget(null);
        }}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: colors.scrim }}
          onPress={() => {
            setShowItemLocationModal(false);
            setItemLocationAction(null);
            setMenuTarget(null);
          }}
        >
          <Pressable
            style={{
              backgroundColor: glassColors.background,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pt-3 pb-2">
              <View style={{ width: 40, height: 4, backgroundColor: glassColors.mediumFill, borderRadius: glassRadii.round }} />
            </View>

            <View style={{ paddingHorizontal: ds.spacing(24) }} className="pb-8">
              <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: glassColors.textPrimary, marginBottom: ds.spacing(8) }}>
                {itemLocationAction === 'add' ? 'Add to Cart' : 'Move to Cart'}
              </Text>
              <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary, marginBottom: ds.spacing(16) }}>
                {menuItem?.item.inventoryItem?.name || 'Item'}
              </Text>

              <ScrollView
                style={{ maxHeight: ds.spacing(360) }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: ds.spacing(8) }}
                keyboardShouldPersistTaps="handled"
              >
                {selectableItemLocations.map((loc) => {
                    const cartCount = getCartItems(loc.id, context).length;
                    return (
                      <TouchableOpacity
                        key={loc.id}
                        style={{
                          padding: ds.spacing(16),
                          borderRadius: glassRadii.surface,
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: ds.spacing(12),
                          borderWidth: glassHairlineWidth,
                          borderColor: glassColors.cardBorder,
                          backgroundColor: glassColors.subtleFill,
                        }}
                        onPress={() => handleApplyItemLocation(loc.id)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={{
                            width: ds.icon(44),
                            height: ds.icon(44),
                            borderRadius: ds.icon(22),
                            backgroundColor: glassColors.accentSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ fontSize: ds.fontSize(13), color: glassColors.accent, fontWeight: '700' }}>
                            {loc.short_code}
                          </Text>
                        </View>
                        <View className="flex-1 ml-4">
                          <Text style={{ fontSize: ds.fontSize(16), fontWeight: '600', color: glassColors.textPrimary }}>
                            {loc.name}
                          </Text>
                          {cartCount > 0 && (
                            <Text style={{ fontSize: ds.fontSize(13), color: glassColors.textSecondary }}>
                              {cartCount} item{cartCount !== 1 ? 's' : ''} in cart
                            </Text>
                          )}
                        </View>
                        <Ionicons name="arrow-forward" size={ds.icon(20)} color={glassColors.accent[500]} />
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>

              <TouchableOpacity
                onPress={() => {
                  setShowItemLocationModal(false);
                  setItemLocationAction(null);
                  setMenuTarget(null);
                }}
                className="py-4 mt-2"
              >
                <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary, fontWeight: '500', textAlign: 'center' }}>
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {statusToast && (
        <Animated.View
          pointerEvents="none"
          style={{
            opacity: toastOpacity,
            position: 'absolute',
            left: ds.spacing(20),
            right: ds.spacing(20),
            bottom: toastBottomOffset,
          }}
        >
          <View
            style={{
              borderRadius: ds.radius(12),
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(12),
              backgroundColor: statusToast.type === 'error' ? colors.error : glassColors.textPrimary,
            }}
          >
            <Text style={{ fontSize: ds.fontSize(13), color: colors.white, textAlign: 'center', fontWeight: '500' }}>
              {statusToast.message}
            </Text>
          </View>
        </Animated.View>
      )}

      <OrderSubmissionConfirmationOverlay
        confirmation={orderConfirmation}
        blurTargetRef={cartScreenBlurTargetRef}
        onDismissed={() => {
          setOrderConfirmation(null);
        }}
      />
    </SafeAreaView>
  );
}
