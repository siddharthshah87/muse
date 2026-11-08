import { useCallback, useEffect, useRef, useState } from 'react';
import { BleError, BleManager, Characteristic, Device } from 'react-native-ble-plx';
import { PageAssembler, base64ToBytes } from './pageAssembler';
import type { Narrator, Prepared } from './narrators';

export const MUSE_SERVICE_UUID = '4D555345-0001-1000-8000-000000000000';
export const PAGE_TEXT_CHAR_UUID = '4D555345-0002-1000-8000-000000000000';
export const CONTROL_CHAR_UUID = '4D555345-0004-1000-8000-000000000000';
const NEXT_PAGE_COMMAND_B64 = 'AQ=='; // 0x01, see shared/protocol/ble.md
const PEEK_NEXT_COMMAND_B64 = 'Ag=='; // 0x02: send the next page's text without turning
const PREVIEW_FLAG = 0x80; // set on seq for next-page previews
const NEXT_PAGE_WAIT_MS = 15000;
const PEEK_ANSWER_MS = 2500; // no preview by then: firmware without PEEK_NEXT

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
  /** Speaks pages: iOS system voices or on-device Kokoro (src/narrators.ts). */
  narrator: Narrator;
  /** Voice for the current narrator (system voice identifier or Kokoro voice key). */
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

