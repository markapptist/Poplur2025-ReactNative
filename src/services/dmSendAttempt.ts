/** A new thread has no participant roster yet, so Firestore correctly denies
 * reading its nonexistent message. Creation is still authorized atomically
 * by the thread + message batch. Other read failures must not become writes. */
export async function commitDMIfNew(
  messageExists: () => Promise<boolean>,
  commit: () => Promise<unknown>,
): Promise<void> {
  try {
    if (await messageExists()) return;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code !== 'permission-denied' && code !== 'firestore/permission-denied') throw error;
  }
  await commit();
}
