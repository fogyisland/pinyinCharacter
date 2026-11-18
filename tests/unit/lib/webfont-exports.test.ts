/**
 * lib/webfont — the public surface.
 *
 * The webfont cluster was split by responsibility (module resolution, the
 * capability probes, the release text helpers, the release publisher). The
 * split must NOT change what the modules export: `app/api/admin/webfonts/*`
 * and the other webfont test files import these names, and a RENAMED export
 * breaks them at RUNTIME, not at compile time, when the import is a
 * type-only one.
 *
 * ⚠️ This test is a GUARDRAIL, not a test of new behaviour: it has to be
 * GREEN both before and after the split. A red run means an export was
 * lost or renamed on the way.
 *
 * ⚠️ It only checks the VALUE exports. The type exports (`CapabilityReport`,
 * `ApplyResult`, …) do not exist at runtime — their consistency is the job
 * of `tsc --noEmit`.
 */
import { describe, it, expect } from 'vitest';

import * as capability from '@/lib/webfont/capability';
import * as apply from '@/lib/webfont/apply';

describe('lib/webfont — the public exports', () => {
  it('exports the capability surface', () => {
    for (const name of [
      'resolveFontDir',
      'resolveModuleEntry',
      'resolveArgv',
      'probeCapability',
    ]) {
      expect(typeof (capability as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
  });

  it('exports the apply surface', () => {
    for (const name of [
      'countFaceRules',
      'rewriteStylesheetUrls',
      'manifestVersionOf',
      'parsePageCost',
      'describeGateFailure',
      'applyStagedBuild',
    ]) {
      expect(typeof (apply as Record<string, unknown>)[name], name).not.toBe('undefined');
    }
  });

  it('exports each value export as a FUNCTION', () => {
    // A split that moves a function into a namespace object would keep the
    // name "exported" but change its call shape — `resolveFontDir(...)`
    // would become `capability.resolveFontDir.resolveFontDir(...)`. The
    // call sites would fail to compile, but this pins the shape at
    // runtime too, where the compiler cannot see it.
    for (const [name, value] of Object.entries(capability)) {
      if (name === 'default') continue;
      expect(typeof value, `capability.${name}`).toBe('function');
    }
    for (const [name, value] of Object.entries(apply)) {
      if (name === 'default') continue;
      expect(typeof value, `apply.${name}`).toBe('function');
    }
  });

  it('exports EXACTLY the runtime surface the split was supposed to keep', () => {
    // The list above says "these names exist". This one says "these are
    // ALL the names" — an export that APPEARS is as much a break as one
    // that disappears: a helper that leaked out of the cluster becomes a
    // name other modules may start depending on, and the next split would
    // then have to keep it too.
    //
    // The baseline is the export list of `capability.ts` and `apply.ts`
    // before the split (2026-11-18). `currentLiveReleaseDir` was an
    // internal helper then; it is listed here because the publisher
    // exports it now, and it is a FUNCTION like the rest.
    expect(Object.keys(capability).filter((name) => name !== 'default').sort()).toEqual([
      'probeCapability',
      'resolveArgv',
      'resolveFontDir',
      'resolveModuleEntry',
    ]);
    expect(Object.keys(apply).filter((name) => name !== 'default').sort()).toEqual([
      'applyStagedBuild',
      'countFaceRules',
      'currentLiveReleaseDir',
      'describeGateFailure',
      'manifestVersionOf',
      'parsePageCost',
      'rewriteStylesheetUrls',
    ]);
  });
});
