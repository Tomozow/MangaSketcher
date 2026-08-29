import { strToU8, zipSync, type Zippable } from 'fflate';
import { padPageIndex } from './constants';

export function buildWorkspaceZip(input: {
  folderName: string;
  pages: readonly { index: number; png: Uint8Array }[];
  text: string;
}): Uint8Array {
  const files: Zippable = {};
  for (const page of input.pages) {
    files[`${input.folderName}/${padPageIndex(page.index)}.png`] = [page.png, { level: 0 }];
  }
  files[`${input.folderName}/text.txt`] = strToU8(input.text, false);
  return zipSync(files);
}
