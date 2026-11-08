import { useCallback, useEffect, useRef, useState } from 'react';
import { BleError, BleManager, Characteristic, Device } from 'react-native-ble-plx';
import * as Speech from 'expo-speech';
import { PageAssembler, base64ToBytes } from './pageAssembler';
import { PageBreakJoiner, splitForSpeech } from './narration';

export const MUSE_SERVICE_UUID = '4D555345-0001-1000-8000-000000000000';
export const PAGE_TEXT_CHAR_UUID = '4D555345-0002-1000-8000-000000000000';
export const CONTROL_CHAR_UUID = '4D555345-0004-1000-8000-000000000000';
const NEXT_PAGE_COMMAND_B64 = 'AQ=='; // 0x01, see shared/protocol/ble.md
const NEXT_PAGE_WAIT_MS = 15000;

/** self: no speech · page: speak each page, then wait · continuous: speak, turn the page, repeat */
export type ReadingMode = 'self' | 'page' | 'continuous';

export type BleStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface UseMuseBleOptions {
  voice?: string | null;
  rate: number;
  mode: ReadingMode;
  autoConnect: boolean;
  onPageText?: (text: string) => void;
}

export interface UseMuseBleResult {
  status: BleStatus;
  deviceName: string | null;
  lastPageText: string | null;
  isSpeaking: boolean;
  isPaused: boolean;
  isTurningPage: boolean;
  /** False when the connected X4's firmware predates the page-turn command. */
  supportsContinuous: boolean;
  audioDisconnected: boolean;
  connect: () => void;
  disconnect: () => void;
  replayLastPage: () => void;
  togglePause: () => void;
}

function clampRate(rate: number) {
  return Math.max(0.5, Math.min(2, rate));
}

