// Link ready: single-use personalized link, copy or send by text
// (recipient-less sms: body prefill — the manager picks the thread).

import { useState } from 'react';
import { Linking, Platform, Share, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { StackScreenHeader } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerNotificationHaptic, NotificationFeedbackType } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import type { InviteLocationGroup } from '@/services/invites';
import { LOCATION_GROUP_LABELS } from './invitePreview';
import { buildInviteMessageBody, buildInviteSmsUrl } from './teamService';

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default function InviteLinkReadyScreen() {
  const ds = useScaledStyles();
  const params = useLocalSearchParams<{
    name?: string | string[];
    joinUrl?: string | string[];
    expiryLabel?: string | string[];
    group?: string | string[];
  }>();

  const name = param(params.name);
  const joinUrl = param(params.joinUrl);
  const expiryLabel = param(params.expiryLabel) || '7 days';
  const groupParam = param(params.group);
  const group: InviteLocationGroup =
    groupParam === 'sushi' || groupParam === 'poki' || groupParam === 'both' ? groupParam : 'both';

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(joinUrl);
    triggerNotificationHaptic(NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const handleSend = async () => {
    const body = buildInviteMessageBody(name, joinUrl);
    const url = buildInviteSmsUrl(body, Platform.OS === 'android' ? 'android' : 'ios');
    try {
      await Linking.openURL(url);
    } catch {
      // Messages unavailable (simulator, iPad without SMS) — share sheet fallback.
      await Share.share({ message: body });
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tipsTheme.page }} edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View style={{ backgroundColor: tipsTheme.page }}>
          <StackScreenHeader
            title="Link ready"
            onBackPress={() =>
              router.replace(
                '/(manager)/manager-settings/team' as Parameters<typeof router.replace>[0],
              )
            }
          />
        </View>

        <View style={{ flex: 1, paddingHorizontal: ds.spacing(20), justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: ds.spacing(16) }}>
            <View
              style={{
                width: ds.icon(58),
                height: ds.icon(58),
                borderRadius: radii.circle,
                backgroundColor: tipsTheme.tint,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: ds.spacing(13),
              }}
            >
              <Ionicons name="link-outline" size={ds.icon(26)} color={tipsTheme.accent} />
            </View>
            <Text style={{ fontSize: ds.fontSize(19), fontWeight: '700', color: tipsTheme.ink }}>
              {name ? `${name}'s link is ready` : 'The link is ready'}
            </Text>
            <Text
              style={{
                fontSize: ds.fontSize(12.5),
                color: tipsTheme.ink2,
                marginTop: ds.spacing(5),
              }}
            >
              One use · expires in {expiryLabel} · {LOCATION_GROUP_LABELS[group]}
            </Text>
          </View>

          <View
            style={{
              backgroundColor: tipsTheme.well,
              borderRadius: 13,
              padding: ds.spacing(11),
              marginBottom: ds.spacing(13),
            }}
          >
            <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink2 }}>{joinUrl}</Text>
          </View>

          <View style={{ flexDirection: 'row', gap: ds.spacing(8) }}>
            <TouchableOpacity
              onPress={handleCopy}
              activeOpacity={0.82}
              style={{
                flex: 1,
                borderRadius: radii.pill,
                borderWidth: glassHairlineWidth,
                borderColor: tipsTheme.hairline,
                backgroundColor: tipsTheme.card,
                minHeight: Math.max(44, ds.buttonH - ds.spacing(6)),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: tipsTheme.ink }}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSend}
              activeOpacity={0.82}
              style={{
                flex: 2,
                borderRadius: radii.pill,
                backgroundColor: tipsTheme.accent,
                minHeight: Math.max(44, ds.buttonH - ds.spacing(6)),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '700', color: '#FFFFFF' }}>
                Send via Messages
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() =>
              router.replace(
                '/(manager)/manager-settings/team' as Parameters<typeof router.replace>[0],
              )
            }
            style={{ alignItems: 'center', marginTop: ds.spacing(18) }}
            hitSlop={{ top: 8, bottom: 8, left: 20, right: 20 }}
          >
            <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '600', color: tipsTheme.ink2 }}>
              Done
            </Text>
          </TouchableOpacity>
        </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