export function useMuseBle({
  narrator,
  voice,
  rate,
  mode,
  autoConnect,
  onPageText,
}: UseMuseBleOptions): UseMuseBleResult {
  const managerRef = useRef<BleManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new BleManager();
  }
  const manager = managerRef.current;
  const deviceRef = useRef<Device | null>(null);
  const assemblerRef = useRef(new PageAssembler());
  const previewAssemblerRef = useRef(new PageAssembler());
  // Gapless continuous reading (shared/protocol/ble.md): the next page's text, received as a
  // preview while the current page is read; and the text we started at the turn, which the
  // real page that follows only confirms.
  const nextPreviewRef = useRef<Prepared | null>(null);
  const currentRef = useRef<Prepared | null>(null); // the page being heard
  const confirmRef = useRef<string | null>(null);
  const peekOkRef = useRef<boolean | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorSubscriptions = useRef<Array<{ remove: () => void }>>([]);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualDisconnectRef = useRef(false);
  const statusRef = useRef<BleStatus>('idle');
  const awaitingNextRef = useRef(false);
  const supportsContinuousRef = useRef(false);
  const lastPageRef = useRef<string | null>(null);

  // Latest settings, read by BLE and speech callbacks that outlive a render.
  const settingsRef = useRef({ narrator, voice, rate, mode, onPageText });
  settingsRef.current = { narrator, voice, rate, mode, onPageText };
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

  const resetPreviews = useCallback(() => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    if (nextPreviewRef.current) {
      settingsRef.current.narrator.discard(nextPreviewRef.current);
    }
    nextPreviewRef.current = null;
    confirmRef.current = null;
    previewAssemblerRef.current.reset();
  }, []);

  const clearSubscriptions = useCallback(() => {
    monitorSubscriptions.current.forEach((subscription) => subscription.remove());
    monitorSubscriptions.current = [];
  }, []);

  const stopSpeech = useCallback(() => {
    settingsRef.current.narrator.stop();
    currentRef.current = null;
    setIsSpeaking(false);
  }, []);

  const prepare = useCallback((text: string): Prepared => {
    const { narrator: engine, voice: voiceId, rate: speechRate } = settingsRef.current;
    return engine.prepare(text, { voice: voiceId ?? null, rate: speechRate });
  }, []);

  // Plays a page (interrupting whatever is playing); onDone runs only if it was read to the end.
  const play = useCallback((prepared: Prepared, onDone?: () => void) => {
    const engine = settingsRef.current.narrator;
    if (settingsRef.current.mode === 'self' || pausedRef.current) {
      stopSpeech();
      engine.discard(prepared);
      return;
    }
    if (currentRef.current && currentRef.current !== prepared) {
      engine.discard(currentRef.current); // stop synthesizing a page nobody will hear
    }
    currentRef.current = prepared;
    setAudioDisconnected(false);
    setIsSpeaking(true);
    engine.play(prepared, {
      onDone: () => {
        setIsSpeaking(false);
        onDone?.();
      },
      onInterrupted: () => {
        setIsSpeaking(false);
        if (statusRef.current === 'connected') {
          setAudioDisconnected(true);
        }
      },
    });
  }, [stopSpeech]);

  const speak = useCallback(
    (text: string, onDone?: () => void) => play(prepare(text), onDone),
    [play, prepare],
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
      // No page came: end of book, or the X4 is busy.
      waitTimer.current = null;
      awaitingNextRef.current = false;
      confirmRef.current = null;
      setIsTurningPage(false);
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
  }, [clearWait]);

  const requestPeek = useCallback(async () => {
    const device = deviceRef.current;
    if (
      settingsRef.current.mode !== 'continuous' ||
      peekOkRef.current === false ||
      !device ||
      !supportsContinuousRef.current
    ) {
      return;
    }
    if (peekOkRef.current === null && !peekTimer.current) {
      peekTimer.current = setTimeout(() => {
        peekTimer.current = null;
        if (peekOkRef.current === null) {
          peekOkRef.current = false; // older firmware: turn first, then read
        }
      }, PEEK_ANSWER_MS);
    }
    try {
      await device.writeCharacteristicWithoutResponseForService(
        MUSE_SERVICE_UUID,
        CONTROL_CHAR_UUID,
        PEEK_NEXT_COMMAND_B64,
      );
    } catch {
      // the turn-then-read path still works
    }
  }, []);

  // A page has been read to the end: turn the X4 and, if the next page was previewed,
  // start reading it in the same moment.
  const afterPageRef = useRef<() => void>(() => undefined);
  const afterPage = useCallback(() => afterPageRef.current(), []);
  afterPageRef.current = () => {
    if (settingsRef.current.mode !== 'continuous' || pausedRef.current) {
      return;
    }
    const next = nextPreviewRef.current;
    nextPreviewRef.current = null;
    if (next) {
      confirmRef.current = next.text;
      lastPageRef.current = next.text;
      setLastPageText(next.text);
      settingsRef.current.onPageText?.(next.text);
      play(next, afterPage); // already prepared while the last page was read
    }
    void requestNextPage();
  };

  const handlePage = useCallback(
    (text: string) => {
      const { mode: currentMode } = settingsRef.current;
      if (waitTimer.current) {
        clearTimeout(waitTimer.current);
        waitTimer.current = null;
      }
      awaitingNextRef.current = false;
      setIsTurningPage(false);

      // The page we already started reading at the turn: nothing to do but look ahead again.
      if (confirmRef.current !== null && text === confirmRef.current) {
        confirmRef.current = null;
        void requestPeek();
        return;
      }
      confirmRef.current = null;
      if (nextPreviewRef.current) {
        settingsRef.current.narrator.discard(nextPreviewRef.current); // the reader moved: preview is stale
        nextPreviewRef.current = null;
      }

      // Pages without text (images) arrive empty (shared/protocol/ble.md): skip ahead in continuous mode.
      if (!text.trim()) {
        if (currentMode === 'continuous' && !pausedRef.current) {
          setTimeout(() => void requestNextPage(), 400);
        }
        return;
      }

      lastPageRef.current = text;
      setLastPageText(text);
      setAudioDisconnected(false);
      settingsRef.current.onPageText?.(text);

      // Pages are read to the end before the X4 turns, so it never shows a page ahead of the voice.
      speak(text, currentMode === 'continuous' ? afterPage : undefined);
      void requestPeek();
    },
    [afterPage, requestNextPage, requestPeek, speak],
  );

  const handlePreview = useCallback((text: string) => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    peekOkRef.current = true;
    if (nextPreviewRef.current) {
      settingsRef.current.narrator.discard(nextPreviewRef.current);
    }
    // Prepare the next page now (Kokoro synthesizes it after the page being heard). Empty preview:
    // next page not laid out yet, or no text — turn first, then read.
    nextPreviewRef.current = text.trim() ? prepare(text) : null;
  }, [prepare]);

  const handlePageRef = useRef(handlePage);
  handlePageRef.current = handlePage;

  const handleChunk = useCallback(
    (characteristic: Characteristic) => {
      if (!characteristic.value) {
        return;
      }
      const bytes = base64ToBytes(characteristic.value);
      if (bytes.length && bytes[0] & PREVIEW_FLAG) {
        const unflagged = bytes.slice();
        unflagged[0] &= ~PREVIEW_FLAG;
        const preview = previewAssemblerRef.current.push(unflagged);
        if (preview !== null) {
          handlePreview(preview);
        }
        return;
      }
      const assembled = assemblerRef.current.push(bytes);
      if (assembled !== null) {
        handlePageRef.current(assembled);
      }
    },
    [handlePreview],
  );

  const connect = useCallback(() => {
    if (statusRef.current === 'scanning' || statusRef.current === 'connecting' || statusRef.current === 'connected') {
      return;
    }

    manualDisconnectRef.current = false;
    clearReconnectTimer();
    assemblerRef.current.reset();
    resetPreviews();
    peekOkRef.current = null;
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
            resetPreviews();
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
  }, [clearReconnectTimer, clearSubscriptions, clearWait, handleChunk, manager, resetPreviews]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    clearWait();
    manager.stopDeviceScan();
    clearSubscriptions();
    stopSpeech();
    resetPreviews();
    setAudioDisconnected(false);
    const currentDevice = deviceRef.current;
    if (currentDevice) {
      currentDevice.cancelConnection().catch(() => undefined);
    }
    deviceRef.current = null;
    setStatus('idle');
  }, [clearReconnectTimer, clearSubscriptions, clearWait, manager, resetPreviews, stopSpeech]);

  const replayLastPage = useCallback(() => {
    const text = lastPageRef.current;
    if (!text) {
      return;
    }
    pausedRef.current = false;
    setIsPaused(false);
    confirmRef.current = null;
    speak(text, afterPage);
    void requestPeek();
  }, [afterPage, requestPeek, speak]);

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setIsPaused(next);
    clearWait();
    if (next) {
      stopSpeech();
    } else if (lastPageRef.current) {
      confirmRef.current = null;
      speak(lastPageRef.current, afterPage);
      void requestPeek();
    }
  }, [afterPage, clearWait, requestPeek, speak, stopSpeech]);

  const previousNarratorRef = useRef(narrator);
  useEffect(() => {
    if (previousNarratorRef.current !== narrator) {
      previousNarratorRef.current.stop();
      previousNarratorRef.current = narrator;
      resetPreviews();
      currentRef.current = null;
      setIsSpeaking(false);
    }
  }, [narrator, resetPreviews]);

  // Mode changes: silence for "I'll read"; switching to continuous between pages reads the
  // current page and carries on (mid-page, the page's own end-of-speech turns it).
  const previousModeRef = useRef(mode);
  useEffect(() => {
    if (previousModeRef.current === mode) {
      return;
    }
    previousModeRef.current = mode;
    resetPreviews();
    clearWait();
    pausedRef.current = false;
    setIsPaused(false);
    if (mode === 'self') {
      stopSpeech();
    } else if (mode === 'continuous' && statusRef.current === 'connected') {
      if (!isSpeaking && lastPageRef.current) {
        speak(lastPageRef.current, afterPage);
      }
      void requestPeek();
    }
  }, [afterPage, clearWait, isSpeaking, mode, requestPeek, resetPreviews, speak, stopSpeech]);

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
      if (peekTimer.current) {
        clearTimeout(peekTimer.current);
      }
      manager.stopDeviceScan();
      clearSubscriptions();
      settingsRef.current.narrator.stop();
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
