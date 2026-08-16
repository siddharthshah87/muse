import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { useMuseBle } from './src/useBle';
import { useSettings } from './src/useSettings';
import { WaveformBar } from './src/WaveformBar';

type ScreenState = 'pairing' | 'reading' | 'reconnecting';

const COLORS = {
  background: '#0E0C0A',
  surface: '#17120F',
  surfaceMuted: '#1D1814',
  card: '#2A211A',
  cardWarm: '#3A2C20',
  text: '#F2EDE4',
  textMuted: 'rgba(242,237,228,0.38)',
  textSoft: 'rgba(242,237,228,0.68)',
  amber: '#D0983F',
  sage: '#8FA37E',
  border: 'rgba(242,237,228,0.08)',
};

const DEFAULT_BOOK_TITLE = 'Waiting for your next page';
const DEFAULT_BOOK_AUTHOR = 'Margin companion';

function formatVoiceName(identifier: string | null, availableVoices: Speech.Voice[]) {
  if (!identifier) {
    return 'System voice';
  }

  const match = availableVoices.find((voice) => voice.identifier === identifier);
  return match?.name ?? identifier;
}

function clampRate(value: number) {
  return Math.max(0.5, Math.min(2, value));
}

function RateSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [width, setWidth] = useState(0);

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  const updateValue = (locationX: number) => {
    if (!width) {
      return;
    }

    const ratio = Math.max(0, Math.min(1, locationX / width));
    const nextValue = clampRate(0.5 + ratio * 1.5);
    onChange(Number(nextValue.toFixed(2)));
  };

  const left = `${((clampRate(value) - 0.5) / 1.5) * 100}%`;

  return (
    <View>
      <View
        onLayout={handleLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => updateValue(event.nativeEvent.locationX)}
        onResponderMove={(event) => updateValue(event.nativeEvent.locationX)}
        style={styles.sliderTrack}
      >
        <View style={[styles.sliderFill, { width: left }]} />
        <View style={[styles.sliderThumb, { left }]} />
      </View>
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderLabel}>0.5×</Text>
        <Text style={styles.sliderLabel}>{value.toFixed(2)}×</Text>
        <Text style={styles.sliderLabel}>2.0×</Text>
      </View>
    </View>
  );
}

function PulseHalo() {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.04,
            duration: 1600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.92,
            duration: 1600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.55,
            duration: 1600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.3,
            duration: 1600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [opacity, scale]);

  return (
    <View style={styles.pulseShell}>
      <Animated.View style={[styles.pulseRing, { opacity, transform: [{ scale }] }]} />
      <View style={styles.pulseCore} />
    </View>
  );
}

function CalmDot() {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.95,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [opacity]);

  return <Animated.View style={[styles.reconnectDot, { opacity }]} />;
}

