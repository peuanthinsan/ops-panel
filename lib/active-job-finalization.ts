export async function finalizeDurableActiveJob(
  remove: () => Promise<void>,
  writeClosedMarker: () => Promise<void>,
) {
  try {
    await remove();
    return true;
  } catch {
    try {
      await writeClosedMarker();
      return true;
    } catch {
      return false;
    }
  }
}
