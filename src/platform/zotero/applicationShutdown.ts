/** Registers asynchronous work that Zotero awaits during application exit. */
export function registerApplicationShutdownTask(
  task: () => Promise<void>,
): () => void {
  let activeTask: (() => Promise<void>) | undefined = task;
  Zotero.addShutdownListener(async () => {
    try {
      await activeTask?.();
    } catch (error) {
      // A plugin save failure must not reject Zotero's shutdown Promise.all
      // and prevent the database from being closed.
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  });
  // Zotero has no removeShutdownListener API. Release the task reference on
  // plugin disable/update so the retained callback cannot save a stale cache.
  return () => {
    activeTask = undefined;
  };
}
