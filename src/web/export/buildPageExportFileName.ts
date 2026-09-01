import { padPageIndex } from './constants';
import type { PageScopeMode } from './exportFormat';

export type PageExportFormat = 'png' | 'pdf' | 'clip';

export function buildPageExportFileName(input: {
  format: PageExportFormat;
  stem: string;
  timestamp: string;
  pick: PageScopeMode;
  count: number;
  firstNumber: number;
  lastNumber: number;
}): string {
  const base = `${input.stem}_${input.timestamp}`;
  const rangeToken = `p${padPageIndex(input.firstNumber)}-p${padPageIndex(input.lastNumber)}`;
  const single = `p${padPageIndex(input.firstNumber)}`;

  if (input.count <= 1) {
    if (input.format === 'png') {
      return `${base}_${single}.png`;
    }
    if (input.format === 'pdf') {
      return `${base}_${single}.pdf`;
    }
    return `${base}_${single}.clip`;
  }

  if (input.pick === 'range') {
    if (input.format === 'png') {
      return `${base}_${rangeToken}.zip`;
    }
    if (input.format === 'pdf') {
      return `${base}_${rangeToken}.pdf`;
    }
    return `${base}_${rangeToken}_clip.zip`;
  }

  if (input.format === 'png') {
    return `${base}.zip`;
  }
  if (input.format === 'pdf') {
    return `${base}.pdf`;
  }
  return `${base}_clip.zip`;
}

export function folderNameFromExportFileName(fileName: string): string {
  return fileName.replace(/\.(zip|png|pdf|clip)$/i, '');
}
