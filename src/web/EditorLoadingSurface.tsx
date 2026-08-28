import { colors } from '@/src/theme/tokens';

export function EditorLoadingSurface() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: colors.background,
        color: colors.textMuted,
        overscrollBehavior: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      aria-busy="true"
      aria-live="polite"
    >
      読み込み中…
    </div>
  );
}
