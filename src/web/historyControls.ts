export function historyControlsDisabled(textEditing: boolean, stackLength: number): boolean {
  return textEditing || stackLength === 0;
}
