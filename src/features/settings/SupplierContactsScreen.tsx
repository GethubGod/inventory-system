import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { GlassSurface, LoadingIndicator, StackScreenHeader } from '@/components';
import { MultiOptionToggle, SettingsSectionLabel } from '@/components/settings';
import { useSettingsNavigationContext } from '@/hooks/useSettingsBackRoute';
import {
  listSupplierContacts,
  updateSupplierContact,
  type SupplierContact,
  type SupplierContactChannel,
} from '@/services/supplierContacts';
import {
  NotificationFeedbackType,
  triggerNotificationHaptic,
  triggerSelectionHaptic,
} from '@/lib/haptics';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';

const CHANNEL_OPTIONS: { value: SupplierContactChannel; label: string }[] = [
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'share_sheet', label: 'Share sheet' },
];

const CHANNEL_SUMMARY_LABELS: Record<SupplierContactChannel, string> = {
  sms: 'Messages (SMS)',
  whatsapp: 'WhatsApp',
  share_sheet: 'Share sheet',
};

interface ContactDraft {
  contactPhone: string;
  contactChannel: SupplierContactChannel;
  contactName: string;
  contactNotes: string;
}

function draftFromContact(contact: SupplierContact): ContactDraft {
  return {
    contactPhone: contact.contactPhone ?? '',
    contactChannel: contact.contactChannel,
    contactName: contact.contactName ?? '',
    contactNotes: contact.contactNotes ?? '',
  };
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function SupplierContactsScreen() {
  const ds = useScaledStyles();
  const { backTo } = useSettingsNavigationContext('manager');

  const [contacts, setContacts] = useState<SupplierContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await listSupplierContacts();
      setContacts(rows);
    } catch (error: any) {
      setLoadError(error?.message || 'Unable to load suppliers.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  const navigateBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(backTo);
  }, [backTo]);

  const expandedContact = useMemo(
    () => contacts.find((contact) => contact.supplierId === expandedId) ?? null,
    [contacts, expandedId]
  );

  const handleToggleExpand = useCallback(
    (contact: SupplierContact) => {
      void triggerSelectionHaptic();
      if (expandedId === contact.supplierId) {
        setExpandedId(null);
        setDraft(null);
        return;
      }
      setExpandedId(contact.supplierId);
      setDraft(draftFromContact(contact));
    },
    [expandedId]
  );

  const handleSave = useCallback(async () => {
    if (!expandedContact || !draft || savingId) return;

    const phone = toNullable(draft.contactPhone);
    if (draft.contactChannel !== 'share_sheet' && !phone) {
      Alert.alert(
        'Phone Number Required',
        `Add a phone number to send ${expandedContact.supplierName} orders via ${CHANNEL_SUMMARY_LABELS[draft.contactChannel]}.`
      );
      return;
    }

    setSavingId(expandedContact.supplierId);
    try {
      const updated = await updateSupplierContact(expandedContact.supplierId, {
        contactPhone: phone,
        contactChannel: draft.contactChannel,
        contactName: toNullable(draft.contactName),
        contactNotes: toNullable(draft.contactNotes),
      });
      setContacts((prev) =>
        prev.map((contact) =>
          contact.supplierId === updated.supplierId ? updated : contact
        )
      );
      void triggerNotificationHaptic(NotificationFeedbackType.Success);
      setExpandedId(null);
      setDraft(null);
    } catch (error: any) {
      Alert.alert('Unable to Save', error?.message || 'Please try again.');
    } finally {
      setSavingId(null);
    }
  }, [draft, expandedContact, savingId]);

  const renderField = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    options?: {
      placeholder?: string;
      keyboardType?: 'phone-pad' | 'default';
      multiline?: boolean;
    }
  ) => (
    <View style={{ marginTop: ds.spacing(12) }}>
      <Text
        style={{
          fontSize: ds.fontSize(11),
          fontWeight: '700',
          color: glassColors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={options?.placeholder}
        placeholderTextColor={glassColors.textMuted}
        keyboardType={options?.keyboardType ?? 'default'}
        autoCapitalize={options?.keyboardType === 'phone-pad' ? 'none' : 'sentences'}
        autoCorrect={false}
        multiline={options?.multiline ?? false}
        textAlignVertical={options?.multiline ? 'top' : 'center'}
        style={{
          marginTop: ds.spacing(6),
          minHeight: options?.multiline ? 72 : Math.max(44, ds.buttonH - 6),
          borderRadius: glassRadii.button,
          borderWidth: glassHairlineWidth,
          borderColor: glassColors.controlBorder,
          backgroundColor: glassColors.mediumFill,
          paddingHorizontal: ds.spacing(12),
          paddingVertical: options?.multiline ? ds.spacing(10) : ds.spacing(8),
          fontSize: ds.fontSize(14),
          color: glassColors.textPrimary,
        }}
      />
    </View>
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ManagerScaleContainer>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={{ backgroundColor: glassColors.background }}>
            <StackScreenHeader
              title="Supplier Contacts"
              subtitle="Phone numbers and send channels used by Rapid Send All."
              onBackPress={navigateBack}
            />
          </View>

          {isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <LoadingIndicator size="small" color={glassColors.accent} />
            </View>
          ) : loadError ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: glassSpacing.screen,
              }}
            >
              <Ionicons name="cloud-offline-outline" size={ds.icon(28)} color={glassColors.accent} />
              <Text
                style={{
                  marginTop: ds.spacing(10),
                  fontSize: ds.fontSize(14),
                  color: glassColors.textSecondary,
                  textAlign: 'center',
                }}
              >
                {loadError}
              </Text>
              <TouchableOpacity
                onPress={() => void loadContacts()}
                activeOpacity={0.82}
                style={{
                  marginTop: ds.spacing(16),
                  minHeight: 44,
                  paddingHorizontal: ds.spacing(24),
                  borderRadius: glassRadii.button,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.accent,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    fontWeight: '700',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: ds.spacing(32) }}
              keyboardShouldPersistTaps="handled"
            >
              <SettingsSectionLabel label="Suppliers" />

              <GlassSurface
                intensity="subtle"
                blurred={false}
                style={{
                  marginHorizontal: glassSpacing.screen,
                  borderRadius: glassRadii.surface,
                  overflow: 'hidden',
                }}
              >
                {contacts.length === 0 ? (
                  <View style={{ padding: ds.spacing(20), alignItems: 'center' }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        color: glassColors.textSecondary,
                        textAlign: 'center',
                      }}
                    >
                      No active suppliers found.
                    </Text>
                  </View>
                ) : (
                  contacts.map((contact, index) => {
                    const isExpanded = expandedId === contact.supplierId;
                    const isSaving = savingId === contact.supplierId;
                    const summary = contact.contactPhone
                      ? `${CHANNEL_SUMMARY_LABELS[contact.contactChannel]} • ${contact.contactPhone}`
                      : contact.contactChannel === 'share_sheet'
                        ? 'Share sheet'
                        : `${CHANNEL_SUMMARY_LABELS[contact.contactChannel]} • No phone number`;

                    return (
                      <View
                        key={contact.supplierId}
                        style={{
                          borderBottomWidth:
                            index < contacts.length - 1 ? glassHairlineWidth : 0,
                          borderBottomColor: glassColors.divider,
                        }}
                      >
                        <TouchableOpacity
                          onPress={() => handleToggleExpand(contact)}
                          activeOpacity={0.82}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingHorizontal: ds.spacing(16),
                            paddingVertical: ds.spacing(14),
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: ds.fontSize(15),
                                fontWeight: '600',
                                color: glassColors.textPrimary,
                              }}
                              numberOfLines={1}
                            >
                              {contact.supplierName}
                            </Text>
                            <Text
                              style={{
                                marginTop: ds.spacing(3),
                                fontSize: ds.fontSize(12),
                                color: glassColors.textSecondary,
                              }}
                              numberOfLines={1}
                            >
                              {summary}
                            </Text>
                          </View>
                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={ds.icon(16)}
                            color={glassColors.textSecondary}
                          />
                        </TouchableOpacity>

                        {isExpanded && draft ? (
                          <View
                            style={{
                              paddingHorizontal: ds.spacing(16),
                              paddingBottom: ds.spacing(16),
                            }}
                          >
                            <Text
                              style={{
                                fontSize: ds.fontSize(11),
                                fontWeight: '700',
                                color: glassColors.textSecondary,
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                              }}
                            >
                              Send Channel
                            </Text>
                            <View style={{ marginTop: ds.spacing(8) }}>
                              <MultiOptionToggle
                                options={CHANNEL_OPTIONS}
                                value={draft.contactChannel}
                                onValueChange={(value) =>
                                  setDraft((prev) =>
                                    prev ? { ...prev, contactChannel: value } : prev
                                  )
                                }
                                disabled={isSaving}
                              />
                            </View>

                            {renderField(
                              'Phone Number',
                              draft.contactPhone,
                              (value) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, contactPhone: value } : prev
                                ),
                              { placeholder: '+1 555 123 4567', keyboardType: 'phone-pad' }
                            )}

                            {renderField(
                              'Contact Name',
                              draft.contactName,
                              (value) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, contactName: value } : prev
                                ),
                              { placeholder: 'Optional' }
                            )}

                            {renderField(
                              'Notes',
                              draft.contactNotes,
                              (value) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, contactNotes: value } : prev
                                ),
                              { placeholder: 'Optional', multiline: true }
                            )}

                            <TouchableOpacity
                              onPress={() => void handleSave()}
                              disabled={isSaving}
                              activeOpacity={0.82}
                              style={{
                                marginTop: ds.spacing(16),
                                minHeight: Math.max(46, ds.buttonH - 4),
                                borderRadius: glassRadii.button,
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexDirection: 'row',
                                backgroundColor: glassColors.accent,
                                opacity: isSaving ? 0.6 : 1,
                              }}
                            >
                              <Ionicons
                                name="save-outline"
                                size={ds.icon(16)}
                                color={glassColors.textOnPrimary}
                              />
                              <Text
                                style={{
                                  marginLeft: ds.spacing(8),
                                  fontSize: ds.fontSize(14),
                                  fontWeight: '700',
                                  color: glassColors.textOnPrimary,
                                }}
                              >
                                {isSaving ? 'Saving...' : 'Save Contact'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </GlassSurface>

              <SettingsSectionLabel label="How Channels Work" />
              <GlassSurface
                intensity="subtle"
                blurred={false}
                style={{
                  marginHorizontal: glassSpacing.screen,
                  borderRadius: glassRadii.surface,
                  padding: ds.spacing(16),
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    lineHeight: ds.fontSize(19),
                    color: glassColors.textSecondary,
                  }}
                >
                  SMS opens Messages with the order pre-typed to the supplier&apos;s number.
                  WhatsApp opens a chat with the message pre-filled. Suppliers without a
                  phone number fall back to the share sheet during Send All.
                </Text>
              </GlassSurface>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