export function useMuseBle({ voice, rate, mode, autoConnect, onPageText }: UseMuseBleOptions): UseMuseBleResult {
  const managerRef = useRef<BleManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new BleManager();
  }
  const manager = managerRef.current;
  const deviceRef = useRef<Device | null>(null);
  const assemblerRef = useRef(new PageAssembler());
  const joinerRef = useRef(new PageBreakJoiner());
  const monitorSubscriptions = useRef<Array<{ remove: () => void }>>([]);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDisconnectRef = useRef(false);
  const statusRef = useRef<BleStatus>('idle');
  const speakToken = useRef(0); // bumps on every stop/new page; stale speech callbacks are ignored
  const awaitingNextRef = useRef(false);
  const supportsContinuousRef = useRef(false);
  const lastPageRef = useRef<string | null>(null);

  // Latest settings, read by BLE and speech callbacks that outlive a render.
  const settingsRef = useRef({ voice, rate, mode, onPageText });
  settingsRef.current = { voice, rate, mode, onPageText };
  const pausedRef = useRef(false);

  const [status, setStatus] = useState<BleStatus>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [lastPageText, setLastPageText] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTurningPage, setIsTurningPage] = useState(false);
  const [supportsContinuous, setSupportsContinuous] = useState(false);
  const [audioDisconnected, setAudioDisconnected] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
  }, []);

  const clearWait = useCallback(() => {
    if (waitTimer.current) {
      clearTimeout(waitTimer.current);
      waitTimer.current = null;
    }
    awaitingNextRef.current = false;
    setIsTurningPage(false);
  }, []);

  const clearSubscriptions = useCallback(() => {
    monitorSubscriptions.current.forEach((subscription) => subscription.remove());
    monitorSubscriptions.current = [];
  }, []);

  const stopSpeech = useCallback(() => {
    speakToken.current += 1;
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  // Speaks text as a queue of sentence-sized utterances; onDone runs only if it was read to the end.
  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      stopSpeech();
      if (settingsRef.current.mode === 'self' || pausedRef.current) {
        return;
      }
      const pieces = splitForSpeech(text);
      if (!pieces.length) {
        onDone?.();
        return;
      }
      const token = speakToken.current;
      const { voice: voiceId, rate: speechRate } = settingsRef.current;
      setAudioDisconnected(false);
      setIsSpeaking(true);

      const interrupted = () => {
        if (token !== speakToken.current) {
          return; // we stopped it ourselves
        }
        speakToken.current += 1;
        setIsSpeaking(false);
        if (statusRef.current === 'connected') {
          setAudioDisconnected(true);
        }
      };

      pieces.forEach((piece, index) => {
        const last = index === pieces.length - 1;
        Speech.speak(piece, {
          language: 'en-US',
          rate: clampRate(speechRate),
          voice: voiceId ?? undefined,
          onDone: last
            ? () => {
                if (token !== speakToken.current) {
                  return;
                }
                setIsSpeaking(false);
                onDone?.();
              }
            : undefined,
          onStopped: interrupted,
          onError: interrupted,
        });
      });
    },
    [stopSpeech],
  );

  const requestNextPage = useCallback(async () => {
    const device = deviceRef.current;
    if (settingsRef.current.mode !== 'continuous' || pausedRef.current || !device || !supportsContinuousRef.current) {
      return;
    }
    if (waitTimer.current) {
      clearTimeout(waitTimer.current);
    }
    awaitingNextRef.current = true;
    setIsTurningPage(true);
    waitTimer.current = setTimeout(() => {
      // No page came (end of book, or the X4 is busy): finish any held sentence and stop.
      waitTimer.current = null;
      awaitingNextRef.current = false;
      setIsTurningPage(false);
      const carry = joinerRef.current.takeCarry();
      if (carry) {
        speak(carry);
      }
    }, NEXT_PAGE_WAIT_MS);
    try {
      await device.writeCharacteristicWithoutResponseForService(
        MUSE_SERVICE_UUID,
        CONTROL_CHAR_UUID,
        NEXT_PAGE_COMMAND_B64,
      );
    } catch {
      clearWait();
    }
  }, [clearWait, speak]);

  const afterPage = useCallback(() => {
    if (settingsRef.current.mode === 'continuous') {
      void requestNextPage();
    }
  }, [requestNextPage]);

  const handlePage = useCallback(
    (text: string) => {
      const { mode: currentMode } = settingsRef.current;
      // Pages without text (images) arrive empty (shared/protocol/ble.md): skip ahead in continuous mode.
      if (!text.trim()) {
        if (currentMode === 'continuous' && !pausedRef.current) {
          setTimeout(() => void requestNextPage(), 400);
        }
        return;
      }
      const continuesPrevious = awaitingNextRef.current;
      if (waitTimer.current) {
        clearTimeout(waitTimer.current);
        waitTimer.current = null;
      }
      awaitingNextRef.current = false;
      setIsTurningPage(false);

      lastPageRef.current = text;
      setLastPageText(text);
      setAudioDisconnected(false);
      settingsRef.current.onPageText?.(text);

      if (currentMode === 'continuous') {
        speak(joinerRef.current.next(text, continuesPrevious), afterPage);
      } else {
        joinerRef.current.reset();
        speak(text);
      }
    },
    [afterPage, requestNextPage, speak],
  );

  const handlePageRef = useRef(handlePage);
  handlePageRef.current = handlePage;

  const handleChunk = useCallback((characteristic: Characteristic) => {
    if (!characteristic.value) {
      return;
    }
    const assembled = assemblerRef.current.push(base64ToBytes(characteristic.value));
    if (assembled !== null) {
      handlePageRef.current(assembled);
    }
  }, []);

  const connect = useCallback(() => {
    if (statusRef.current === 'scanning' || statusRef.current === 'connecting' || statusRef.current === 'connected') {
      return;
    }

    manualDisconnectRef.current = false;
    clearReconnectTimer();
    assemblerRef.current.reset();
    joinerRef.current.reset();
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
          const characteristics = await connected.characteristicsForService(MUSE_SERVICE_UUID);
          const hasControl = characteristics.some(
            (c) => c.uuid.toLowerCase() === CONTROL_CHAR_UUID.toLowerCase(),
          );
          supportsContinuousRef.current = hasControl;
          setSupportsContinuous(hasControl);

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

          connected.onDisconnected(() => {
            clearSubscriptions();
            clearWait();
            deviceRef.current = null;
            setStatus(manualDisconnectRef.current ? 'idle' : 'disconnected');
          });
        } catch {
          deviceRef.current = null;
          clearSubscriptions();
          setStatus('error');
        }
      },
    );
  }, [clearReconnectTimer, clearSubscriptions, clearWait, handleChunk, manager]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    clearWait();
    manager.stopDeviceScan();
    clearSubscriptions();
    stopSpeech();
    joinerRef.current.reset();
    setAudioDisconnected(false);
    const currentDevice = deviceRef.current;
    if (currentDevice) {
      currentDevice.cancelConnection().catch(() => undefined);
    }
    deviceRef.current = null;
    setStatus('idle');
  }, [clearReconnectTimer, clearSubscriptions, clearWait, manager, stopSpeech]);

  const replayLastPage = useCallback(() => {
    const text = lastPageRef.current;
    if (!text) {
      return;
    }
    pausedRef.current = false;
    setIsPaused(false);
    joinerRef.current.reset();
    speak(text, afterPage);
  }, [afterPage, speak]);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setIsPaused(next);
    clearWait();
    if (next) {
      stopSpeech();
    } else if (lastPageRef.current) {
      joinerRef.current.reset();
      speak(lastPageRef.current, afterPage);
    }
  }, [afterPage, clearWait, speak, stopSpeech]);

  // Mode changes: silence for "I'll read"; switching to continuous between pages reads the
  // current page and carries on (mid-page, the page's own end-of-speech turns it).
  const previousModeRef = useRef(mode);
  useEffect(() => {
    if (previousModeRef.current === mode) {
      return;
    }
    previousModeRef.current = mode;
    joinerRef.current.reset();
    clearWait();
    pausedRef.current = false;
    setIsPaused(false);
    if (mode === 'self') {
      stopSpeech();
    } else if (mode === 'continuous' && !isSpeaking && lastPageRef.current && statusRef.current === 'connected') {
      speak(lastPageRef.current, afterPage);
    }
  }, [afterPage, clearWait, isSpeaking, mode, speak, stopSpeech]);

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
      if (waitTimer.current) {
        clearTimeout(waitTimer.current);
      }
      manager.stopDeviceScan();
      clearSubscriptions();
      speakToken.current += 1;
      Speech.stop();
      manager.destroy();
    },
    [clearReconnectTimer, clearSubscriptions, manager],
  );

  return {
    status,
    deviceName,
    lastPageText,
    isSpeaking,
    isPaused,
    isTurningPage,
    supportsContinuous,
    audioDisconnected,
    connect,
    disconnect,
    replayLastPage,
    togglePause,
  };
}
