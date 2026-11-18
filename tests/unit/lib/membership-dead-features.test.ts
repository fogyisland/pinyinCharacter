/**
 * The three features that were never enforced must be gone from every
 * surface that can sell them.
 *
 * `unlimited_history`, `download_pdf` and `priority_tts` were listed in
 * `MembershipFeature`, seeded onto every plan, rendered as Chinese labels
 * in the admin plan picker AND in the public plan card — and no code
 * anywhere ever called `hasFeature()` for them. A user could buy a plan
 * that promised "无限历史记录" and "PDF 下载" and get exactly what a
 * non-member gets.
 *
 * The fix is to remove them, not to keep advertising them. A feature that
 * is only half-implemented is worse than no feature: it takes money for
 * something the buyer cannot use.
 *
 * These tests pin the ABSENCE of the three keys. A test that only checked
 * "the two good features are still there" would pass while the three dead
 * ones were quietly re-added later.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The features that no code path enforces. */
const DEAD_FEATURES = ['unlimited_history', 'download_pdf', 'priority_tts'] as const;

/** The features that ARE enforced and must survive. */
const LIVE_FEATURES = ['ai_calls', 'multi_worksheet_print'] as const;

/** Read a source file from the repo root. */
function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('the feature enum', () => {
  it('no longer offers a feature that nothing enforces', () => {
    // The type is now derived from MEMBERSHIP_FEATURES, so the source of
    // truth is that array. Check it — and check the union agrees with it.
    const source = readSource('lib/membership.ts');
    const list = source.match(
      /export const MEMBERSHIP_FEATURES\s*=\s*\[([^\]]*)\]/,
    );
    expect(list, 'the MEMBERSHIP_FEATURES list must exist').toBeTruthy();
    for (const dead of DEAD_FEATURES) {
      expect(
        list![1],
        `MEMBERSHIP_FEATURES still offers "${dead}" — nothing enforces it`,
      ).not.toContain(`'${dead}'`);
    }
  });

  it('still offers the two features that are enforced', () => {
    const source = readSource('lib/membership.ts');
    const list = source.match(
      /export const MEMBERSHIP_FEATURES\s*=\s*\[([^\]]*)\]/,
    );
    expect(list).toBeTruthy();
    for (const live of LIVE_FEATURES) {
      expect(list![1], `MEMBERSHIP_FEATURES must still offer "${live}"`).toContain(
        `'${live}'`,
      );
    }
  });
});

describe('the seeded default plans', () => {
  it('does not seed a feature that nothing enforces', () => {
    const source = readSource('lib/membership.ts');
    const allFeatures = source.match(/const ALL_FEATURES:[^=]*=\s*\[([^\]]*)\]/);
    expect(allFeatures, 'the ALL_FEATURES list must exist').toBeTruthy();
    for (const dead of DEAD_FEATURES) {
      expect(
        allFeatures![1],
        `ALL_FEATURES still seeds "${dead}" — every plan would grant it`,
      ).not.toContain(`'${dead}'`);
    }
  });
});

describe('the admin plan picker', () => {
  it('offers only the features that are enforced', () => {
    const source = readSource('components/admin/memberships/PlanRow.tsx');
    const list = source.match(/const ALL_FEATURES\s*=\s*(\[[^\]]*\]|[A-Za-z_][\w.]*)/);
    expect(list, 'the admin picker list must exist').toBeTruthy();
    // The picker derives its list from MEMBERSHIP_FEATURES. Either it is a
    // literal array (check it) or a reference (check the reference).
    if (list![1].includes('MEMBERSHIP_FEATURES')) {
      expect(source).toContain('MEMBERSHIP_FEATURES');
      expect(list![1]).not.toContain(`'${DEAD_FEATURES[0]}'`);
    } else {
      for (const dead of DEAD_FEATURES) {
        expect(
          list![1],
          `the admin picker still offers "${dead}" to the operator`,
        ).not.toContain(`'${dead}'`);
      }
    }
    // Either way, the picker must import the shared list.
    expect(
      source,
      'the admin picker must derive its keys from MEMBERSHIP_FEATURES',
    ).toContain('MEMBERSHIP_FEATURES');
  });

  it('has no Chinese label for a feature that nothing enforces', () => {
    const source = readSource('components/admin/memberships/PlanRow.tsx');
    const labels = source.match(/const FEATURE_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
    expect(labels, 'the admin label map must exist').toBeTruthy();
    for (const dead of DEAD_FEATURES) {
      expect(labels![1], `the admin still has a label for "${dead}"`).not.toContain(
        `${dead}:`,
      );
    }
  });
});

