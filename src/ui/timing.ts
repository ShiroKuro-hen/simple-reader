/** Trailing debounce; `flush()` runs the pending call now (used before leaving a book). */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const flush = () => {
    clearTimeout(timer);
    const args = pending;
    pending = undefined;
    if (args) fn(...args);
  };
  return Object.assign(
    (...a: A) => {
      pending = a;
      clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    { flush },
  );
}
