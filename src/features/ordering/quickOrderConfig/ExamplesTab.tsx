import React, { useCallback, useState } from 'react';
import {
  Alert,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassRadii,
  grayScale,
} from '@/theme/design';
import type { ParserExampleRow } from '@/types';
import { ExampleEditorModal } from './ExampleEditorModal';
import {
  type QuickOrderConfigItem,
  formatExampleQuantity,
  getConflictPayload,
  getConflictResolution,
  getExampleType,
  getMappingRows,
} from './types';

interface ExamplesTabProps {
  examples: ParserExampleRow[];
  items: QuickOrderConfigItem[];
  onRefresh: () => Promise<void> | void;
}

export function ExamplesTab({ examples, items, onRefresh }: ExamplesTabProps) {
  const ds = useScaledStyles();
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingExample, setEditingExample] = useState<ParserExampleRow | null>(null);

  const openCreate = useCallback(() => {
    setEditingExample(null);
    setEditorVisible(true);
  }, []);

  const openEdit = useCallback((example: ParserExampleRow) => {
    setEditingExample(example);
    setEditorVisible(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorVisible(false);
    setEditingExample(null);
  }, []);

  const handleDelete = useCallback(
    (example: ParserExampleRow) => {
      Alert.alert('Delete example', `Delete "${example.raw_text}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('parser_examples')
                .delete()
                .eq('id', example.id);
              if (error) throw error;
              await onRefresh();
            } catch (error: any) {
              Alert.alert('Delete failed', error?.message ?? 'Unable to delete example.');
            }
          },
        },
      ]);
    },
    [onRefresh],
  );

  return (
    <View>
      <Text
        style={{
          fontSize: ds.fontSize(22),
          fontWeight: '800',
          color: glassColors.textPrimary,
          marginBottom: ds.spacing(12),
        }}
      >
        Training examples
      </Text>

      <TouchableOpacity
        onPress={openCreate}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: ds.spacing(8),
          minHeight: 52,
          borderRadius: glassRadii.surface,
          backgroundColor: colors.white,
          borderWidth: 1,
          borderColor: glassColors.cardBorder,
          marginBottom: ds.spacing(14),
        }}
      >
        <Ionicons name="add" size={ds.icon(20)} color={colors.primary} />
        <Text
          style={{
            color: colors.primary,
            fontSize: ds.fontSize(15),
            fontWeight: '700',
          }}
        >
          Add training example
        </Text>
      </TouchableOpacity>

      <View style={{ gap: ds.spacing(12) }}>
        {examples.map((example) =>
          getExampleType(example) === 'conflict_resolution' ? (
            <ConflictExampleCard
              key={example.id}
              example={example}
              onEdit={() => openEdit(example)}
              onDelete={() => handleDelete(example)}
            />
          ) : (
            <MappingExampleCard
              key={example.id}
              example={example}
              items={items}
              onEdit={() => openEdit(example)}
              onDelete={() => handleDelete(example)}
            />
          ),
        )}

        {examples.length === 0 ? (
          <Text
            style={{
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(14),
              textAlign: 'center',
              paddingVertical: ds.spacing(40),
            }}
          >
            No parser examples yet. Add one above.
          </Text>
        ) : null}
      </View>

      <ExampleEditorModal
        visible={editorVisible}
        editingExample={editingExample}
        items={items}
        onClose={closeEditor}
        onSaved={() => {
          void onRefresh();
        }}
      />
    </View>
  );
}

interface ExampleCardShellProps {
  raw_text: string;
  is_active: boolean;
  footerLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

function ExampleCardShell({
  raw_text,
  is_active,
  footerLabel,
  onEdit,
  onDelete,
  children,
}: ExampleCardShellProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: glassRadii.surface,
        borderWidth: 1,
        borderColor: glassColors.cardBorder,
        padding: ds.spacing(16),
      }}
    >
      <View
        style={{
          backgroundColor: grayScale[100],
          borderRadius: 12,
          paddingHorizontal: ds.spacing(12),
          paddingVertical: ds.spacing(12),
          marginBottom: ds.spacing(12),
        }}
      >
        <Text
          style={{
            color: glassColors.textPrimary,
            fontSize: ds.fontSize(14),
            fontFamily: 'Menlo',
            lineHeight: ds.fontSize(20),
          }}
        >
          {`"${raw_text}"`}
        </Text>
      </View>

      {children}

      <View
        style={{
          marginTop: ds.spacing(12),
          paddingTop: ds.spacing(12),
          borderTopWidth: 1,
          borderTopColor: glassColors.divider,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: ds.spacing(6),
            backgroundColor: is_active ? 'rgba(34, 197, 94, 0.12)' : grayScale[100],
            borderRadius: glassRadii.pill,
            paddingHorizontal: ds.spacing(10),
            paddingVertical: ds.spacing(5),
          }}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: is_active ? colors.statusGreen : glassColors.textSecondary,
            }}
          />
          <Text
            style={{
              color: is_active ? '#2E7D32' : glassColors.textSecondary,
              fontSize: ds.fontSize(12),
              fontWeight: '700',
            }}
          >
            {footerLabel}
          </Text>
        </View>

        <View style={{ flex: 1 }} />

        <TouchableOpacity onPress={onEdit} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="create-outline" size={ds.icon(20)} color={glassColors.textSecondary} />
        </TouchableOpacity>
        <View style={{ width: ds.spacing(14) }} />
        <TouchableOpacity onPress={onDelete} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="trash-outline" size={ds.icon(20)} color={glassColors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface MappingExampleCardProps {
  example: ParserExampleRow;
  items: QuickOrderConfigItem[];
  onEdit: () => void;
  onDelete: () => void;
}

function MappingExampleCard({ example, items, onEdit, onDelete }: MappingExampleCardProps) {
  const ds = useScaledStyles();
  const rows = getMappingRows(example);

  const itemsById = React.useMemo(() => {
    const map = new Map<string, QuickOrderConfigItem>();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  return (
    <ExampleCardShell
      raw_text={example.raw_text}
      is_active={example.is_active}
      footerLabel={`${example.is_active ? 'Active' : 'Inactive'} · ${example.source}`}
      onEdit={onEdit}
      onDelete={onDelete}
    >
      <View>
        {rows.map((row, index) => {
          const entry = row as Record<string, unknown>;
          const itemId = typeof entry.item_id === 'string' ? entry.item_id : null;
          const fallbackName = typeof entry.item_name === 'string' ? entry.item_name : 'Unknown';
          const displayName = (itemId && itemsById.get(itemId)?.name) || fallbackName;
          const quantity = Number(entry.quantity) || 0;
          const unit = typeof entry.unit === 'string' ? entry.unit : '';
          return (
            <View
              key={`${itemId ?? fallbackName}-${index}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: ds.spacing(10),
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: glassColors.divider,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                {displayName}
              </Text>
              <Text
                style={{
                  fontSize: ds.fontSize(14),
                  color: glassColors.textSecondary,
                  fontWeight: '500',
                }}
              >
                {formatExampleQuantity(quantity, unit)}
              </Text>
            </View>
          );
        })}
        {rows.length === 0 ? (
          <Text
            style={{
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(13),
              fontStyle: 'italic',
            }}
          >
            No mapped items.
          </Text>
        ) : null}
      </View>
    </ExampleCardShell>
  );
}