export default function App() {
  const { settings, isHydrated, setAutoConnect, setRate, setVoice } = useSettings();
  const [screen, setScreen] = useState<ScreenState>('pairing');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const openedReadingOnce = useRef(false);

  useEffect(() => {
    let active = true;

    Speech.getAvailableVoicesAsync()
      .then((availableVoices) => {
        if (active) {
          setVoices(availableVoices);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  const {
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
  } = useMuseBle({
    voice: settings.voice,
    rate: settings.rate,
    muted,
    autoConnect: isHydrated && settings.autoConnect,
  });

  useEffect(() => {
    if (screen === 'reading' && (audioDisconnected || (status === 'disconnected' && !!lastPageText))) {
      setScreen('reconnecting');
      return;
    }

    if (screen === 'reconnecting' && status === 'connected' && !audioDisconnected) {
      setScreen('reading');
    }

    if ((status === 'idle' || status === 'error') && !openedReadingOnce.current) {
      setScreen('pairing');
    }
  }, [audioDisconnected, lastPageText, screen, status]);

  const activeTitle = bookTitle?.trim() || DEFAULT_BOOK_TITLE;
  const activeAuthor = bookAuthor?.trim() || DEFAULT_BOOK_AUTHOR;
  const pageText = lastPageText?.trim() || 'Your latest passage will appear here as soon as the reader turns a page.';
  const voiceName = useMemo(() => formatVoiceName(settings.voice, voices), [settings.voice, voices]);
  const showMutedIndicator = muted || audioDisconnected || !isSpeaking;
  const isBusy = status === 'scanning' || status === 'connecting';

  const openReading = () => {
    openedReadingOnce.current = true;
    setScreen(audioDisconnected ? 'reconnecting' : 'reading');
  };

  const handleNarrationToggle = () => {
    setMuted((current) => !current);
  };

  const handleDisconnect = () => {
    setMuted(false);
    openedReadingOnce.current = false;
    setScreen('pairing');
    disconnect();
  };

  const renderHeader = (compact = false) => (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View>
        <Text style={styles.wordmark}>Margin</Text>
        <Text style={styles.headerCaption}>Quiet narration for the page you are on.</Text>
      </View>
      <Pressable style={styles.settingsButton} onPress={() => setSettingsVisible(true)}>
        <Text style={styles.settingsButtonText}>Settings</Text>
      </Pressable>
    </View>
  );

  const renderPairing = () => {
    const name = deviceName ?? 'Margin';

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        {renderHeader()}
        <View style={styles.heroBlock}>
          {isBusy ? (
            <>
              <PulseHalo />
              <Text style={styles.heroTitle}>Looking for your reader…</Text>
              <Text style={styles.heroSubtitle}>Stay close to your X4 Pro. Margin will take it from there.</Text>
            </>
          ) : status === 'connected' ? (
            <View style={styles.deviceCard}>
              <View style={styles.deviceCardRow}>
                <Text style={styles.deviceName}>{name}</Text>
                <View style={styles.connectedPill}>
                  <Text style={styles.connectedPillText}>Connected</Text>
                </View>
              </View>
              <Text style={styles.deviceMeta}>Ready to narrate the moment your next page arrives.</Text>
              <Pressable style={styles.primaryButton} onPress={openReading}>
                <Text style={styles.primaryButtonText}>Open Now Reading</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.deviceCard}>
              <Text style={styles.cardEyebrow}>Reader nearby</Text>
              <Text style={styles.deviceName}>{name}</Text>
              <Text style={styles.deviceMeta}>Connect once, then let Margin quietly keep pace with your reading.</Text>
              <Pressable style={styles.primaryButton} onPress={connect}>
                <Text style={styles.primaryButtonText}>Connect</Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  };

  const renderReading = () => (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {renderHeader(true)}
      <ScrollView contentContainerStyle={styles.readingContent} showsVerticalScrollIndicator={false}>
        <View style={styles.metaBlock}>
          <Text style={styles.eyebrow}>Currently reading</Text>
          <Text style={styles.bookTitle}>{activeTitle}</Text>
          <Text style={styles.bookAuthor}>
            {activeAuthor}
            {currentPage ? ` · Page ${currentPage}` : ''}
          </Text>
        </View>

        <View style={styles.pageCard}>
          <Text style={styles.pageText}>{pageText}</Text>
        </View>

        <View style={styles.centerControls}>
          <Pressable style={[styles.playButton, muted && styles.playButtonMuted]} onPress={handleNarrationToggle}>
            <Text style={[styles.playButtonIcon, muted && styles.playButtonMutedText]}>{muted ? '▷' : 'Ⅱ'}</Text>
            <Text style={[styles.playButtonLabel, muted && styles.playButtonMutedText]}>
              {muted ? 'Resume narration' : 'Mute narration'}
            </Text>
          </Pressable>

          <View style={styles.signalBlock}>
            {!showMutedIndicator ? (
              <WaveformBar color={COLORS.amber} />
            ) : (
              <Text style={styles.mutedText}>{audioDisconnected ? 'Output paused until audio reconnects' : 'Muted'}</Text>
            )}
          </View>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>{voiceName}</Text>
          <Text style={styles.footerText}>{settings.rate.toFixed(2)}×</Text>
        </View>

        <View style={styles.secondaryActions}>
          <Pressable style={styles.secondaryButton} onPress={replayLastPage}>
            <Text style={styles.secondaryButtonText}>Replay page</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={handleDisconnect}>
            <Text style={styles.secondaryButtonText}>Disconnect</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );

  const renderReconnecting = () => (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {renderHeader(true)}
      <View style={styles.reconnectingContent}>
        <View style={styles.metaBlock}>
          <Text style={styles.eyebrow}>Currently reading</Text>
          <Text style={styles.bookTitle}>{activeTitle}</Text>
          <Text style={styles.bookAuthor}>{activeAuthor}</Text>
        </View>

        <View style={styles.pageCard}>
          <Text style={styles.pageText}>{pageText}</Text>
        </View>

        <View style={styles.reconnectIndicator}>
          <CalmDot />
        </View>
        <Text style={styles.heroTitle}>Holding your place</Text>
        <Text style={styles.heroSubtitle}>
          {audioDisconnected ? 'AirPods Pro disconnected' : 'Reconnecting to your reader'}
        </Text>
      </View>
    </SafeAreaView>
  );

  return (
    <View style={styles.root}>
      {screen === 'reading' ? renderReading() : screen === 'reconnecting' ? renderReconnecting() : renderPairing()}

      <Modal animationType="slide" transparent visible={settingsVisible} onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Settings</Text>
              <Pressable onPress={() => setSettingsVisible(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.settingGroup}>
                <Text style={styles.settingLabel}>Voice</Text>
                <Text style={styles.settingHint}>System voices available on this device</Text>
                {voices.length ? (
                  voices.map((voice) => {
                    const selected = settings.voice === voice.identifier;
                    return (
                      <Pressable
                        key={voice.identifier}
                        style={[styles.voiceOption, selected && styles.voiceOptionSelected]}
                        onPress={() => setVoice(voice.identifier)}
                      >
                        <View>
                          <Text style={styles.voiceName}>{voice.name}</Text>
                          <Text style={styles.voiceLocale}>{voice.language}</Text>
                        </View>
                        {selected ? <Text style={styles.voiceSelected}>Selected</Text> : null}
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={styles.emptyText}>Voices will appear here when iOS shares them with the app.</Text>
                )}
              </View>

              <View style={styles.settingGroup}>
                <Text style={styles.settingLabel}>Narration speed</Text>
                <RateSlider value={settings.rate} onChange={setRate} />
              </View>

              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Auto-connect</Text>
                  <Text style={styles.settingHint}>Reconnect quietly when the reader is nearby</Text>
                </View>
                <Switch
                  value={settings.autoConnect}
                  onValueChange={setAutoConnect}
                  thumbColor={COLORS.text}
                  trackColor={{ false: COLORS.surfaceMuted, true: COLORS.sage }}
                />
              </View>

              <View style={styles.settingRow}>
                <View>
                  <Text style={styles.settingLabel}>Reader</Text>
                  <Text style={styles.settingHint}>{deviceName ?? 'Margin'}</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  headerCompact: {
    paddingBottom: 12,
  },
  wordmark: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  headerCaption: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 6,
  },
  settingsButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  settingsButtonText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  heroBlock: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  pulseShell: {
    width: 190,
    height: 190,
    borderRadius: 95,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  pulseRing: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1,
    borderColor: 'rgba(208,152,63,0.28)',
    backgroundColor: 'rgba(208,152,63,0.06)',
  },
  pulseCore: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(208,152,63,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(208,152,63,0.42)',
  },
  heroTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
  },
  heroSubtitle: {
    color: COLORS.textSoft,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 310,
  },
  deviceCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 24,
    gap: 14,
  },
  deviceCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardEyebrow: {
    color: COLORS.amber,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  deviceName: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '600',
    flexShrink: 1,
  },
  deviceMeta: {
    color: COLORS.textSoft,
    fontSize: 16,
    lineHeight: 24,
  },
  connectedPill: {
    borderRadius: 999,
    backgroundColor: 'rgba(143,163,126,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  connectedPillText: {
    color: COLORS.sage,
    fontSize: 13,
    fontWeight: '700',
  },
  primaryButton: {
    marginTop: 8,
    backgroundColor: COLORS.amber,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#2D2011',
    fontSize: 16,
    fontWeight: '700',
  },
  readingContent: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 22,
  },
  metaBlock: {
    gap: 8,
    marginTop: 12,
  },
  eyebrow: {
    color: COLORS.amber,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  bookTitle: {
    color: COLORS.text,
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.7,
  },
  bookAuthor: {
    color: COLORS.textSoft,
    fontSize: 16,
  },
  pageCard: {
    backgroundColor: COLORS.cardWarm,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(208,152,63,0.12)',
  },
  pageText: {
    color: COLORS.text,
    fontFamily: 'Georgia',
    fontSize: 24,
    lineHeight: 38,
  },
  centerControls: {
    alignItems: 'center',
    gap: 18,
  },
  playButton: {
    width: 196,
    height: 196,
    borderRadius: 98,
    backgroundColor: COLORS.amber,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  playButtonMuted: {
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  playButtonIcon: {
    color: '#2D2011',
    fontSize: 46,
    fontWeight: '700',
  },
  playButtonLabel: {
    color: '#2D2011',
    fontSize: 16,
    fontWeight: '700',
  },
  playButtonMutedText: {
    color: COLORS.text,
  },
  signalBlock: {
    minHeight: 36,
    justifyContent: 'center',
  },
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  reconnectingContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 48,
    justifyContent: 'center',
    gap: 24,
  },
  reconnectIndicator: {
    alignItems: 'center',
    marginTop: 4,
  },
  reconnectDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.sage,
    opacity: 0.9,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheet: {
    maxHeight: '88%',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 34,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
  },
  modalClose: {
    color: COLORS.amber,
    fontSize: 16,
    fontWeight: '700',
  },
  settingGroup: {
    marginBottom: 24,
    gap: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    gap: 16,
  },
  settingLabel: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '600',
  },
  settingHint: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  voiceOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 16,
  },
  voiceOptionSelected: {
    borderColor: 'rgba(208,152,63,0.5)',
    backgroundColor: 'rgba(208,152,63,0.12)',
  },
  voiceName: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '500',
  },
  voiceLocale: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  voiceSelected: {
    color: COLORS.amber,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  sliderTrack: {
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceMuted,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(208,152,63,0.35)',
  },
  sliderThumb: {
    position: 'absolute',
    top: 4,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.amber,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  sliderLabel: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
});
