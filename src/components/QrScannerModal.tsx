import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors } from '@/constants';
import { useStockStore } from '@/store';

interface QrScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScan: (areaId: string) => void;
}

function parseQrPayload(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.type === 'babytuna_area' && typeof parsed.id === 'string') {
      return parsed.id;
    }
  } catch {
    // ignore
  }

  return raw;
}

export function QrScannerModal({ visible, onClose, onScan }: QrScannerModalProps) {
  const { storageAreas } = useStockStore();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPermission = permission?.granted ?? false;
  const canAskAgain = permission?.canAskAgain ?? false;

  useEffect(() => {
    if (visible) {
      setError(null);
      setScanned(false);
      if (!hasPermission) {
        requestPermission();
      }
    }
  }, [visible, hasPermission, requestPermission]);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanned) return;
      setScanned(true);

      const parsed = parseQrPayload(data);
      const normalized = parsed.toLowerCase();
      const match =
        storageAreas.find((area) => area.qr_code?.toLowerCase() === normalized) ||
        storageAreas.find((area) => area.id === parsed);

      if (!match) {
        setError('This QR code is not registered.');
        setTimeout(() => setScanned(false), 1500);
        return;
      }

      onScan(match.id);
      onClose();
    },
    [scanned, storageAreas, onScan, onClose]
  );

  const statusContent = useMemo(() => {
    if (permission === null) {
      return (
        <View style={styles.permissionContainer}>
          <ActivityIndicator size="small" color={colors.primary[600]} />
          <Text style={styles.permissionText}>Requesting camera access...</Text>
        </View>
      );
    }

    if (!hasPermission) {
      return (
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={32} color={colors.warning} />
          <Text style={styles.permissionText}>
            Camera access is required to scan QR codes.
          </Text>
          {canAskAgain ? (
            <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
              <Text style={styles.permissionButtonText}>Allow Camera</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.permissionButton} onPress={handleOpenSettings}>
              <Text style={styles.permissionButtonText}>Open Settings</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return null;
  }, [permission, hasPermission, canAskAgain, requestPermission, handleOpenSettings]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Scan QR Code</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.gray[600]} />
            </TouchableOpacity>
          </View>

          <View style={styles.cameraContainer}>
            {statusContent ? (
              statusContent
            ) : (
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarcodeScanned}
              />
            )}
            <View style={styles.frame} />
          </View>

          <Text style={styles.instruction}>Scan the QR code at any station.</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  cameraContainer: {
    height: 320,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 220,
    height: 220,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  instruction: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    fontSize: 14,
    textAlign: 'center',
    color: '#4B5563',
  },
  errorText: {
    paddingBottom: 16,
    paddingHorizontal: 20,
    fontSize: 13,
    textAlign: 'center',
    color: colors.error,
  },
  permissionContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  permissionText: {
    marginTop: 12,
    textAlign: 'center',
    color: '#4B5563',
  },
  permissionButton: {
    marginTop: 12,
    backgroundColor: colors.primary[500],
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
