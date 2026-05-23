import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { colors, glassColors, glassHairlineWidth, glassRadii } from '@/theme/design';
import type { QuickOrderConfigItem } from './types';

type EmployeeOption = { id: string; name: string; role?: string | null };
type DateStatus = 'idle' | 'valid' | 'needs_review' | 'invalid';
type HistoryCardStatus = 'draft' | 'previewing' | 'ready' | 'saving' | 'saved' | 'error';

export type HistoryImportPreviewRow = {
  id: string;
  originalLine: string;
  matchedItemId: string | null;
  matchedItemName: string | null;
  quantity: number | null;
  unit: string | null;
  supplierId: string | null;
  status: 'matched' | 'needs_review' | 'invalid' | 'ignored';
  confidence: number;
  reason: string | null;
};

type HistoryBlock = {
  id: string;
  placedAtText: string;
  placedAt: string | null;
  pasteText: string;
  rows: HistoryImportPreviewRow[];
  dateStatus: DateStatus;
  dateReason: string | null;
  status: HistoryCardStatus;
  savedMessage: string | null;
};

const SAMPLE_ORDER_TEXT = 'Salmon 3 cases\nTuna Loin 1 case\nSquid 1 pack\nTako 3 packs';

export function ImportOrderHistoryTab({ items }: { items: QuickOrderConfigItem[] }) {
  const ds = useScaledStyles();
  const user = useAuthStore((state) => state.user);
  const locations = useAuthStore((state) => state.locations);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(locations[0]?.id ?? null);
  const [blocks, setBlocks] = useState<HistoryBlock[]>(() => [newHistoryBlock()]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployees() {
      const { data, error } = await supabase
        .from('users')
        .select('id,name,role')
        .order('name', { ascending: true })
        .limit(200);
      if (cancelled || error) return;
      setEmployees((data ?? []).map((row: any) => ({
        id: String(row.id),
        name: String(row.name ?? 'Unnamed employee'),
        role: typeof row.role === 'string' ? row.role : null,
      })));
    }
    void loadEmployees();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );
  const employeeNameText = selectedEmployee?.name ?? employeeQuery.trim();
  const employeeReady = employeeNameText.length > 0;
  const filteredEmployees = useMemo(() => {
    const query = normalizeSearch(employeeQuery);
    if (!query) return employees.slice(0, 8);
    return employees
      .filter((employee) => normalizeSearch(employee.name).includes(query))
      .slice(0, 8);
  }, [employeeQuery, employees]);

  const updateBlock = useCallback((blockId: string, patch: Partial<HistoryBlock>) => {
    setBlocks((current) => current.map((block) => block.id === blockId ? { ...block, ...patch } : block));
  }, []);

  const updateRow = useCallback((blockId: string, rowId: string, patch: Partial<HistoryImportPreviewRow>) => {
    setBlocks((current) => current.map((block) => {
      if (block.id !== blockId) return block;
      return {
        ...block,
        status: block.status === 'saved' ? 'ready' : block.status,
        rows: block.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row),
      };
    }));
  }, []);

  const handlePreview = useCallback(async (blockId: string) => {
    const block = blocks.find((entry) => entry.id === blockId);
    if (!block || !user?.id || !locationId || !employeeReady || !block.pasteText.trim()) return;
    updateBlock(blockId, { status: 'previewing', savedMessage: null });
    setSuccessMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('parse-order', {
        body: {
          operation: 'history_import_preview',
          source: 'typed',
          message: block.pasteText,
          raw_text: block.pasteText,
          original_text: block.pasteText,
          placed_at_text: block.placedAtText,
          location_id: locationId,
          user_id: user.id,
        },
      });
      if (error) throw error;
      const response = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const rows = normalizePreviewRows(response.preview_rows);
      const dateStatus = normalizeDateStatus(response.date_status);
      updateBlock(blockId, {
        rows,
        placedAt: typeof response.placed_at === 'string' ? response.placed_at : null,
        dateStatus,
        dateReason: typeof response.date_reason === 'string' ? response.date_reason : null,
        status: dateStatus === 'valid' && rows.length > 0 ? 'ready' : 'error',
      });
    } catch (error) {
      console.warn('[QuickOrderConfig] history import preview failed:', error);
      updateBlock(blockId, { status: 'error' });
      Alert.alert('Preview failed', error instanceof Error ? error.message : 'Unable to preview this import.');
    }
  }, [blocks, employeeReady, locationId, updateBlock, user?.id]);

  const handleSave = useCallback(async (blockId: string) => {
    const block = blocks.find((entry) => entry.id === blockId);
    if (!block || !user?.id || !locationId || !canSaveBlock(block) || !employeeReady) return;
    updateBlock(blockId, { status: 'saving' });
    try {
      const { data, error } = await supabase.functions.invoke('parse-order', {
        body: {
          operation: 'history_import_commit',
          source: 'typed',
          message: block.pasteText,
          raw_text: block.pasteText,
          original_text: block.pasteText,
          location_id: locationId,
          user_id: user.id,
          employee_id: selectedEmployeeId,
          employee_name_text: employeeNameText,
          placed_at_text: block.placedAtText,
          preview_items: block.rows,
        },
      });
      if (error) throw error;
      const importedCount = Number((data as Record<string, unknown> | null)?.imported_count ?? 0);
      const message = `Saved ${importedCount} historical items for ${employeeNameText}. Smart suggestions have been refreshed.`;
      updateBlock(blockId, { status: 'saved', savedMessage: message });
      setSuccessMessage(message);
    } catch (error) {
      console.warn('[QuickOrderConfig] history import failed:', error);
      updateBlock(blockId, { status: 'ready' });
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unable to save this history.');
    }
  }, [blocks, employeeNameText, employeeReady, locationId, selectedEmployeeId, updateBlock, user?.id]);

  const addBlock = useCallback(() => {
    setBlocks((current) => [...current, newHistoryBlock()]);
  }, []);

  const removeBlock = useCallback((blockId: string) => {
    setBlocks((current) => current.length <= 1 ? current : current.filter((block) => block.id !== blockId));
  }, []);

  const refreshProfiles = useCallback(async () => {
    if (!locationId) return;
    const { data, error } = await supabase.rpc('refresh_item_order_profiles', {
      p_location_id: locationId,
      p_lookback_orders: 12,
    });
    if (error) {
      Alert.alert('Refresh failed', error.message);
      return;
    }
    Alert.alert('Profiles refreshed', `Updated ${Number(data ?? 0)} smart order profiles.`);
  }, [locationId]);

  return (
    <View style={{ gap: ds.spacing(14) }}>
      {successMessage ? <StatusBanner text={successMessage} /> : null}

      <Section title="Import details">
        <FieldLabel text="Employee" />
        <TextInput
          value={employeeQuery}
          onChangeText={(text) => {
            setEmployeeQuery(text);
            if (selectedEmployeeId && text !== selectedEmployee?.name) setSelectedEmployeeId(null);
          }}
          placeholder="Type or select employee"
          autoCapitalize="words"
          style={[inputStyle(ds), { marginBottom: ds.spacing(8) }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: ds.spacing(8), paddingBottom: ds.spacing(10) }}>
          {filteredEmployees.map((employee) => (
            <Pill
              key={employee.id}
              selected={selectedEmployeeId === employee.id}
              label={employee.name}
              onPress={() => {
                setSelectedEmployeeId(employee.id);
                setEmployeeQuery(employee.name);
              }}
            />
          ))}
        </ScrollView>
        {employeeQuery.trim() && !selectedEmployee ? (
          <Text style={{ color: colors.textSecondary, fontSize: ds.fontSize(12), fontWeight: '700', marginBottom: ds.spacing(10) }}>
            New employee name will be linked automatically when they sign up.
          </Text>
        ) : null}

        <FieldLabel text="Location" />
        <View style={{ gap: ds.spacing(8) }}>
          {locations.map((location) => (
            <Pill key={location.id} selected={locationId === location.id} label={location.name} onPress={() => setLocationId(location.id)} />
          ))}
        </View>
      </Section>

      <Section title="Past order history">
        <View style={{ gap: ds.spacing(12) }}>
          {blocks.map((block, index) => (
            <HistoryBlockCard
              key={block.id}
              index={index}
              block={block}
              canRemove={blocks.length > 1}
              employeeReady={employeeReady}
              onChange={updateBlock}
              onPreview={handlePreview}
              onSave={handleSave}
              onRemove={removeBlock}
              onRowChange={updateRow}
              items={items}
            />
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add another history"
          onPress={addBlock}
          style={({ pressed }) => ({
            marginTop: ds.spacing(14),
            alignSelf: 'center',
            width: ds.spacing(48),
            height: ds.spacing(48),
            borderRadius: ds.radius(999),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
            opacity: pressed ? 0.76 : 1,
          })}
        >
          <Ionicons name="add" size={ds.icon(28)} color={colors.textOnPrimary} />
        </Pressable>

        <SecondaryButton label="Refresh smart order profiles" onPress={refreshProfiles} />
      </Section>
    </View>
  );
}

function HistoryBlockCard({
  index,
  block,
  canRemove,
  employeeReady,
  onChange,
  onPreview,
  onSave,
  onRemove,
  onRowChange,
  items,
}: {
  index: number;
  block: HistoryBlock;
  canRemove: boolean;
  employeeReady: boolean;
  onChange: (id: string, patch: Partial<HistoryBlock>) => void;
  onPreview: (id: string) => void;
  onSave: (id: string) => void;
  onRemove: (id: string) => void;
  onRowChange: (blockId: string, rowId: string, patch: Partial<HistoryImportPreviewRow>) => void;
  items: QuickOrderConfigItem[];
}) {
  const ds = useScaledStyles();
  const canPreview = employeeReady && block.pasteText.trim().length > 0 && block.placedAtText.trim().length > 0 && block.status !== 'previewing';
  const saveEnabled = employeeReady && canSaveBlock(block);
  return (
    <View style={{
      borderWidth: 1,
      borderColor: glassColors.cardBorder,
      borderRadius: ds.radius(14),
      padding: ds.spacing(12),
      backgroundColor: colors.white,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: ds.spacing(10) }}>
        <Text style={{ flex: 1, color: colors.textPrimary, fontSize: ds.fontSize(15), fontWeight: '900' }}>
          History {index + 1}
        </Text>
        {canRemove ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove history ${index + 1}`} onPress={() => onRemove(block.id)}>
            <Ionicons name="close" size={ds.icon(22)} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <FieldLabel text="Date or time" />
      <TextInput
        value={block.placedAtText}
        onChangeText={(text) => onChange(block.id, { placedAtText: text, dateStatus: 'idle', placedAt: null, status: 'draft', savedMessage: null })}
        placeholder="5/22, May 22, Friday morning"
        style={[inputStyle(ds), { marginBottom: ds.spacing(10) }]}
      />
      {block.dateStatus !== 'idle' ? <DateStatusText block={block} /> : null}

      <FieldLabel text="Paste order history" />
      <TextInput
        value={block.pasteText}
        onChangeText={(text) => onChange(block.id, { pasteText: text, rows: [], status: 'draft', savedMessage: null })}
        multiline
        placeholder={SAMPLE_ORDER_TEXT}
        textAlignVertical="top"
        style={[inputStyle(ds), { minHeight: ds.spacing(128) }]}
      />

      <PrimaryButton
        label={block.status === 'previewing' ? 'Previewing...' : 'Preview'}
        disabled={!canPreview}
        onPress={() => onPreview(block.id)}
      />

      {block.rows.length > 0 || block.dateStatus === 'invalid' ? (
        <View style={{ marginTop: ds.spacing(12), gap: ds.spacing(8) }}>
          {block.rows.map((row) => (
            <PreviewRow
              key={row.id}
              row={row}
              items={items}
              onChange={(rowId, patch) => onRowChange(block.id, rowId, patch)}
            />
          ))}
        </View>
      ) : null}

      {block.savedMessage ? (
        <Text style={{ color: colors.statusGreen, fontSize: ds.fontSize(12), fontWeight: '800', marginTop: ds.spacing(10) }}>
          {block.savedMessage}
        </Text>
      ) : null}

      {block.rows.length > 0 ? (
        <PrimaryButton
          label={block.status === 'saving' ? 'Saving...' : 'Save'}
          disabled={!saveEnabled || block.status === 'saving'}
          onPress={() => onSave(block.id)}
        />
      ) : null}
    </View>
  );
}

function DateStatusText({ block }: { block: HistoryBlock }) {
  const ds = useScaledStyles();
  const valid = block.dateStatus === 'valid';
  return (
    <Text style={{ color: valid ? colors.statusGreen : colors.statusRed, fontSize: ds.fontSize(12), fontWeight: '800', marginBottom: ds.spacing(10) }}>
      {valid && block.placedAt
        ? `Date recognized as ${new Date(block.placedAt).toLocaleDateString()}.`
        : block.dateReason ?? 'Date needs review.'}
    </Text>
  );
}

function normalizePreviewRows(value: unknown): HistoryImportPreviewRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): HistoryImportPreviewRow | null => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      return {
        id: String(row.id ?? Math.random()),
        originalLine: String(row.originalLine ?? row.original_line ?? ''),
        matchedItemId: typeof row.matchedItemId === 'string' ? row.matchedItemId : typeof row.matched_item_id === 'string' ? row.matched_item_id : null,
        matchedItemName: typeof row.matchedItemName === 'string' ? row.matchedItemName : typeof row.matched_item_name === 'string' ? row.matched_item_name : null,
        quantity: typeof row.quantity === 'number' ? row.quantity : Number(row.quantity) || null,
        unit: typeof row.unit === 'string' ? row.unit : null,
        supplierId: typeof row.supplierId === 'string' ? row.supplierId : typeof row.supplier_id === 'string' ? row.supplier_id : null,
        status: row.status === 'matched' || row.status === 'needs_review' || row.status === 'invalid' || row.status === 'ignored' ? row.status : 'invalid',
        confidence: typeof row.confidence === 'number' ? row.confidence : 0,
        reason: typeof row.reason === 'string' ? row.reason : null,
      };
    })
    .filter((row): row is HistoryImportPreviewRow => Boolean(row));
}

function normalizeDateStatus(value: unknown): DateStatus {
  return value === 'valid' || value === 'needs_review' || value === 'invalid' ? value : 'invalid';
}

function canSaveBlock(block: HistoryBlock): boolean {
  return block.dateStatus === 'valid' &&
    Boolean(block.placedAt) &&
    block.rows.length > 0 &&
    block.rows.every((row) => row.status === 'matched' || row.status === 'ignored');
}

function newHistoryBlock(): HistoryBlock {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    placedAtText: '',
    placedAt: null,
    pasteText: '',
    rows: [],
    dateStatus: 'idle',
    dateReason: null,
    status: 'draft',
    savedMessage: null,
  };
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const ds = useScaledStyles();
  return (
    <View style={{
      backgroundColor: colors.white,
      borderWidth: glassHairlineWidth,
      borderColor: glassColors.cardBorder,
      borderRadius: glassRadii.surface,
      padding: ds.spacing(14),
    }}>
      <Text style={{ color: colors.textPrimary, fontSize: ds.fontSize(17), fontWeight: '800', marginBottom: ds.spacing(10) }}>{title}</Text>
      {children}
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  const ds = useScaledStyles();
  return <Text style={{ color: colors.textSecondary, fontSize: ds.fontSize(12), fontWeight: '800', marginBottom: ds.spacing(6) }}>{text}</Text>;
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const ds = useScaledStyles();
  return (
    <Pressable onPress={onPress} style={{
      minHeight: ds.spacing(36),
      justifyContent: 'center',
      borderRadius: 999,
      paddingHorizontal: ds.spacing(12),
      backgroundColor: selected ? colors.primary : colors.white,
      borderWidth: 1,
      borderColor: selected ? colors.primary : glassColors.cardBorder,
    }}>
      <Text style={{ color: selected ? colors.textOnPrimary : colors.textPrimary, fontSize: ds.fontSize(13), fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

function PreviewRow({ row, items, onChange }: { row: HistoryImportPreviewRow; items: QuickOrderConfigItem[]; onChange: (id: string, patch: Partial<HistoryImportPreviewRow>) => void }) {
  const ds = useScaledStyles();
  const statusColor = row.status === 'matched' ? colors.statusGreen : row.status === 'needs_review' ? colors.statusAmber : row.status === 'ignored' ? colors.textMuted : colors.statusRed;
  return (
    <View style={{
      borderWidth: 1,
      borderColor: glassColors.cardBorder,
      borderRadius: ds.radius(10),
      padding: ds.spacing(10),
      gap: ds.spacing(8),
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: ds.spacing(8) }}>
        <Text style={{ flex: 1, color: colors.textPrimary, fontSize: ds.fontSize(14), fontWeight: '800' }}>{row.originalLine}</Text>
        <Text style={{ color: statusColor, fontSize: ds.fontSize(12), fontWeight: '900' }}>{row.status.replace('_', ' ')}</Text>
      </View>
      <TextInput
        value={row.matchedItemName ?? ''}
        onChangeText={(text) => {
          const match = items.find((item) => item.name.toLowerCase() === text.trim().toLowerCase());
          onChange(row.id, {
            matchedItemName: text,
            matchedItemId: match?.id ?? row.matchedItemId,
            supplierId: match?.supplier_id ?? row.supplierId,
            status: match && row.quantity && row.unit ? 'matched' : 'needs_review',
          });
        }}
        placeholder="Matched item"
        style={inputStyle(ds)}
      />
      <View style={{ flexDirection: 'row', gap: ds.spacing(8) }}>
        <TextInput
          value={row.quantity == null ? '' : String(row.quantity)}
          onChangeText={(text) => onChange(row.id, { quantity: Number(text) || null, status: row.matchedItemId && Number(text) > 0 && row.unit ? 'matched' : 'needs_review' })}
          keyboardType="decimal-pad"
          placeholder="Qty"
          style={[inputStyle(ds), { flex: 1 }]}
        />
        <TextInput
          value={row.unit ?? ''}
          onChangeText={(text) => onChange(row.id, { unit: text, status: row.matchedItemId && row.quantity && text.trim() ? 'matched' : 'needs_review' })}
          placeholder="Unit"
          style={[inputStyle(ds), { flex: 1 }]}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: ds.spacing(8) }}>
        <SecondaryButton label="Ignore row" onPress={() => onChange(row.id, { status: 'ignored' })} />
        {row.status === 'ignored' ? <SecondaryButton label="Review row" onPress={() => onChange(row.id, { status: row.matchedItemId && row.quantity && row.unit ? 'matched' : 'needs_review' })} /> : null}
      </View>
    </View>
  );
}

function StatusBanner({ text }: { text: string }) {
  const ds = useScaledStyles();
  return (
    <View style={{ backgroundColor: colors.statusGreenBg, borderRadius: ds.radius(12), padding: ds.spacing(10) }}>
      <Text style={{ color: colors.statusGreen, fontSize: ds.fontSize(13), fontWeight: '800' }}>{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const ds = useScaledStyles();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={{ marginTop: ds.spacing(12), alignItems: 'center', borderRadius: ds.radius(12), paddingVertical: ds.spacing(11), backgroundColor: disabled ? colors.textMuted : colors.primary }}>
      {label.endsWith('...') ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={{ color: colors.textOnPrimary, fontSize: ds.fontSize(14), fontWeight: '900' }}>{label}</Text>}
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const ds = useScaledStyles();
  return (
    <Pressable onPress={onPress} style={{ marginTop: ds.spacing(8), alignItems: 'center', borderRadius: ds.radius(12), paddingVertical: ds.spacing(9), paddingHorizontal: ds.spacing(10), backgroundColor: colors.primaryPale, borderWidth: 1, borderColor: colors.primaryLight }}>
      <Text style={{ color: colors.primary, fontSize: ds.fontSize(13), fontWeight: '800' }}>{label}</Text>
    </Pressable>
  );
}

function inputStyle(ds: ReturnType<typeof useScaledStyles>) {
  return {
    borderWidth: 1,
    borderColor: glassColors.cardBorder,
    borderRadius: ds.radius(10),
    paddingHorizontal: ds.spacing(10),
    paddingVertical: ds.spacing(9),
    color: colors.textPrimary,
    backgroundColor: colors.white,
  };
}
