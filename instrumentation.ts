export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb } = await import('./scripts/init-db');
    const { loadDictionaries } = await import('./server/dictionary');
    await initDb();
    loadDictionaries();
  }
}
