export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { loadDictionaries } = await import('./server/dictionary');
    loadDictionaries();
    if (process.env.DATABASE_URL) {
      const { initDb } = await import('./scripts/init-db');
      await initDb();
    } else {
      console.warn('[instrumentation] DATABASE_URL not set — account/history features disabled. See README "环境变量" section.');
    }
  }
}
