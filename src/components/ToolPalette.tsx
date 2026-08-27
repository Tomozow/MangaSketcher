import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ValueSlider } from './ValueSlider';
import type { ToolId, ToolProperties } from '../domain/types';
import { colors, spacing, touchTarget } from '../theme/tokens';

const TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: 'pen', label: 'ペン', icon: '筆' },
  { id: 'eraser', label: '消しゴム', icon: '消' },
  { id: 'text', label: 'テキスト', icon: '文' },
  { id: 'select', label: '選択', icon: '選' },
];

const COLORS = ['#1A1A1A', '#C45C26', '#3D5A80', '#2A9D8F', '#E9C46A'];

type ToolPaletteProps = {
  tool: ToolId;
  tools: ToolProperties;
  selectedText: { id: string; color: string; fontSize: number; content: string } | null;
  canUndo: boolean;
  canRedo: boolean;
  compact: boolean;
  onToggleCompact: () => void;
  onTool: (tool: ToolId) => void;
  onPatch: (patch: Partial<ToolProperties>) => void;
  onSelectedTextColor: (color: string) => void;
  onSelectedTextFontSize: (fontSize: number) => void;
  onSelectedTextContent: (content: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
};

export function ToolPalette({
  tool,
  tools,
  selectedText,
  canUndo,
  canRedo,
  compact,
  onToggleCompact,
  onTool,
  onPatch,
  onSelectedTextColor,
  onSelectedTextFontSize,
  onSelectedTextContent,
  onUndo,
  onRedo,
  onBack,
}: ToolPaletteProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const color = selectedText?.color ?? (tool === 'text' ? tools.textColor : tools.penColor);
  const size = tool === 'eraser' ? tools.eraserSize : tools.penSize;
  const opacity = tool === 'eraser' ? tools.eraserOpacity : tools.penOpacity;
  const fontSize = selectedText?.fontSize ?? tools.textFontSize;
  const showOpacity = tool !== 'text' && !selectedText;

  function applyColor(hex: string) {
    if (selectedText) {
      onSelectedTextColor(hex);
      onPatch({ textColor: hex });
      return;
    }
    onPatch(tool === 'text' ? { textColor: hex } : { penColor: hex });
  }

  if (compact) {
    return (
      <View style={styles.compactPanel}>
        <View style={styles.compactHeader}>
          <Pressable onPress={onBack} hitSlop={8} style={styles.iconBtn} accessibilityLabel="一覧">
            <Text style={styles.iconBtnText}>覧</Text>
          </Pressable>
          <Pressable onPress={onToggleCompact} hitSlop={8} style={styles.iconBtn} accessibilityLabel="サイドバーを展開">
            <Text style={styles.iconBtnText}>展</Text>
          </Pressable>
        </View>
        <View style={styles.iconTools}>
          {TOOLS.map((item) => (
            <Pressable
              key={item.id}
              accessibilityLabel={item.label}
              onPress={() => onTool(item.id)}
              style={[styles.iconTool, tool === item.id && styles.iconToolOn]}
            >
              <Text style={[styles.iconToolText, tool === item.id && styles.iconToolTextOn]}>{item.icon}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityLabel="現在の色"
          onPress={() => setColorOpen((open) => !open)}
          style={[styles.colorChip, { backgroundColor: color }]}
        />
        {colorOpen
          ? COLORS.map((hex) => (
              <Pressable
                key={hex}
                onPress={() => {
                  applyColor(hex);
                  setColorOpen(false);
                }}
                style={[styles.miniSwatch, { backgroundColor: hex }, color === hex && styles.swatchOn]}
              />
            ))
          : null}
        <Text style={styles.compactLabel}>サイズ</Text>
        <ValueSlider
          accessibilityLabel="サイズ"
          value={selectedText || tool === 'text' ? fontSize : size}
          min={selectedText || tool === 'text' ? 8 : 1}
          max={selectedText || tool === 'text' ? 48 : 16}
          onChange={(v) => {
            if (selectedText || tool === 'text') {
              const next = Math.round(v);
              onPatch({ textFontSize: next });
              if (selectedText) {
                onSelectedTextFontSize(next);
              }
              return;
            }
            onPatch(tool === 'eraser' ? { eraserSize: v } : { penSize: v });
          }}
        />
        {showOpacity ? (
          <>
            <Text style={styles.compactLabel}>不透明度</Text>
            <ValueSlider
              accessibilityLabel="不透明度"
              value={opacity}
              min={0.1}
              max={1}
              onChange={(v) =>
                onPatch(tool === 'eraser' ? { eraserOpacity: v } : { penOpacity: v })
              }
            />
          </>
        ) : null}
        {selectedText ? (
          <TextInput
            accessibilityLabel="テキスト本文"
            value={selectedText.content}
            onChangeText={onSelectedTextContent}
            placeholder="本文"
            placeholderTextColor={colors.textMuted}
            style={styles.compactInput}
          />
        ) : null}
        <View style={styles.compactHistory}>
          <Pressable
            disabled={!canUndo}
            onPress={onUndo}
            accessibilityLabel="元に戻す"
            style={[styles.iconBtn, !canUndo && styles.disabled]}
          >
            <Text style={styles.iconBtnText}>戻</Text>
          </Pressable>
          <Pressable
            disabled={!canRedo}
            onPress={onRedo}
            accessibilityLabel="やり直す"
            style={[styles.iconBtn, !canRedo && styles.disabled]}
          >
            <Text style={styles.iconBtnText}>進</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} hitSlop={8} style={styles.back}>
          <Text style={styles.backText}>一覧</Text>
        </Pressable>
        <Text style={styles.title}>ツールパレット & プロパティ</Text>
        <Pressable onPress={onToggleCompact} style={styles.back} accessibilityLabel="サイドバーを縮小">
          <Text style={styles.backText}>縮小</Text>
        </Pressable>
      </View>
      <View style={styles.tools}>
        {TOOLS.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onTool(item.id)}
            style={[styles.toolBtn, tool === item.id && styles.toolBtnOn]}
          >
            <Text style={[styles.toolLabel, tool === item.id && styles.toolLabelOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {tool === 'pen' && 'Pencil で描画。指はパン／ピンチ。サイズは筆圧×プロパティ。下書きとインクは色で区別します。'}
        {tool === 'eraser' && '画素だけ消します。テキストは消えません。選択中クリップがあればそちらを消します。'}
        {tool === 'text' && '縦書き。空の枠も置けます。選択した枠の本文を入力・編集できます。Pencil で移動、右下ハンドルでリサイズ。回転なし。'}
        {tool === 'select' && 'Pencil で矩形選択。指はパンのままです。テキストは掴みません。'}
      </Text>
      <View style={styles.swatches}>
        {COLORS.map((hex) => (
          <Pressable
            key={hex}
            onPress={() => applyColor(hex)}
            style={[styles.swatch, { backgroundColor: hex }, color === hex && styles.swatchOn]}
          />
        ))}
      </View>
      <View style={styles.sliders}>
        <Stepper
          label="サイズ"
          value={size}
          onChange={(v) =>
            onPatch(tool === 'eraser' ? { eraserSize: v } : { penSize: v })
          }
        />
        {showOpacity ? (
          <Stepper
            label="不透明度"
            value={opacity}
            step={0.1}
            min={0.1}
            max={1}
            onChange={(v) =>
              onPatch(tool === 'eraser' ? { eraserOpacity: v } : { penOpacity: v })
            }
          />
        ) : (
          <Stepper
            label="文字サイズ"
            value={fontSize}
            min={8}
            max={48}
            onChange={(v) => {
              onPatch({ textFontSize: v });
              if (selectedText) {
                onSelectedTextFontSize(v);
              }
            }}
          />
        )}
      </View>
      {selectedText ? (
        <TextInput
          accessibilityLabel="テキスト本文"
          value={selectedText.content}
          onChangeText={onSelectedTextContent}
          placeholder="本文を入力（空でも可）"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          style={styles.bodyInput}
        />
      ) : null}
      <View style={styles.history}>
        <Pressable disabled={!canUndo} onPress={onUndo} style={[styles.histBtn, !canUndo && styles.disabled]}>
          <Text style={styles.histText}>元に戻す</Text>
        </Pressable>
        <Pressable disabled={!canRedo} onPress={onRedo} style={[styles.histBtn, !canRedo && styles.disabled]}>
          <Text style={styles.histText}>やり直す</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 1,
  max = 16,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepLabel}>
        {label} {Number.isInteger(value) ? value : value.toFixed(1)}
      </Text>
      <Pressable
        style={styles.stepBtn}
        onPress={() => onChange(Math.max(min, round(value - step, step)))}
      >
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Pressable
        style={styles.stepBtn}
        onPress={() => onChange(Math.min(max, round(value + step, step)))}
      >
        <Text style={styles.stepBtnText}>＋</Text>
      </Pressable>
    </View>
  );
}

function round(n: number, step: number): number {
  const p = step < 1 ? 10 : 1;
  return Math.round(n * p) / p;
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 160,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactPanel: {
    flex: 1,
    padding: spacing.xs,
    gap: 4,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconBtn: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  iconBtnText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  iconTools: {
    gap: 4,
  },
  iconTool: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  iconToolOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  iconToolText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 18,
  },
  iconToolTextOn: {
    color: '#fff',
  },
  colorChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: colors.accent,
  },
  miniSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  compactLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  compactInput: {
    minHeight: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 4,
    color: colors.text,
    fontSize: 12,
  },
  compactHistory: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  back: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  backText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  tools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  toolBtn: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  toolBtnOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toolLabel: {
    color: colors.text,
    fontWeight: '600',
  },
  toolLabelOn: {
    color: '#fff',
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  swatches: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchOn: {
    borderColor: colors.accent,
  },
  sliders: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepLabel: {
    minWidth: 110,
    color: colors.text,
  },
  stepBtn: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  stepBtnText: {
    fontSize: 20,
    color: colors.text,
  },
  history: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  bodyInput: {
    minHeight: 88,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
  },
  histBtn: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  histText: {
    color: colors.text,
    fontWeight: '600',
  },
});
