/**
 * Wraps a task so it never runs twice at once. A call that arrives while it is busy is not dropped: the task runs
 * again once it finishes, which covers whatever was waiting by then.
 */
export function oneAtATime(task: () => Promise<void>): () => Promise<void> {
  let busy = false;
  let again = false;
  return async function run() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await task();
      } while (again);
    } finally {
      busy = false;
    }
  };
}