describe('the public plan card', () => {
  it('has no Chinese label for a feature that nothing enforces', () => {
    const source = readSource('components/membership/PlanCard.tsx');
    const labels = source.match(/const FEATURE_LABELS[^=]*=\s*\{([\s\S]*?)\};/);
    expect(labels, 'the plan card label map must exist').toBeTruthy();
    for (const dead of DEAD_FEATURES) {
      expect(
        labels![1],
        `the plan card still shows "${dead}" to a paying user`,
      ).not.toContain(`${dead}:`);
    }
    for (const live of LIVE_FEATURES) {
      expect(labels![1], `the plan card must still show "${live}"`).toContain(
        `${live}:`,
      );
    }
  });
});

describe('the admin plan API', () => {
  it('rejects a feature that nothing enforces', () => {
    const source = readSource('app/api/admin/memberships/plans/[id]/route.ts');
    const schema = source.match(/features:\s*\n?\s*z\.array\(\s*z\.enum\(([\s\S]*?)\)\s*\)/);
    expect(schema, 'the features zod schema must exist').toBeTruthy();
    // The schema validates against MEMBERSHIP_FEATURES. Either it names the
    // shared constant (check that) or it carries a literal list (check it).
    if (schema![1].includes('MEMBERSHIP_FEATURES')) {
      expect(source).toContain('MEMBERSHIP_FEATURES');
    } else {
      for (const dead of DEAD_FEATURES) {
        expect(
          schema![1],
          `the admin API still accepts "${dead}"`,
        ).not.toContain(`'${dead}'`);
      }
    }
    expect(
      source,
      'the admin API must validate against MEMBERSHIP_FEATURES',
    ).toContain('MEMBERSHIP_FEATURES');
  });

  it('accepts the feature that is enforced but used to be rejected', () => {
    // Regression: the schema used to list four keys and omit
    // `multi_worksheet_print`, so ticking "批量 / 多页打印" in the admin UI
    // and saving failed with a validation error — the one feature that IS
    // enforced could not be granted at all.
    const source = readSource('app/api/admin/memberships/plans/[id]/route.ts');
    expect(
      source,
      'the admin API must validate against the shared feature list',
    ).toContain('z.enum(MEMBERSHIP_FEATURES)');
  });
});

describe('the migration that cleans the database', () => {
  it('deletes the rows that would still grant a dead feature', () => {
    const source = readSource('scripts/migrations/2026-11-18-membership-dead-features.sql');
    expect(source, 'the migration must exist').toContain(
      'DELETE FROM membership_plan_features',
    );
    for (const dead of DEAD_FEATURES) {
      expect(
        source,
        `the migration does not remove the rows granting "${dead}"`,
      ).toContain(`'${dead}'`);
    }
  });
});

describe('the operator script that seeds the plans', () => {
  it('does not re-grant a feature that nothing enforces', () => {
    const source = readSource('scripts/migrate-membership.ts');
    const list = source.match(/const ALL_FEATURES\s*=\s*(\[[^\]]*\]|[A-Za-z_][\w.]*)/);
    expect(list, 'the seeded feature list must exist').toBeTruthy();
    // The list is now derived from MEMBERSHIP_FEATURES. If it is a literal
    // array, check it directly; if it is a reference, check the reference.
    const usesSharedList = list![1].includes('MEMBERSHIP_FEATURES');
    if (usesSharedList) {
      expect(source).toContain('MEMBERSHIP_FEATURES');
      expect(list![1]).not.toContain(`'${DEAD_FEATURES[0]}'`);
      return;
    }
    for (const dead of DEAD_FEATURES) {
      expect(
        list![1],
        `the seeding script would re-grant "${dead}"`,
      ).not.toContain(`'${dead}'`);
    }
  });
});
