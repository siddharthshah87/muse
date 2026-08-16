import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const BAR_COUNT = 5;

export function WaveformBar({ color }: { color: string }) {
  const animations = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.25))).current;

  useEffect(() => {
    const loops = animations.map((animation, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(animation, {
            toValue: 1,
            duration: 520,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(animation, {
            toValue: 0.25,
            duration: 520,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    loops.forEach((loop) => loop.start());

    return () => {
      loops.forEach((loop) => loop.stop());
    };
  }, [animations]);

  const bars = useMemo(
    () =>
      animations.map((animation, index) => {
        const scaleY = animation.interpolate({
          inputRange: [0.25, 1],
          outputRange: [0.45, 1.35],
        });

        return (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                backgroundColor: color,
                opacity: animation,
                transform: [{ scaleY }],
              },
            ]}
          />
        );
      }),
    [animations, color],
  );

  return <View style={styles.row}>{bars}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 26,
  },
  bar: {
    width: 6,
    height: 20,
    borderRadius: 999,
  },
});
