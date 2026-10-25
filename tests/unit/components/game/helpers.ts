/**
 * 2026-07-04: happy-dom localStorage shim — useDifficulty reads from
 * localStorage in a useEffect. One copy for the whole game test tree: the
 * shim was duplicated verbatim in two describe blocks and drifted, and the
 * copy was then duplicated across test files as well.
 *
 * The `store` map stays INSIDE this helper on purpose: every call installs a
 * fresh map, so each test starts with an empty localStorage.
 *
 * `window` is touched only inside the function — never at import time — so a
 * test file that runs in the default `node` environment can import this
 * module safely.
 */
export function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
