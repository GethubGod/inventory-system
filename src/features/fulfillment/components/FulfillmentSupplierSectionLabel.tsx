import React from 'react';
import { Text } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface FulfillmentSupplierSectionLabelProps {
  readyCount: number;
}

export function FulfillmentSupplierSectionLabel({
  readyCount,
}: FulfillmentSupplierSectionLabelProps) {
  const ds = useScaledStyles();

  return (
    <Text
      style={{
        color: '#9B958F',
        fontSize: ds.fontSize(11),
        fontWeight: '700',
        letterSpacing: 1.5,
        marginTop: ds.spacing(32),
        marginBottom: ds.spacing(20),
        textTransform: 'uppercase',
      }}
    >
      SUPPLIERS · {readyCount} READY
    </Text>
  );
}
