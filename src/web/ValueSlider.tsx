import styles from './editor.module.css';

type ValueSliderProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

export function ValueSlider({ label, min, max, step, value, onChange }: ValueSliderProps) {
  return (
    <div className={styles.sliderBlock}>
      <label className={styles.sliderLabel}>
        {label} {Math.round(value)}
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