interface ConflictExampleCardProps {
  example: ParserExampleRow;
  onEdit: () => void;
  onDelete: () => void;
}

function ConflictExampleCard({ example, onEdit, onDelete }: ConflictExampleCardProps) {
  const ds = useScaledStyles();
  const payload = getConflictPayload(example);
  const resolution = getConflictResolution(example);
  const question = payload?.question ?? 'add vs replace';
  const displayRaw = payload
    ? `Existing: ${payload.existing_text} · Input: ${payload.input_text}`
    : example.raw_text;
  const footerSuffix = resolution ? ` · Resolved: ${resolution}` : '';

  return (
    <ExampleCardShell
      raw_text={displayRaw}
      is_active={example.is_active}
      footerLabel={`${example.is_active ? 'Active' : 'Inactive'}${footerSuffix}`}
      onEdit={onEdit}
      onDelete={onDelete}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: ds.spacing(4),
        }}
      >
        <Text
          style={{
            color: glassColors.textSecondary,
            fontSize: ds.fontSize(14),
            fontWeight: '600',
          }}
        >
          Pending conflict
        </Text>
        <View style={{ flex: 1 }} />
        <Text
          style={{
            color: colors.primary,
            fontSize: ds.fontSize(14),
            fontWeight: '700',
          }}
        >
          Asks: {question}
        </Text>
      </View>
    </ExampleCardShell>
  );
}
