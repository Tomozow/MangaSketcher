import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, layout, touchTarget } from '../theme/tokens';

type SplitHandleProps = {
  accessibilityLabel: string;
  onDrag: (deltaPx: number) => void;
};

export function SplitHandle({ accessibilityLabel, onDrag }: SplitHandleProps) {
  const last = useRef(0);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      style={styles.handle}
      onStartShouldSetResponder={() => true}
      onResponderGrant={(evt) => {
        last.current = evt.nativeEvent.pageY;
      }}
      onResponderMove={(evt) => {
        const y = evt.nativeEvent.pageY;
        onDrag(y - last.current);
        last.current = y;
      }}
    >
      <View style={styles.bar} />
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    minHeight: Math.max(layout.splitHandle, touchTarget * 0.5),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  bar: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
});
