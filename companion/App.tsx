import React, { useCallback, useRef, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { useMuseBle } from './src/useBle';

const STATUS_COLOR: Record<string, string> = {
  idle:         '#888',
  scanning:     '#f0a500',
  connecting:   '#f0a500',
  connected:    '#22c55e',
  disconnected: '#ef4444',
  error:        '#ef4444',
};

export default function App() {
  const [muted, setMuted]           = useState(false);
  const [lastText, setLastText]     = useState<string>('');
  const mutedRef                    = useRef(false);

  const speak = useCallback((text: string) => {
    if (mutedRef.current) return;
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: 0.95 });
    setLastText(text);
  }, []);

  const { status, deviceName, connect, disconnect } = useMuseBle(speak);

  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    if (next) Speech.stop();
  };

  const dot = STATUS_COLOR[status] ?? '#888';

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Margin</Text>
        <View style={[s.dot, { backgroundColor: dot }]} />
        <Text style={s.statusText}>{status}</Text>
        {deviceName ? <Text style={s.device}>{deviceName}</Text> : null}
      </View>

      {/* Page text preview */}
      <ScrollView style={s.textBox} contentContainerStyle={s.textContent}>
        <Text style={s.pageText}>{lastText || 'Waiting for page turn…'}</Text>
      </ScrollView>

      {/* Controls */}
      <View style={s.controls}>
        {status === 'idle' || status === 'disconnected' || status === 'error' ? (
          <TouchableOpacity style={s.btn} onPress={connect}>
            <Text style={s.btnLabel}>Connect to Reader</Text>
          </TouchableOpacity>
        ) : status === 'connected' ? (
          <>
            <TouchableOpacity style={[s.btn, muted && s.btnMuted]} onPress={toggleMute}>
              <Text style={s.btnLabel}>{muted ? '🔇 Muted' : '🔊 Speaking'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={disconnect}>
              <Text style={s.btnLabel}>Disconnect</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={s.statusText}>{status}…</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#111' },
  header:      { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  title:       { color: '#fff', fontSize: 22, fontWeight: '700', marginRight: 4 },
  dot:         { width: 10, height: 10, borderRadius: 5 },
  statusText:  { color: '#aaa', fontSize: 13 },
  device:      { color: '#aaa', fontSize: 13, marginLeft: 4 },
  textBox:     { flex: 1, margin: 16, backgroundColor: '#1e1e1e', borderRadius: 12 },
  textContent: { padding: 16 },
  pageText:    { color: '#e0e0e0', fontSize: 16, lineHeight: 26 },
  controls:    { padding: 16, gap: 10 },
  btn:         { backgroundColor: '#2563eb', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnMuted:    { backgroundColor: '#374151' },
  btnSecondary:{ backgroundColor: '#374151' },
  btnLabel:    { color: '#fff', fontSize: 16, fontWeight: '600' },
});
