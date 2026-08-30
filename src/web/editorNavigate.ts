export async function navigateHomeAfterCheckpoint(
  checkpoint: () => Promise<void>,
  push: (path: string) => void,
): Promise<boolean> {
  try {
    await checkpoint();
    push('/');
    return true;
  } catch {
    return false;
  }
}
