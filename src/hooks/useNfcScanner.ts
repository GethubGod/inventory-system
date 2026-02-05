import { useCallback, useRef, useState } from 'react';
import Constants from 'expo-constants';

type NfcModule = {
  default: any;
  NfcTech: any;
};

interface UseNfcScannerResult {
  isSupported: boolean;
  isEnabled: boolean;
  isScanning: boolean;
  startScanning: () => Promise<void>;
  stopScanning: () => void;
  lastScannedTag: string | null;
  error: string | null;
}

export function useNfcScanner(): UseNfcScannerResult {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedTag, setLastScannedTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nfcRef = useRef<{ manager: any; NfcTech: any } | null>(null);

  const loadNfcModule = useCallback(() => {
    if (nfcRef.current) return nfcRef.current;
    try {
      const mod = require('react-native-nfc-manager') as NfcModule;
      const manager = mod?.default ?? mod;
      nfcRef.current = { manager, NfcTech: mod.NfcTech };
      return nfcRef.current;
    } catch (err) {
      return null;
    }
  }, []);

  const startScanning = useCallback(async () => {
    setError(null);
    setLastScannedTag(null);

    try {
      if (Constants.appOwnership === 'expo') {
        setIsSupported(false);
        setIsEnabled(false);
        setError("Your device doesn't support NFC in Expo Go. Use QR scanning instead.");
        return;
      }

      const nfc = loadNfcModule();
      if (!nfc) {
        setIsSupported(false);
        setIsEnabled(false);
        setError('NFC module not available. Create a development build to scan tags.');
        return;
      }

      const supported = await nfc.manager.isSupported();
      setIsSupported(supported);

      if (!supported) {
        setIsEnabled(false);
        setError("Your device doesn't support NFC. Use QR scanning instead.");
        return;
      }

      await nfc.manager.start();
      const enabled = await nfc.manager.isEnabled();
      setIsEnabled(enabled);

      if (!enabled) {
        setError('NFC is turned off. Enable it in Settings to scan tags.');
        return;
      }

      if (isScanning) return;

      setIsScanning(true);
      await nfc.manager.requestTechnology(nfc.NfcTech.Ndef, {
        alertMessage: 'Ready to scan NFC tag',
      });

      const tag = await nfc.manager.getTag();
      const tagId = (tag as any)?.id || (tag as any)?.serialNumber || null;
      if (!tagId) {
        setError('Failed to read NFC tag.');
      } else {
        setLastScannedTag(tagId);
      }
    } catch (err: any) {
      if (err?.message?.toLowerCase?.().includes('cancel')) {
        return;
      }
      setError('Failed to read NFC tag.');
    } finally {
      setIsScanning(false);
      const nfc = nfcRef.current;
      if (nfc) {
        nfc.manager.cancelTechnologyRequest().catch(() => undefined);
      }
    }
  }, [isScanning, loadNfcModule]);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
    const nfc = nfcRef.current;
    if (nfc) {
      nfc.manager.cancelTechnologyRequest().catch(() => undefined);
    }
  }, []);

  return {
    isSupported,
    isEnabled,
    isScanning,
    startScanning,
    stopScanning,
    lastScannedTag,
    error,
  };
}
