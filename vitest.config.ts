import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // The `server-only` marker package throws when it is imported outside
      // a React Server Component. The tests run in plain Node, so the marker
      // is neutralised here — the same thing the `react-server` export
      // condition does in the app, and the same thing the MCP server does
      // with its `--conditions=react-server` flag.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  // Vitest 4 transforms with oxc rather than esbuild; the `esbuild.jsx`
  // option is ignored there (vitest logs "oxc options will be used and
  // esbuild options will be ignored"). The oxc equivalent is `jsx.runtime`,
  // set under `oxc`. Leaving the esbuild block in place would make every
  // run print that warning and rely on the default JSX handling.
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    environment: 'node',
    // happy-dom 15 (the version this project ran on until the security
    // upgrade) loaded external stylesheets by default. happy-dom 21 turned
    // that OFF: `enableCSSFileLoading` now has to be opted into explicitly
    // and `disableCSSFileLoading` is deprecated.
    //
    // The font-hydration regression test depends on the old behaviour: it
    // asserts that the promotion script's FAST path fires, which only
    // happens when happy-dom has actually loaded the stylesheet and set
    // `link.sheet`. With CSS loading off, `el.sheet` stays null, the fast
    // path never runs, and the test fails on an assertion about the DOM
    // rather than about the code under test.
    //
    // The stylesheet the test uses is a `data:` URL, so enabling the loader
    // costs no network traffic.
    environmentOptions: {
      happyDOM: {
        settings: {
          enableCSSFileLoading: true,
        },
      },
    },
    // Up/ is a gitignored snapshot of the repo used by the deploy bundle;
    // its tests reference the pre-TTS SutraAudioPlayer API and pollute
    // every vitest run with 17 stale failures. Excluded so the Up/ snapshot
    // stays intact for `git bundle` consumers.
    //
    // .tmp/ holds scratch work (mutation-test copies, comparison
    // screenshots). Its copies of the test files import paths that only
    // make sense inside the scratch area, so collecting them fails.
    //
    // .worktrees/ holds git worktrees — full copies of this repo, each with
    // its own node_modules. Collecting them runs every test twice (and the
    // vendored packages' own tests, which fail), so the worktree copies are
    // excluded: each worktree runs its own suite from its own directory.
    exclude: ['node_modules/**', 'Up/**', 'dist/**', '.tmp/**', '.worktrees/**'],
  },
});
