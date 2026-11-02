/**
 * The shapes the admin font pipeline talks in, and the formatting helpers
 * that go with them.
 *
 * ⚠️ **TYPE-ONLY, always.** These shapes travel from the server to the
 * browser. `WebfontJob` comes from a module that reaches `@/lib/db`
 * (mysql2) ⇒ it is imported as a TYPE, so the import is erased at build
 * time and mysql2 never reaches the browser bundle.
 *
 * The types live here, next to the panels that use them, because both the
 * pipeline panel and the two block components need the same ones — and a
 * type that one of them imports as a VALUE would be a bundler bug waiting
 * to happen.
 */
import type { WebfontJob } from '@/lib/webfont/jobs';

/** The placeholder of a value that is not there. */
export const DASH = '—';

/** Formats a byte count with thin separators, the way the admin shows them. */
export function formatBytes(value: number): string {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

/** Formats a number with thin separators. */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US').replace(/,/g, ' ');
}

/** The error message out of a failed answer, or a generic one. */
export function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message !== '') return message;
    }
    if (typeof error === 'string' && error !== '') return error;
  }
  return fallback;
}

/** The capability report, as `GET /api/admin/webfonts/capability` answers it. */
export interface CapabilityReport {
  ok: boolean;
  node: string;
  python: { available: boolean; version: string | null; error: string | null };
  fonttools: {
    available: boolean;
    version: string | null;
    error: string | null;
    remedy: string | null;
  };
  network: { available: boolean; checkedUrl: string; error: string | null };
  disk: { available: boolean; stagingDir: string; fontDir: string; error: string | null };
  toolchain: { subsetFont: boolean; typescript: boolean; tsx: boolean };
  sources: { filename: string; label: string; present: boolean; size: number | null }[];
  missing: string[];
}

/** One release of the ledger, as `GET /api/admin/webfonts/releases` answers it. */
export interface ReleaseEntry {
  dir: string;
  token: string;
  publishedAt: string;
  supersededAt: string | null;
  deletedAt: string | null;
  files: number;
  bytes: number;
  /** The backend's verdict — the page never computes one of its own. */
  canClean?: boolean;
}

/** The page cost of the candidate, beside the budget of the live tree. */
export interface PageCostReport {
  bytes: Record<string, number>;
  files: Record<string, number>;
  budgetBytes: Record<string, number>;
  budgetFiles: number;
}

/** What a human has to do to bring the repository back in line. */
export interface ReimportInfo {
  required: boolean;
  command: string;
  note: string;
}

/** One row of the re-base checklist. */
export interface RebaselineEntry {
  file: string;
  line: number;
  what: string;
  current: number | number[] | string | null;
  expected: number | number[] | string | null;
  always: boolean;
  note?: string;
}

/** The apply answer, as `POST /api/admin/webfonts/build/[id]/apply` answers it. */
export interface ApplyResponse {
  ok: true;
  job: WebfontJob;
  manifestVersion: string;
  releaseToken: string;
  releaseDir: string;
  summary: {
    liveFiles: number;
    liveBytes: number;
    newFiles: number;
    newBytes: number;
    releaseBytes: number;
  } | null;
  pageCost: PageCostReport | null;
  reimport: ReimportInfo;
  rebaseline: RebaselineEntry[];
}

/** One entry of the cleanup answer. */
export interface CleanupEntry {
  dir: string;
  bytes: number;
  /** `false` ⇒ the directory was never on the disk; nothing was deleted. */
  removed: boolean;
}
