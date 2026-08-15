// Margin Companion — BLE hook
// Scans for a device advertising service 4D555345-0001-…, connects,
// subscribes to the page-text characteristic, and reassembles chunks.
//
// Chunk wire format (from MuseBleServer.cpp):
//   byte 0  : seq   (0-based chunk index)
//   byte 1  : total (total chunk count for this page)
//   bytes 2…: UTF-8 text payload

import { useEffect, useRef, useState, useCallback } from 'react';
import { BleManager, Device, BleError, Characteristic } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { atob } from 'react-native';

export const MUSE_SERVICE_UUID   = '4D555345-0001-1000-8000-000000000000';
export const PAGE_TEXT_CHAR_UUID = '4D555345-0002-1000-8000-000000000000';

export type BleStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface UseMuseBleResult {
  status: BleStatus;
  deviceName: string | null;
  lastPageText: string | null;
  connect: () => void;
  disconnect: () => void;
}

export function useMuseBle(onPageText: (text: string) => void): UseMuseBleResult {
  const manager = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);
  const chunkBuf = useRef<Map<number, string>>(new Map());
  const [status, setStatus] = useState<BleStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [lastPageText, setLastPageText] = useState<string | null>(null);

  const handleChunk = useCallback((characteristic: Characteristic) => {
    if (!characteristic.value) return;
    const bytes = Uint8Array.from(atob(characteristic.value), c => c.charCodeAt(0));
    if (bytes.length < 2) return;

    const seq   = bytes[0];
    const total = bytes[1];
    const text  = new TextDecoder().decode(bytes.slice(2));

    chunkBuf.current.set(seq, text);

    if (chunkBuf.current.size === total) {
      const assembled = Array.from({ length: total }, (_, i) => chunkBuf.current.get(i) ?? '').join('');
      chunkBuf.current.clear();
      setLastPageText(assembled);
      onPageText(assembled);
    }
  }, [onPageText]);

  const connect = useCallback(async () => {
    setStatus('scanning');
    manager.startDeviceScan(
      [MUSE_SERVICE_UUID],
      { allowDuplicates: false },
      async (error: BleError | null, device: Device | null) => {
        if (error) { setStatus('error'); return; }
        if (!device) return;

        manager.stopDeviceScan();
        setStatus('connecting');
        setDeviceName(device.name ?? 'Margin');

        try {
          const connected = await device.connect();
          await connected.discoverAllServicesAndCharacteristics();
          deviceRef.current = connected;
          setStatus('connected');

          connected.monitorCharacteristicForService(
            MUSE_SERVICE_UUID,
            PAGE_TEXT_CHAR_UUID,
            (err, char) => {
              if (err) { setStatus('disconnected'); return; }
              if (char) handleChunk(char);
            }
          );

          connected.onDisconnected(() => {
            setStatus('disconnected');
            deviceRef.current = null;
          });
        } catch {
          setStatus('error');
        }
      }
    );
  }, [manager, handleChunk]);

  const disconnect = useCallback(() => {
    deviceRef.current?.cancelConnection();
    deviceRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => () => { manager.destroy(); }, [manager]);

  return { status, deviceName, lastPageText, connect, disconnect };
}
