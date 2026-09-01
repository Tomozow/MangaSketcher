import type { PageId } from '../../domain/types';
import type { PageScopeMode } from './exportFormat';

export type SelectExportPagesInput = {
  workspaceOrder: readonly PageId[];
  selectedPageId: PageId | null;
  mode: PageScopeMode;
  rangeStartRaw: string;
  rangeEndRaw: string;
};

export type ExportPageSelection = {
  pageIds: PageId[];
  firstNumber: number;
  lastNumber: number;
  count: number;
  canExport: boolean;
  currentDisabled: boolean;
};

export function currentWorkspaceNumber(
  workspaceOrder: readonly PageId[],
  selectedPageId: PageId | null,
): number | null {
  if (selectedPageId == null) {
    return null;
  }
  const index = workspaceOrder.indexOf(selectedPageId);
  return index < 0 ? null : index + 1;
}

export function sanitizeRangeInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const match = trimmed.match(/^-?\d+/);
  if (!match) {
    return '';
  }
  return String(Math.trunc(Number.parseInt(match[0], 10)));
}

export function parseRangeField(
  raw: string,
  fallbackNumber: number,
): number {
  const sanitized = sanitizeRangeInput(raw);
  if (sanitized.length === 0) {
    return fallbackNumber;
  }
  return Number.parseInt(sanitized, 10);
}

export function selectExportPages(input: SelectExportPagesInput): ExportPageSelection {
  const order = input.workspaceOrder;
  const currentNumber = currentWorkspaceNumber(order, input.selectedPageId);
  const currentDisabled = currentNumber == null;
  const fallback = currentNumber ?? 1;

  if (order.length === 0) {
    return {
      pageIds: [],
      firstNumber: 1,
      lastNumber: 1,
      count: 0,
      canExport: false,
      currentDisabled: true,
    };
  }

  if (input.mode === 'current') {
    if (currentDisabled || input.selectedPageId == null) {
      return {
        pageIds: [],
        firstNumber: 1,
        lastNumber: 1,
        count: 0,
        canExport: false,
        currentDisabled: true,
      };
    }
    return {
      pageIds: [input.selectedPageId],
      firstNumber: currentNumber,
      lastNumber: currentNumber,
      count: 1,
      canExport: true,
      currentDisabled: false,
    };
  }

  if (input.mode === 'all') {
    return {
      pageIds: [...order],
      firstNumber: 1,
      lastNumber: order.length,
      count: order.length,
      canExport: order.length > 0,
      currentDisabled,
    };
  }

  let start = parseRangeField(input.rangeStartRaw, fallback);
  let end = parseRangeField(input.rangeEndRaw, fallback);
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  start = clampInt(start, 1, order.length);
  end = clampInt(end, 1, order.length);
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  const pageIds = order.slice(start - 1, end);
  return {
    pageIds,
    firstNumber: start,
    lastNumber: end,
    count: pageIds.length,
    canExport: pageIds.length > 0,
    currentDisabled,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
