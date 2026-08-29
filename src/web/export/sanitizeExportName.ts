export function formatExportTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}`;
}

export function sanitizeExportStem(name: string): string {
  let stem = name.trim();
  if (stem.length === 0) {
    stem = '無題';
  }
  stem = replaceForbiddenCodePoints(stem);
  if (stem.startsWith('.')) {
    stem = `_${stem.slice(1)}`;
  }
  stem = stripTrailingDotOrSpace(stem);
  if (stem.length === 0) {
    stem = '無題';
  }
  stem = truncateUtf16(stem, 80);
  stem = stripTrailingDotOrSpace(stem);
  if (stem.length === 0) {
    stem = '無題';
  }
  return stem;
}

export function buildExportZipNames(stem: string, timestamp: string): {
  zipFileName: string;
  folderName: string;
} {
  const folderName = `${stem}_${timestamp}`;
  return {
    folderName,
    zipFileName: `${folderName}.zip`,
  };
}

function replaceForbiddenCodePoints(input: string): string {
  let out = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0) ?? 0;
    out += isForbiddenCodePoint(codePoint) ? '_' : char;
  }
  return out;
}

function isForbiddenCodePoint(codePoint: number): boolean {
  if (codePoint <= 0x1f || codePoint === 0x7f) {
    return true;
  }
  if (codePoint >= 0x80 && codePoint <= 0x9f) {
    return true;
  }
  switch (codePoint) {
    case 0x22:
    case 0x2a:
    case 0x2f:
    case 0x3a:
    case 0x3c:
    case 0x3e:
    case 0x3f:
    case 0x5c:
    case 0x7c:
      return true;
    default:
      return false;
  }
}

function stripTrailingDotOrSpace(input: string): string {
  return input.replace(/[ .]+$/u, '');
}

function truncateUtf16(input: string, maxUnits: number): string {
  if (input.length <= maxUnits) {
    return input;
  }
  let cut = input.slice(0, maxUnits);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    cut = cut.slice(0, -1);
  }
  return cut;
}
