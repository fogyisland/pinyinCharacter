export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/env');
    validateEnv();  // soft warnings only — never throws
    const { loadDictionaries } = await import('./server/dictionary');
    loadDictionaries();
    if (process.env.DATABASE_URL) {
      // Only run initDb if setup has been completed via /init wizard.
      // On a fresh deploy, the user is redirected to /init by middleware and
      // initDb is invoked from /api/init/run-seed instead.
      const { isSetupComplete } = await import('./lib/setup');
      const completed = await isSetupComplete();
      if (completed) {
        const { initDb } = await import('./scripts/init-db');
        await initDb();
        const { bootstrapScheduler } = await import('./lib/scheduler');
        await bootstrapScheduler();
      } else {
        console.warn('[instrumentation] Setup incomplete — visit /init to configure. Scheduler disabled.');
      }
    } else {
      console.warn('[instrumentation] DATABASE_URL not set — visit /init to configure.');
    }
  }
}
