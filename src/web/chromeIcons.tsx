import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function StrokeIcon({ title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </StrokeIcon>
  );
}

export function IconLayout(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="4" y="5" width="7" height="14" rx="1" />
      <rect x="13" y="5" width="7" height="14" rx="1" />
    </StrokeIcon>
  );
}

export function IconStock(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="4" y="5" width="7" height="7" rx="1" />
      <rect x="13" y="5" width="7" height="7" rx="1" />
      <rect x="4" y="14" width="7" height="5" rx="1" />
      <rect x="13" y="14" width="7" height="5" rx="1" />
    </StrokeIcon>
  );
}

export function IconPdf(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </StrokeIcon>
  );
}

export function IconExport(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M12 4v10" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 16v3h14v-3" />
    </StrokeIcon>
  );
}

export function IconSun(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4" />
    </StrokeIcon>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M16 4.5A8 8 0 1 0 19.5 16 6.5 6.5 0 0 1 16 4.5z" />
    </StrokeIcon>
  );
}

export function IconPen(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M14 5l5 5-10 10H4v-5z" />
      <path d="M12 7l5 5" />
    </StrokeIcon>
  );
}

export function IconEraser(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M5 15l7-7 7 7-4 4H9z" />
      <path d="M8 18h8" />
    </StrokeIcon>
  );
}

export function IconText(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M6 6h12" />
      <path d="M12 6v14" />
    </StrokeIcon>
  );
}

export function IconSelect(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <rect x="5" y="5" width="14" height="14" rx="1" strokeDasharray="3 2" />
    </StrokeIcon>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M9 8H5V4" />
      <path d="M5 8a8 8 0 1 1-1 5" />
    </StrokeIcon>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <StrokeIcon {...props}>
      <path d="M15 8h4V4" />
      <path d="M19 8a8 8 0 1 0 1 5" />
    </StrokeIcon>
  );
}
