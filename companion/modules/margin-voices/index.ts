import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Speech from 'expo-speech';

export type VoiceQuality = 'premium' | 'enhanced' | 'default';
export type PersonalVoiceStatus = 'authorized' | 'denied' | 'unsupported' | 'notDetermined' | 'unknown';

export interface MarginVoice {
  identifier: string;
  name: string;
  language: string;
  quality: VoiceQuality;
  isPersonalVoice: boolean;
  isNoveltyVoice: boolean;
}

interface NativeMarginVoices {
  getVoices(): MarginVoice[];
  getPersonalVoiceAuthorizationStatus(): PersonalVoiceStatus;
  requestPersonalVoiceAuthorization(): Promise<PersonalVoiceStatus>;
  configurePlaybackSession(): boolean;
}

// Null in builds made before this module existed (or on non-iOS): fall back to expo-speech.
const native = requireOptionalNativeModule<NativeMarginVoices>('MarginVoices');

export const hasNativeVoices = native !== null;

export async function getVoices(): Promise<MarginVoice[]> {
  if (native) {
    return native.getVoices();
  }
  const voices = await Speech.getAvailableVoicesAsync();
  return voices.map((v) => ({
    identifier: v.identifier,
    name: v.name,
    language: v.language,
    quality: v.quality === Speech.VoiceQuality.Enhanced ? 'enhanced' : 'default',
    isPersonalVoice: false,
    isNoveltyVoice: false,
  }));
}

export function getPersonalVoiceStatus(): PersonalVoiceStatus {
  return native ? native.getPersonalVoiceAuthorizationStatus() : 'unsupported';
}

export async function requestPersonalVoice(): Promise<PersonalVoiceStatus> {
  return native ? native.requestPersonalVoiceAuthorization() : 'unsupported';
}

export function configurePlaybackSession(): boolean {
  return native ? native.configurePlaybackSession() : false;
}
