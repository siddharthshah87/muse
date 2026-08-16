import { useCallback, useEffect, useRef, useState } from 'react';
import { BleError, BleManager, Characteristic, Device } from 'react-native-ble-plx';
import * as Speech from 'expo-speech';
import { atob } from 'react-native';

export const MUSE_SERVICE_UUID = '4D555345-0001-1000-8000-000000000000';
export const PAGE_TEXT_CHAR_UUID = '4D555345-0002-1000-8000-000000000000';
export const BOOK_METADATA_CHAR_UUID = '4D555345-0003-1000-8000-000000000000';

export type BleStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

interface BookMetadata {
  title?: string;
  author?: string;
  page?: number;
}

export interface UseMuseBleOptions {
  voice?: string | null;
  rate: number;
  muted: boolean;
  autoConnect: boolean;
  onPageText?: (text: string) => void;
}

export interface UseMuseBleResult {
  status: BleStatus;
  deviceName: string | null;
  lastPageText: string | null;
  bookTitle: string | null;
  bookAuthor: string | null;
  currentPage: number | null;
  isSpeaking: boolean;
  audioDisconnected: boolean;
  connect: () => void;
  disconnect: () => void;
  replayLastPage: () => void;
}

function decodeBase64Text(value: string) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function clampRate(rate: number) {
  return Math.max(0.5, Math.min(2, rate));
}

