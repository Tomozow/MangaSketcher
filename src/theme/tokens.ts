export const colors = {
  background: '#F4F1EA',
  surface: '#FFFFFF',
  surfaceMuted: '#E8E2D6',
  border: '#C9C0B0',
  text: '#2B2620',
  textMuted: '#6F675C',
  accent: '#3D5A80',
} as const;

/** iPad 向けの最低タッチサイズ（Apple HIG: 44pt） */
export const touchTarget = 44;

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const layout = {
  sidebarMinWidth: 280,
  sidebarMaxWidth: 360,
  sidebarCompactWidth: 112,
  splitHandle: 16,
} as const;
