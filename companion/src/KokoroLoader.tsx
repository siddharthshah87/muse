import { useEffect } from 'react';
import { models, useTextToSpeech } from 'react-native-executorch';
import type { KokoroNarrator } from './narrators';

export interface KokoroState {
  isReady: boolean;
  /** Download progress, 0–100. */
  progress: number;
  error: string | null;
  synthesize?: ConstructorParameters<typeof KokoroNarrator>[0];
  synthesizeStop?: () => void;
}

// CPU (XNNPACK) build: runs with the screen locked, unlike GPU work, which iOS blocks in the background.
const KOKORO_MODEL = models.textToSpeech.KOKORO.EN_US.XNNPACK_FP32;

/**
 * Downloads (once, ~330 MB, cached) and loads the on-device Kokoro voice. Mounted only while
 * the Kokoro engine is selected, so choosing it is what starts the download; unmounting frees
 * the model's memory.
 */
export function KokoroLoader({ onChange }: { onChange: (state: KokoroState) => void }) {
  const tts = useTextToSpeech(KOKORO_MODEL);

  useEffect(() => {
    onChange({
      isReady: tts.isReady,
      progress: tts.downloadProgress,
      error: tts.error ? tts.error.message : null,
      synthesize: tts.synthesize as KokoroState['synthesize'],
      synthesizeStop: tts.synthesizeStop,
    });
  }, [onChange, tts.downloadProgress, tts.error, tts.isReady, tts.synthesize, tts.synthesizeStop]);

  return null;
}
