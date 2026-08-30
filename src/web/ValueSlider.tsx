import { styles } from './editorStyles';

type ValueSliderProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
};

export function ValueSlider({ label, min, max, step, value, formatValue, onChange }: ValueSliderProps) {
  const display = formatValue ? formatValue(value) : String(Math.round(value));
  return (
    <div className={styles.sliderBlock}>
      <label className={styles.sliderLabel}>
        {label} {display}
      </label>
      <input
        className={styles.sliderInput}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
