import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, touchTarget } from '../theme/tokens';

type ValueSliderProps = {
  value: number;
  min: number;
  max: number;
  accessibilityLabel: string;
  onChange: (value: number) => void;
};

export function ValueSlider({ value, min, max, accessibilityLabel, onChange }: ValueSliderProps) {
  const width = useRef(120);
  const span = Math.max(0.0001, max - min);
  const t = Math.min(1, Math.max(0, (value - min) / span));

  function atX(x: number) {
    const pct = Math.min(1, Math.max(0, x / Math.max(1, width.current)));
    onChange(min + pct * span);
  }

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      style={styles.hit}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => atX(e.nativeEvent.locationX)}
      onResponderMove={(e) => atX(e.nativeEvent.locationX)}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${t * 100}%` }]} />
        <View style={[styles.thumb, { left: `${t * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    top: -6,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.accent,
  },
});
