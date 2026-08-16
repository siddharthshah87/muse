import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'margin-companion-settings';

export interface CompanionSettings {
  voice: string | null;
  rate: number;
  autoConnect: boolean;
}

const DEFAULT_SETTINGS: CompanionSettings = {
  voice: null,
  rate: 0.95,
  autoConnect: true,
};

function normalizeSettings(value: Partial<CompanionSettings> | null | undefined): CompanionSettings {
  return {
    voice: typeof value?.voice === 'string' ? value.voice : null,
    rate:
      typeof value?.rate === 'number'
        ? Math.max(0.5, Math.min(2, Number(value.rate.toFixed(2))))
        : DEFAULT_SETTINGS.rate,
    autoConnect: typeof value?.autoConnect === 'boolean' ? value.autoConnect : DEFAULT_SETTINGS.autoConnect,
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((storedValue) => {
        if (!active) {
          return;
        }

        if (!storedValue) {
          setIsHydrated(true);
          return;
        }

        const parsed = JSON.parse(storedValue) as Partial<CompanionSettings>;
        setSettings(normalizeSettings(parsed));
        setIsHydrated(true);
      })
      .catch(() => {
        if (active) {
          setIsHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => undefined);
  }, [isHydrated, settings]);

  return {
    settings,
    isHydrated,
    setVoice: (voice: string | null) => setSettings((current) => ({ ...current, voice })),
    setRate: (rate: number) =>
      setSettings((current) => ({
        ...current,
        rate: Math.max(0.5, Math.min(2, Number(rate.toFixed(2)))),
      })),
    setAutoConnect: (autoConnect: boolean) => setSettings((current) => ({ ...current, autoConnect })),
  };
}
