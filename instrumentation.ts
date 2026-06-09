export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { loadDictionaries } = await import('./server/dictionary');
    loadDictionaries();
  }
}
