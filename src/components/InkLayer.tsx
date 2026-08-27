import { StyleSheet, View } from 'react-native';

import { inkCells } from '../domain/raster';
import type { Raster } from '../domain/types';

type InkLayerProps = {
  raster: Raster;
  width: number;
  height: number;
};

export function InkLayer({ raster, width, height }: InkLayerProps) {
  const cellW = width / raster.width;
  const cellH = height / raster.height;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {inkCells(raster).map((cell) => (
        <View
          key={`${cell.x}-${cell.y}`}
          style={{
            position: 'absolute',
            left: cell.x * cellW,
            top: cell.y * cellH,
            width: Math.max(1.2, cellW),
            height: Math.max(1.2, cellH),
            backgroundColor: cell.color,
            borderRadius: Math.min(cellW, cellH) * 0.45,
          }}
        />
      ))}
    </View>
  );
}
