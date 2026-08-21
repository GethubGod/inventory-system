// The live preview card under the invite toggles — a pure function of the
// current form state (deriveInvitePreview), re-rendered on every flip.

import { Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassHairlineWidth, tipsTheme } from '@/theme/design';
import type { InvitePreviewModel } from '../invitePreview';

function MiniPhoneFrame({ tabCount, warning }: { tabCount: number; warning: boolean }) {
  return (
    <View
      style={{
        width: 46,
        height: 82,
        backgroundColor: tipsTheme.card,
        borderRadius: 9,
        borderWidth: glassHairlineWidth,
        borderColor: tipsTheme.hairline,
        padding: 4,
      }}
    >
      <View style={{ height: 3, borderRadius: 2, backgroundColor: tipsTheme.well, marginBottom: 3 }} />
      <View style={{ flex: 1, borderRadius: 4, backgroundColor: tipsTheme.page }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingTop: 3 }}>
        {Array.from({ length: Math.max(tabCount, 1) }, (_, index) => (
          <View
            key={index}
            style={{
              width: 6,
              height: 6,
              borderRadius: 2,
              backgroundColor: !warning && index === 0 ? tipsTheme.accent : tipsTheme.disabled,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export function InvitePreviewCard({ model }: { model: InvitePreviewModel }) {
  const ds = useScaledStyles();
  return (
    <View
      style={{
        backgroundColor: tipsTheme.well,
        borderRadius: 15,
        padding: ds.spacing(11),
        flexDirection: 'row',
        gap: ds.spacing(10),
        alignItems: 'center',
      }}
    >
      <MiniPhoneFrame tabCount={model.tabLabels.length} warning={model.warning !== null} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink2, lineHeight: 17 }}>
          <Text style={{ fontWeight: '700', color: tipsTheme.ink }}>{model.heading}: </Text>
          {model.opensOn} Tabs: {model.tabLabels.join(' · ')}.
          {model.extras.length > 0 ? ` ${model.extras.join(' ')}` : ''}
        </Text>
        {model.warning ? (
          <Text
            style={{
              fontSize: ds.fontSize(11.5),
              fontWeight: '600',
              color: tipsTheme.alert,
              marginTop: ds.spacing(4),
            }}
          >
            {model.warning}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