export function useMuseBle({ voice, rate, muted, autoConnect, onPageText }: UseMuseBleOptions): UseMuseBleResult {
  const manager = useRef(new BleManager()).current;
  const deviceRef = useRef<Device | null>(null);
  const chunkBuf = useRef<Map<number, string>>(new Map());
  const monitorSubscriptions = useRef<Array<{ remove: () => void }>>([]);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDisconnectRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const previousMutedRef = useRef(muted);
  const statusRef = useRef<BleStatus>('idle');
  const mutedRef = useRef(muted);

  const [status, setStatus] = useState<BleStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [lastPageText, setLastPageText] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState<string | null>(null);
  const [bookAuthor, setBookAuthor] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioDisconnected, setAudioDisconnected] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
  }, []);

  const clearSubscriptions = useCallback(() => {
    monitorSubscriptions.current.forEach((subscription) => subscription.remove());
    monitorSubscriptions.current = [];
  }, []);

  const speakText = useCallback(
    (text: string) => {
      if (!text || mutedRef.current) {
        return;
      }

      intentionalStopRef.current = true;
      Speech.stop();
      setAudioDisconnected(false);
      setIsSpeaking(true);

      Speech.speak(text, {
        language: 'en-US',
        rate: clampRate(rate),
        voice: voice ?? undefined,
        onDone: () => {
          intentionalStopRef.current = false;
          setIsSpeaking(false);
          setAudioDisconnected(false);
        },
        onStopped: () => {
          const intentional = intentionalStopRef.current;
          intentionalStopRef.current = false;
          setIsSpeaking(false);
          if (!intentional && statusRef.current === 'connected' && !mutedRef.current) {
            setAudioDisconnected(true);
          }
        },
        onError: () => {
          intentionalStopRef.current = false;
          setIsSpeaking(false);
          if (!mutedRef.current) {
            setAudioDisconnected(true);
          }
        },
      });
    },
    [rate, voice],
  );

  const handleMetadata = useCallback((characteristic: Characteristic) => {
    if (!characteristic.value) {
      return;
    }

    try {
      const metadata = JSON.parse(decodeBase64Text(characteristic.value)) as BookMetadata;
      setBookTitle(typeof metadata.title === 'string' ? metadata.title : null);
      setBookAuthor(typeof metadata.author === 'string' ? metadata.author : null);
      setCurrentPage(typeof metadata.page === 'number' ? metadata.page : null);
    } catch {
      // Ignore malformed or partially rolled-out metadata payloads.
    }
  }, []);

  const handleChunk = useCallback(
    (characteristic: Characteristic) => {
      if (!characteristic.value) {
        return;
      }

      const bytes = Uint8Array.from(atob(characteristic.value), (char) => char.charCodeAt(0));
      if (bytes.length < 2) {
        return;
      }

      const seq = bytes[0];
      const total = bytes[1];
      const text = new TextDecoder().decode(bytes.slice(2));

      chunkBuf.current.set(seq, text);

      if (chunkBuf.current.size === total) {
        const assembled = Array.from({ length: total }, (_, index) => chunkBuf.current.get(index) ?? '').join('');
        chunkBuf.current.clear();
        setLastPageText(assembled);
        setAudioDisconnected(false);
        onPageText?.(assembled);
        speakText(assembled);
      }
    },
    [onPageText, speakText],
  );

  const connect = useCallback(() => {
    if (statusRef.current === 'scanning' || statusRef.current === 'connecting' || statusRef.current === 'connected') {
      return;
    }

    manualDisconnectRef.current = false;
    clearReconnectTimer();
    chunkBuf.current.clear();
    clearSubscriptions();
    manager.stopDeviceScan();
    setStatus('scanning');

    manager.startDeviceScan(
      [MUSE_SERVICE_UUID],
      { allowDuplicates: false },
      async (error: BleError | null, device: Device | null) => {
        if (error) {
          setStatus('error');
          return;
        }

        if (!device) {
          return;
        }

        manager.stopDeviceScan();
        setStatus('connecting');
        setDeviceName(device.name ?? 'Margin');

        try {
          const connected = await device.connect();
          await connected.discoverAllServicesAndCharacteristics();
          clearSubscriptions();
          deviceRef.current = connected;
          setStatus('connected');
          setAudioDisconnected(false);

          const pageSubscription = connected.monitorCharacteristicForService(
            MUSE_SERVICE_UUID,
            PAGE_TEXT_CHAR_UUID,
            (monitorError, characteristic) => {
              if (monitorError) {
                setStatus('disconnected');
                return;
              }

              if (characteristic) {
                handleChunk(characteristic);
              }
            },
          );

          monitorSubscriptions.current.push(pageSubscription);

          try {
            const metadataSubscription = connected.monitorCharacteristicForService(
              MUSE_SERVICE_UUID,
              BOOK_METADATA_CHAR_UUID,
              (metadataError, characteristic) => {
                if (metadataError || !characteristic) {
                  return;
                }

                handleMetadata(characteristic);
              },
            );

            monitorSubscriptions.current.push(metadataSubscription);
          } catch {
            // Older firmware may not expose metadata yet.
          }

          connected.onDisconnected(() => {
            clearSubscriptions();
            deviceRef.current = null;
            setStatus(manualDisconnectRef.current ? 'idle' : 'disconnected');
            setIsSpeaking(false);
          });
        } catch {
          deviceRef.current = null;
          clearSubscriptions();
          setStatus('error');
        }
      },
    );
  }, [clearReconnectTimer, clearSubscriptions, handleChunk, handleMetadata, manager]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    manager.stopDeviceScan();
    clearSubscriptions();
    intentionalStopRef.current = true;
    Speech.stop();
    setIsSpeaking(false);
    setAudioDisconnected(false);
    const currentDevice = deviceRef.current;
    if (currentDevice) {
      currentDevice.cancelConnection().catch(() => undefined);
    }
    deviceRef.current = null;
    setStatus('idle');
  }, [clearReconnectTimer, clearSubscriptions, manager]);

  const replayLastPage = useCallback(() => {
    if (lastPageText) {
      speakText(lastPageText);
    }
  }, [lastPageText, speakText]);

  useEffect(() => {
    if (muted) {
      intentionalStopRef.current = true;
      Speech.stop();
      setIsSpeaking(false);
    } else if (previousMutedRef.current && status === 'connected' && lastPageText) {
      replayLastPage();
    }

    previousMutedRef.current = muted;
  }, [lastPageText, muted, replayLastPage, status]);

  useEffect(() => {
    if (!autoConnect || manualDisconnectRef.current) {
      return;
    }

    if (status === 'idle') {
      connect();
      return;
    }

    if (status === 'disconnected' || status === 'error') {
      clearReconnectTimer();
      reconnectTimeout.current = setTimeout(() => {
        connect();
      }, 1600);
    }
  }, [autoConnect, clearReconnectTimer, connect, status]);

  useEffect(
    () => () => {
      clearReconnectTimer();
      manager.stopDeviceScan();
      clearSubscriptions();
      intentionalStopRef.current = true;
      Speech.stop();
      manager.destroy();
    },
    [clearReconnectTimer, clearSubscriptions, manager],
  );

  return {
    status,
    deviceName,
    lastPageText,
    bookTitle,
    bookAuthor,
    currentPage,
    isSpeaking,
    audioDisconnected,
    connect,
    disconnect,
    replayLastPage,
  };
}
