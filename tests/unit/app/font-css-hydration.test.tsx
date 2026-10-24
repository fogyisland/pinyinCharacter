// @vitest-environment happy-dom
/**
 * Regression test for the hydration mismatch the async font stylesheets caused.
 *
 * app/layout.tsx loads two of the three font stylesheets with `media="print"`
 * so they never block the first paint, and an inline script promotes them to
 * `media="all"` once they arrive. The promotion rewrites an attribute of a
 * React-rendered element BEFORE React hydrates, so React used to report on
 * every single page:
 *
 *   A tree hydrated but some attributes of the server rendered HTML didn't
 *   match the client properties. This won't be patched up.
 *
 *   -  media="all"      (the server-rendered HTML, promoted by the script)
 *   +  media="print"    (what React's tree says)
 *
 * React only warns about attribute differences — it never patches them back —
 * so the fonts kept working and the page kept rendering. The console error
 * was pure noise, but it also hides real errors, so it has to go.
 *
 * The fix is `suppressHydrationWarning` on the two async links. This test
 * reproduces the whole sequence and asserts two things:
 *
 *   1. with the flag, React stays silent;
 *   2. without it, React DOES complain — otherwise the test would still pass
 *      if the promotion script silently stopped running.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ASYNC_STYLESHEET_FLIP } from '@/lib/font-css-flip';

const ROOT = resolve(__dirname, '..', '..', '..');

/**
 * A stylesheet that happy-dom can load without touching the network.
 *
 * The href is irrelevant to the hydration logic — only the `media` attribute
 * matters — but a real URL would make happy-dom fire a network request for
 * every test and bury the output in ECONNREFUSED noise.
 */
const STYLESHEET_HREF = 'data:text/css,body{font-family:sans-serif}';

/** The two stylesheets the layout loads off the critical path. */
const ASYNC_LINKS = [
  { href: STYLESHEET_HREF, key: 'wenkai' },
  { href: STYLESHEET_HREF, key: 'serif' },
];

// React's `act` refuses to run unless the environment opts in.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Wait for happy-dom's pending resource loads to settle. */
async function settle(): Promise<void> {
  const happyDom = (
    window as unknown as { happyDOM: { waitUntilComplete(): Promise<void> } }
  ).happyDOM;
  await happyDom.waitUntilComplete();
}

/** Mirrors the two async <link> elements of app/layout.tsx. */
function AsyncFontLinks({ suppress }: { suppress: boolean }) {
  const suppression = suppress ? { suppressHydrationWarning: true } : {};
  return (
    <div>
      {ASYNC_LINKS.map((link) => (
        <link
          key={link.key}
          rel="stylesheet"
          href={link.href}
          media="print"
          {...suppression}
        />
      ))}
    </div>
  );
}

/** The `media` attribute of every async link inside the container. */
function mediaAttributes(container: HTMLElement): (string | null)[] {
  return Array.from(
    container.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).map((link) => link.getAttribute('media'));
}

interface HydrationOutcome {
  /** Everything React logged through console.error while hydrating. */
  errors: string[];
  /** The `media` attribute of each link after the promotion ran. */
  mediaAfterPromotion: (string | null)[];
}

/**
 * Render on the server, run the promotion script, then hydrate — exactly the
 * order the browser performs them.
 */
async function hydrateWithPromotion(suppress: boolean): Promise<HydrationOutcome> {
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(' '));
  });

  try {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<AsyncFontLinks suppress={suppress} />);

    // The inline script the layout ships, running against the parsed HTML.
    new Function(ASYNC_STYLESHEET_FLIP)();
    const links = Array.from(
      container.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    );
    for (const link of links) {
      link.dispatchEvent(new Event('load'));
    }
    const mediaAfterPromotion = mediaAttributes(container);

    const root = await act(async () =>
      hydrateRoot(container, <AsyncFontLinks suppress={suppress} />),
    );
    root.unmount();
    container.remove();

    return { errors, mediaAfterPromotion };
  } finally {
    spy.mockRestore();
  }
}

/** The hydration complaint we are hunting, and nothing else. */
function hydrationComplaints(errors: string[]): string[] {
  return errors.filter((message) => /hydrated|didn't match/i.test(message));
}

describe('async font stylesheets and React hydration', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('promotes both stylesheets to media="all" when they load', async () => {
    const { mediaAfterPromotion } = await hydrateWithPromotion(true);
    expect(mediaAfterPromotion).toEqual(['all', 'all']);
  });

  it('promotes immediately when the stylesheet is already cached', async () => {
    // The script's fast path: `el.sheet` is already set, so no load event
    // is needed and the fonts are usable on the very first paint.
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<AsyncFontLinks suppress />);
    await settle();
    expect(mediaAttributes(container)).toEqual(['print', 'print']);

    new Function(ASYNC_STYLESHEET_FLIP)();
    expect(mediaAttributes(container)).toEqual(['all', 'all']);
    container.remove();
  });

  it('hydrates without a mismatch complaint', async () => {
    const { errors } = await hydrateWithPromotion(true);
    expect(hydrationComplaints(errors)).toEqual([]);
  });

  it('complains without suppressHydrationWarning — the promotion is the cause', async () => {
    // Guards the test above: if this ever stops complaining, the mismatch
    // would have come back unnoticed. The complaint has to name the `media`
    // attribute, otherwise some unrelated hydration error would satisfy it.
    const { errors } = await hydrateWithPromotion(false);
    const complaints = hydrationComplaints(errors);
    expect(complaints.length).toBeGreaterThan(0);
    expect(complaints.join('\n')).toMatch(/media/);
  });

  it('leaves the promoted attribute in place after hydration', async () => {
    // React warns about attribute differences but never patches them, so the
    // stylesheet has to stay `media="all"` for the fonts to apply.
    const { mediaAfterPromotion } = await hydrateWithPromotion(true);
    expect(mediaAfterPromotion).toEqual(['all', 'all']);
  });
});

describe('app/layout.tsx', () => {
  const layout = readFileSync(resolve(ROOT, 'app', 'layout.tsx'), 'utf8');

  it('marks both async stylesheets with suppressHydrationWarning', () => {
    // `[^>]*?` keeps the match inside a single tag, so the blocking
    // stylesheet (which has no media attribute) cannot be picked up.
    const asyncLinks = layout.match(/<link\s[^>]*?media="print"[^>]*?\/>/g) ?? [];
    expect(asyncLinks).toHaveLength(2);
    for (const link of asyncLinks) {
      expect(link).toContain('suppressHydrationWarning');
    }
  });

  it('keeps the body typeface on the critical path, without the flag', () => {
    const blocking = layout.match(/<link\s[^>]*?href=\{fontCss\.sans\}[^>]*?\/>/g) ?? [];
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).not.toContain('suppressHydrationWarning');
    expect(blocking[0]).not.toContain('media=');
  });
});
