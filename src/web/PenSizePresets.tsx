'use client';

import {
  PEN_OPACITY_MAX,
  PEN_OPACITY_MIN,
  PEN_SIZE_MIN,
  parsePenSizePresetIndex,
  type PenSizePresets as PenSizePresetValues,
} from '@/src/storage/appSettings';
import { ValueSlider } from './ValueSlider';
import { styles } from './editorStyles';

type PenSizePresetRowProps = {
  groupLabel: string;
  sizePresets: PenSizePresetValues;
  opacityPresets: PenSizePresetValues;
  storedIndex: number;
  sizeMin?: number;
  sizeMax: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  onSelect: (index: number) => void;
  onChangeSize: (index: number, value: number) => void;
  onChangeOpacity: (index: number, value: number) => void;
  onChangePressure: (next: { size: boolean; opacity: boolean }) => void;
};

function presetDotPx(size: number, sizeMax: number): number {
  const t = (size - PEN_SIZE_MIN) / (sizeMax - PEN_SIZE_MIN);
  return Math.round(8 + Math.max(0, Math.min(1, t)) * 16);
}

export function PenSizePresetRow({
  groupLabel,
  sizePresets,
  opacityPresets,
  storedIndex,
  sizeMin = PEN_SIZE_MIN,
  sizeMax,
  pressureSize,
  pressureOpacity,
  onSelect,
  onChangeSize,
  onChangeOpacity,
  onChangePressure,
}: PenSizePresetRowProps) {
  const activeIndex = parsePenSizePresetIndex(storedIndex);
  const activeSize = sizePresets[activeIndex]!;
  const activeOpacity = opacityPresets[activeIndex]!;

  return (
    <div className={styles.penPresetBlock}>
      <div className={styles.penPresetLabel}>プリセット</div>
      <div className={styles.penPresetRow} role="group" aria-label={`${groupLabel}プリセット`}>
        {sizePresets.map((size, index) => {
          const on = index === activeIndex;
          const opacity = opacityPresets[index]!;
          const dot = presetDotPx(size, sizeMax);
          return (
            <button
              key={index}
              type="button"
              className={`${styles.penPresetButton} ${on ? styles.penPresetButtonOn : ''}`}
              aria-label={`プリセット ${index + 1} サイズ ${size} 不透明度 ${Math.round(opacity * 100)}%`}
              aria-pressed={on}
              onClick={() => onSelect(index)}
            >
              <span className={styles.penPresetDot} style={{ width: dot, height: dot, opacity }} />
              <span className={styles.penPresetValue}>{size}</span>
            </button>
          );
        })}
      </div>
      <ValueSlider
        label="サイズ"
        min={sizeMin}
        max={sizeMax}
        step={1}
        value={activeSize}
        onChange={(value) => onChangeSize(activeIndex, value)}
      />
      <ValueSlider
        label="不透明度"
        min={PEN_OPACITY_MIN}
        max={PEN_OPACITY_MAX}
        step={0.05}
        value={activeOpacity}
        formatValue={(value) => `${Math.round(value * 100)}%`}
        onChange={(value) => onChangeOpacity(activeIndex, value)}
      />
      <div className={styles.penPresetLabel}>筆圧</div>
      <div className={styles.selectFilterRow} role="group" aria-label="筆圧の影響">
        <button
          type="button"
          className={`${styles.selectFilterButton} ${pressureSize ? styles.toolButtonActive : ''}`}
          aria-pressed={pressureSize}
          onClick={() => onChangePressure({ size: !pressureSize, opacity: pressureOpacity })}
        >
          太さ
        </button>
        <button
          type="button"
          className={`${styles.selectFilterButton} ${pressureOpacity ? styles.toolButtonActive : ''}`}
          aria-pressed={pressureOpacity}
          onClick={() => onChangePressure({ size: pressureSize, opacity: !pressureOpacity })}
        >
          不透明度
        </button>
      </div>
    </div>
  );
}
