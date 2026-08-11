import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyStateCard } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  colors,
  getCategoryTint,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import type { InventoryItem } from '@/types';

interface AddItemsSheetProps {
  visible: boolean;
  items: InventoryItem[];
  /** Inventory item ids already checked on the checklist. */
  selectedItemIds: Set<string>;
  onAddItem: (item: InventoryItem) => void;
  onClose: () => void;
}

const MAX_RESULTS = 60;

export function AddItemsSheet({
  visible,
  items,
  selectedItemIds,
  onAddItem,
  onClose,
}: AddItemsSheetProps) {
  const ds = useScaledStyles();
  const [query, setQuery] = useState('');

  const handleClose = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized.length === 0
      ? items
      : items.filter((item) => {
          if (item.name.toLowerCase().includes(normalized)) return true;
          return (item.aliases ?? []).some((alias) =>
            alias.toLowerCase().includes(normalized),
          );
        });
    return matches.slice(0, MAX_RESULTS);
  }, [items, query]);

  const handleSelect = useCallback(
    (item: InventoryItem) => {
      void triggerSelectionHaptic();
      onAddItem(item);
    },
    [onAddItem],
  );

  const renderItem = useCallback(
    ({ item }: { item: InventoryItem }) => {
      const alreadySelected = selectedItemIds.has(item.id);
      const tint = getCategoryTint(item.category);
      return (
        <TouchableOpacity
          onPress={() => handleSelect(item)}
          disabled={alreadySelected}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={
            alreadySelected ? `${item.name}, already on order` : `Add ${item.name}`
          }
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 56,
            paddingVertical: ds.spacing(8),
            borderBottomWidth: glassHairlineWidth,
            borderBottomColor: glassColors.divider,
          }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: glassRadii.iconTile,
              backgroundColor: tint.background,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: ds.spacing(12),
            }}
          >
            <Ionicons name="cube-outline" size={ds.icon(18)} color={tint.icon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: ds.fontSize(16),
                fontWeight: '600',
                color: alreadySelected ? glassColors.textMuted : glassColors.textPrimary,
              }}
            >
              {item.name}
            </Text>
            <Text style={{ fontSize: ds.fontSize(12), color: glassColors.textMuted }}>
              {item.base_unit}
            </Text>
          </View>
          <Ionicons
            name={alreadySelected ? 'checkmark-circle' : 'add-circle-outline'}
            size={ds.icon(26)}
            color={alreadySelected ? glassColors.successText : glassColors.accent}
          />
        </TouchableOpacity>
      );
    },
    [ds, handleSelect, selectedItemIds],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView
        edges={['top', 'bottom']}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, paddingHorizontal: ds.spacing(16) }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingTop: ds.spacing(12),
              paddingBottom: ds.spacing(8),
            }}
          >
            <Text
              style={{
                flex: 1,
                fontSize: ds.fontSize(22),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              Add items
            </Text>
            <TouchableOpacity
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Done adding items"
              activeOpacity={0.7}
              style={{
                minHeight: 44,
                paddingHorizontal: ds.spacing(14),
                borderRadius: glassRadii.pill,
                backgroundColor: colors.primaryLight,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(16),
                  fontWeight: '700',
                  color: glassColors.accent,
                }}
              >
                Done
              </Text>
            </TouchableOpacity>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.glass,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
              borderRadius: glassRadii.search,
              paddingHorizontal: ds.spacing(14),
              minHeight: 48,
              marginBottom: ds.spacing(8),
            }}
          >
            <Ionicons
              name="search-outline"
              size={ds.icon(18)}
              color={glassColors.textMuted}
              style={{ marginRight: ds.spacing(8) }}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search inventory"
              placeholderTextColor={glassColors.textMuted}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search inventory items"
              style={{
                flex: 1,
                fontSize: ds.fontSize(16),
                color: glassColors.textPrimary,
                paddingVertical: 0,
              }}
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name="close-circle"
                  size={ds.icon(18)}
                  color={glassColors.textMuted}
                />
              </TouchableOpacity>
            ) : null}
          </View>

          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: ds.spacing(24) }}
            ListEmptyComponent={
              <View style={{ paddingTop: ds.spacing(24) }}>
                <EmptyStateCard
                  icon="search-outline"
                  title="No matching items"
                  message="Try a different search term."
                />
              </View>
            }
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
