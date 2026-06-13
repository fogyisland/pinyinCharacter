// No-op shim for `server-only` in unit tests.
// The real `server-only` package throws when imported from a Client Component;
// vitest runs in plain Node so we replace it with a harmless empty module.
export {};
