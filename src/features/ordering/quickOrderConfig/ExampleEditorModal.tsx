import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassRadii,
  glassSpacing,
  grayScale,
} from '@/theme/design';
import type { ParserExampleRow, UnitType } from '@/types';
import {
  type ExampleBuilderItem,
  type QuickOrderConfigItem,
  encodeConflictStructuredOutput,
  getConflictPayload,
  getConflictResolution,
  getExampleType,
  getMappingRows,
  newBuilderItem,
  parseStructuredOutput,
} from './types';

type EditorType = 'mapping' | 'conflict_resolution';

interface ExampleEditorModalProps {
  visible: boolean;
  editingExample: ParserExampleRow | null;
  items: QuickOrderConfigItem[];
  onClose: () => void;
  onSaved: () => void;
}

export function ExampleEditorModal({
  visible,
  editingExample,
  items,
  onClose,
  onSaved,
}: ExampleEditorModalProps) {
  const ds = useScaledStyles();
  const isEditing = Boolean(editingExample);
  const initialType: EditorType = editingExample ? getExampleType(editingExample) : 'mapping';

  const [type, setType] = useState<EditorType>(initialType);
  const [rawText, setRawText] = useState('');
  const [builderItems, setBuilderItems] = useState<ExampleBuilderItem[]>([newBuilderItem()]);
  const [existingText, setExistingText] = useState('');
  const [inputText, setInputText] = useState('');
  const [questionText, setQuestionText] = useState('add vs replace');
  const [resolution, setResolution] = useState<'add' | 'replace' | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editingExample) {
      const derivedType = getExampleType(editingExample);
      setType(derivedType);
      setIsActive(editingExample.is_active);
      if (derivedType === 'mapping') {
        setRawText(editingExample.raw_text ?? '');
        setBuilderItems(parseStructuredOutput(getMappingRows(editingExample)));
        setExistingText('');
        setInputText('');
        setQuestionText('add vs replace');
        setResolution(null);
      } else {
        const payload = getConflictPayload(editingExample);
        setExistingText(payload?.existing_text ?? '');
        setInputText(payload?.input_text ?? '');
        setQuestionText(payload?.question ?? 'add vs replace');
        setResolution(getConflictResolution(editingExample));
        setRawText('');
        setBuilderItems([newBuilderItem()]);
      }
    } else {
      setType('mapping');
      setRawText('');
      setBuilderItems([newBuilderItem()]);
      setExistingText('');
      setInputText('');
      setQuestionText('add vs replace');
      setResolution(null);
      setIsActive(true);
    }
  }, [editingExample, visible]);

  const updateBuilderItem = useCallback(
    (localId: string, updates: Partial<ExampleBuilderItem>) => {
      setBuilderItems((current) =>
        current.map((item) => (item.localId === localId ? { ...item, ...updates } : item)),
      );
    },
    [],
  );

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      if (type === 'mapping') {
        const normalizedRawText = rawText.trim();
        if (!normalizedRawText) {
          Alert.alert('Raw text required', 'Enter the text the employee might type.');
          return;
        }
        const completeRows = builderItems.filter(
          (item) => item.item_id && item.item_name && Number(item.quantity) > 0,
        );
        if (completeRows.length === 0) {
          Alert.alert('Expected output required', 'Add at least one mapped item with quantity.');
          return;
        }
        const structuredOutput = completeRows.map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          quantity: Number(item.quantity),
          unit: item.unit.trim(),
          unit_type: item.unit_type,
          confidence: 1,
        }));

        if (isEditing && editingExample) {
          const { error } = await supabase
            .from('parser_examples')
            .update({
              raw_text: normalizedRawText,
              structured_output: structuredOutput,
              is_active: isActive,
            })
            .eq('id', editingExample.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('parser_examples').insert({
            raw_text: normalizedRawText,
            structured_output: structuredOutput,
            source: 'manager',
            is_active: isActive,
          });
          if (error) throw error;
        }
      } else {
        const existing = existingText.trim();
        const input = inputText.trim();
        const question = questionText.trim();
        if (!existing || !input || !question) {
          Alert.alert('All fields required', 'Fill in existing, input, and question.');
          return;
        }
        const derivedRaw = `Existing: ${existing} · Input: ${input}`;
        const conflictOutput = encodeConflictStructuredOutput(
          { existing_text: existing, input_text: input, question },
          resolution,
        );

        if (isEditing && editingExample) {
          const { error } = await supabase
            .from('parser_examples')
            .update({
              raw_text: derivedRaw,
              structured_output: conflictOutput,
              is_active: isActive,
            })
            .eq('id', editingExample.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('parser_examples').insert({
            raw_text: derivedRaw,
            structured_output: conflictOutput,
            source: 'manager',
            is_active: isActive,
          });
          if (error) throw error;
        }
      }

      onSaved();
      onClose();
    } catch (error: any) {
      Alert.alert('Save failed', error?.message ?? 'Unable to save example.');
    } finally {
      setSaving(false);
    }
  }, [
    builderItems,
    editingExample,
    existingText,
    inputText,
    isActive,
    isEditing,
    onClose,
    onSaved,
    questionText,
    rawText,
    resolution,
    type,
  ]);

  const typeIsLocked = isEditing;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(18),
            paddingBottom: ds.spacing(16),
            borderBottomWidth: 1,
            borderBottomColor: glassColors.divider,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text
              style={{
                color: glassColors.textPrimary,
                fontSize: ds.fontSize(17),
                fontWeight: '500',
              }}
            >
              Cancel
            </Text>
          </TouchableOpacity>
          <Text
            style={{
              fontSize: ds.fontSize(17),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            {isEditing ? 'Edit example' : 'New example'}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text
              style={{
                color: colors.primary,
                fontSize: ds.fontSize(17),
                fontWeight: '700',
                opacity: saving ? 0.5 : 1,
              }}
            >
              {isEditing ? 'Save' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: glassSpacing.screen,
              paddingTop: ds.spacing(20),
              paddingBottom: ds.spacing(48),
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                gap: ds.spacing(8),
                backgroundColor: grayScale[100],
                borderRadius: glassRadii.pill,
                padding: 4,
                marginBottom: ds.spacing(24),
              }}
            >
              {(['mapping', 'conflict_resolution'] as EditorType[]).map((option) => {
                const active = type === option;
                const label = option === 'mapping' ? 'Mapping' : 'Conflict';
                return (
                  <Pressable
                    key={option}
                    onPress={() => !typeIsLocked && setType(option)}
                    style={{
                      flex: 1,
                      minHeight: 36,
                      borderRadius: glassRadii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? colors.white : 'transparent',
                      opacity: typeIsLocked && !active ? 0.4 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? colors.primary : glassColors.textSecondary,
                        fontWeight: '700',
                        fontSize: ds.fontSize(13),
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {type === 'mapping' ? (
              <MappingForm
                rawText={rawText}
                setRawText={setRawText}
                builderItems={builderItems}
                setBuilderItems={setBuilderItems}
                updateBuilderItem={updateBuilderItem}
                items={items}
              />
            ) : (
              <ConflictForm
                existingText={existingText}
                setExistingText={setExistingText}
                inputText={inputText}
                setInputText={setInputText}
                questionText={questionText}
                setQuestionText={setQuestionText}
                resolution={resolution}
                setResolution={setResolution}
              />
            )}

            <Pressable
              onPress={() => setIsActive((value) => !value)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: ds.spacing(24),
                gap: ds.spacing(10),
              }}
            >
              <Ionicons
                name={isActive ? 'checkbox' : 'square-outline'}
                size={ds.icon(22)}
                color={isActive ? colors.primary : glassColors.textSecondary}
              />
              <Text
                style={{
                  color: glassColors.textPrimary,
                  fontWeight: '600',
                  fontSize: ds.fontSize(15),
                }}
              >
                Active example
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

interface MappingFormProps {
  rawText: string;
  setRawText: (value: string) => void;
  builderItems: ExampleBuilderItem[];
  setBuilderItems: React.Dispatch<React.SetStateAction<ExampleBuilderItem[]>>;
  updateBuilderItem: (localId: string, updates: Partial<ExampleBuilderItem>) => void;
  items: QuickOrderConfigItem[];
}

function MappingForm({
  rawText,
  setRawText,
  builderItems,
  setBuilderItems,
  updateBuilderItem,
  items,
}: MappingFormProps) {
  const ds = useScaledStyles();

  return (
    <View>
      <Text
        style={{
          fontSize: ds.fontSize(13),
          fontWeight: '700',
          color: glassColors.textSecondary,
          marginBottom: ds.spacing(6),
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Raw text
      </Text>
      <TextInput
        value={rawText}
        onChangeText={setRawText}
        placeholder='e.g. "salmon 2cs, 1 lb tuna"'
        placeholderTextColor={glassColors.textMuted}
        multiline
        style={{
          minHeight: 64,
          backgroundColor: colors.white,
          borderRadius: glassRadii.surface,
          borderWidth: 1,
          borderColor: glassColors.cardBorder,
          paddingHorizontal: ds.spacing(14),
          paddingTop: ds.spacing(12),
          paddingBottom: ds.spacing(12),
          color: glassColors.textPrimary,
          fontSize: ds.fontSize(15),
          textAlignVertical: 'top',
        }}
      />

      <Text
        style={{
          fontSize: ds.fontSize(13),
          fontWeight: '700',
          color: glassColors.textSecondary,
          marginTop: ds.spacing(18),
          marginBottom: ds.spacing(6),
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Expected output
      </Text>

      {builderItems.map((builderItem, index) => (
        <OutputItemRow
          key={builderItem.localId}
          index={index}
          builderItem={builderItem}
          items={items}
          canRemove={builderItems.length > 1}
          onRemove={() =>
            setBuilderItems((current) =>
              current.filter((item) => item.localId !== builderItem.localId),
            )
          }
          onUpdate={(updates) => updateBuilderItem(builderItem.localId, updates)}
        />
      ))}

      <TouchableOpacity
        onPress={() => setBuilderItems((current) => [...current, newBuilderItem()])}
        activeOpacity={0.85}
        style={{
          marginTop: ds.spacing(12),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: ds.spacing(4),
          minHeight: 44,
          borderRadius: glassRadii.pill,
          backgroundColor: colors.white,
          borderWidth: 1,
          borderColor: glassColors.cardBorder,
        }}
      >
        <Ionicons name="add" size={ds.icon(18)} color={colors.primary} />
        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: ds.fontSize(14) }}>
          Add output item
        </Text>
      </TouchableOpacity>
    </View>
  );
}

interface OutputItemRowProps {
  index: number;
  builderItem: ExampleBuilderItem;
  items: QuickOrderConfigItem[];
  canRemove: boolean;
  onRemove: () => void;
  onUpdate: (updates: Partial<ExampleBuilderItem>) => void;
}

function OutputItemRow({
  index,
  builderItem,
  items,
  canRemove,
  onRemove,
  onUpdate,
}: OutputItemRowProps) {
  const ds = useScaledStyles();

  const builderSearch = builderItem.itemSearch.trim().toLowerCase();
  const builderMatches = useMemo(() => {
    if (!builderSearch) return [];
    return items
      .filter((item) => {
        const aliases = item.aliases.join(' ').toLowerCase();
        return item.name.toLowerCase().includes(builderSearch) || aliases.includes(builderSearch);
      })
      .slice(0, 6);
  }, [builderSearch, items]);

  const showMatches = builderMatches.length > 0 && builderItem.item_name !== builderItem.itemSearch;

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: glassRadii.surface,
        borderWidth: 1,
        borderColor: glassColors.cardBorder,
        padding: ds.spacing(12),
        marginTop: ds.spacing(10),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: ds.spacing(8) }}>
        <Text
          style={{
            flex: 1,
            fontSize: ds.fontSize(13),
            fontWeight: '700',
            color: glassColors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Item {index + 1}
        </Text>
        {canRemove ? (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="trash-outline" size={ds.icon(18)} color={colors.statusRed} />
          </TouchableOpacity>
        ) : null}
      </View>

      <TextInput
        value={builderItem.itemSearch}
        onChangeText={(value) =>
          onUpdate({
            itemSearch: value,
            item_id: value === builderItem.item_name ? builderItem.item_id : null,
          })
        }
        placeholder="Search inventory item"
        placeholderTextColor={glassColors.textMuted}
        autoCapitalize="none"
        style={{
          minHeight: 44,
          backgroundColor: grayScale[50],
          borderRadius: glassRadii.search,
          borderWidth: 1,
          borderColor: glassColors.cardBorder,
          paddingHorizontal: ds.spacing(12),
          color: glassColors.textPrimary,
          fontSize: ds.fontSize(15),
        }}
      />

      {showMatches ? (
        <View style={{ marginTop: ds.spacing(8), gap: ds.spacing(4) }}>
          {builderMatches.map((item) => (
            <Pressable
              key={item.id}
              onPress={() =>
                onUpdate({
                  item_id: item.id,
                  item_name: item.name,
                  itemSearch: item.name,
                  unit: item.base_unit || item.pack_unit || builderItem.unit,
                  unit_type: item.base_unit ? 'base' : 'pack',
                })
              }
              style={({ pressed }) => ({
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(9),
                borderRadius: 8,
                backgroundColor: pressed ? colors.primaryPale : grayScale[50],
              })}
            >
              <Text
                style={{
                  color: glassColors.textPrimary,
                  fontSize: ds.fontSize(14),
                  fontWeight: '600',
                }}
              >
                {item.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(10) }}>
        <TextInput
          value={builderItem.quantity}
          onChangeText={(value) => onUpdate({ quantity: value.replace(/[^0-9.]/g, '') })}
          keyboardType="decimal-pad"
          placeholder="Qty"
          placeholderTextColor={glassColors.textMuted}
          style={{
            flex: 0.5,
            minHeight: 44,
            backgroundColor: grayScale[50],
            borderRadius: glassRadii.search,
            borderWidth: 1,
            borderColor: glassColors.cardBorder,
            paddingHorizontal: ds.spacing(12),
            color: glassColors.textPrimary,
            fontSize: ds.fontSize(15),
          }}
        />
        <TextInput
          value={builderItem.unit}
          onChangeText={(value) => onUpdate({ unit: value })}
          placeholder="Unit"
          placeholderTextColor={glassColors.textMuted}
          style={{
            flex: 1,
            minHeight: 44,
            backgroundColor: grayScale[50],
            borderRadius: glassRadii.search,
            borderWidth: 1,
            borderColor: glassColors.cardBorder,
            paddingHorizontal: ds.spacing(12),
            color: glassColors.textPrimary,
            fontSize: ds.fontSize(15),
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(10) }}>
        {(['base', 'pack'] as UnitType[]).map((unitType) => {
          const active = builderItem.unit_type === unitType;
          return (
            <Pressable
              key={unitType}
              onPress={() => onUpdate({ unit_type: unitType })}
              style={{
                flex: 1,
                minHeight: 38,
                borderRadius: glassRadii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : grayScale[100],
              }}
            >
              <Text
                style={{
                  color: active ? colors.textOnPrimary : glassColors.textPrimary,
                  fontWeight: '700',
                  fontSize: ds.fontSize(13),
                }}
              >
                {unitType === 'base' ? 'Base unit' : 'Pack unit'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface ConflictFormProps {
  existingText: string;
  setExistingText: (value: string) => void;
  inputText: string;
  setInputText: (value: string) => void;
  questionText: string;
  setQuestionText: (value: string) => void;
  resolution: 'add' | 'replace' | null;
  setResolution: (value: 'add' | 'replace' | null) => void;
}

function ConflictForm({
  existingText,
  setExistingText,
  inputText,
  setInputText,
  questionText,
  setQuestionText,
  resolution,
  setResolution,
}: ConflictFormProps) {
  const ds = useScaledStyles();

  const renderInput = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <View style={{ marginBottom: ds.spacing(14) }}>
      <Text
        style={{
          fontSize: ds.fontSize(13),
          fontWeight: '700',
          color: glassColors.textSecondary,
          marginBottom: ds.spacing(6),
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={glassColors.textMuted}
        autoCapitalize="none"
        style={{
          minHeight: 48,
          backgroundColor: colors.white,
          borderRadius: glassRadii.surface,
          borderWidth: 1,
          borderColor: glassColors.cardBorder,
          paddingHorizontal: ds.spacing(14),
          color: glassColors.textPrimary,
          fontSize: ds.fontSize(15),
        }}
      />
    </View>
  );

  return (
    <View>
      {renderInput('Existing', existingText, setExistingText, 'e.g. Salmon 4 cs')}
      {renderInput('Input', inputText, setInputText, 'e.g. salmon 2cs')}
      {renderInput('Question', questionText, setQuestionText, 'e.g. add vs replace')}

      <Text
        style={{
          fontSize: ds.fontSize(13),
          fontWeight: '700',
          color: glassColors.textSecondary,
          marginBottom: ds.spacing(8),
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        Resolution
      </Text>
      <View style={{ flexDirection: 'row', gap: ds.spacing(10) }}>
        {(['add', 'replace'] as const).map((option) => {
          const active = resolution === option;
          return (
            <Pressable
              key={option}
              onPress={() => setResolution(active ? null : option)}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: glassRadii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.primary : colors.white,
                borderWidth: 1,
                borderColor: active ? colors.primary : glassColors.cardBorder,
              }}
            >
              <Text
                style={{
                  color: active ? colors.textOnPrimary : glassColors.textPrimary,
                  fontWeight: '700',
                  fontSize: ds.fontSize(14),
                  textTransform: 'capitalize',
                }}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
