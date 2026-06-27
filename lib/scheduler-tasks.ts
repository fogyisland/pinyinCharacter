/**
 * Scheduler task implementations.
 *
 * Each task returns a TaskResult so the runner can build a human-readable
 * summary. Tasks must be idempotent and never throw out — the runner
 * catches per-task errors and records them via recordSchedulerRun().
 *
 * The 3 default tasks (controlled by scheduler.task_* keys):
 *   - contentRefresh:    re-runs contentSync in --missing mode (light-touch)
 *   - dailyCharRefresh:  pre-warms today's daily-char + tomorrow's
 *   - statsRefresh:      runs getSystemStats to validate DB connectivity
 */
import { contentSync } from '../scripts/content-sync';
import { getDailyChar } from './rare-chars';
import { getSystemStats } from './admin';
import { getPool } from './db';
import { sendEmail } from './email';
import { campaignEmail } from './email-templates';
import { issueUnsubscribeToken, markRecipient, finalizeCampaignIfDone } from './email-campaigns';

export type TaskName = 'content-refresh' | 'daily-char' | 'stats-refresh' | 'email-campaign-send';

export interface TaskResult {
  name: TaskName;
  ok: boolean;
  summary: string;
  error?: string;
}

function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tomorrowStr(d = new Date()): string {
  const t = new Date(d.getTime() + 86400_000);
  return todayStr(t);
}

export async function runContentRefresh(): Promise<TaskResult> {
  const t0 = Date.now();
  const stats = await contentSync({ missing: true, writeDb: false, concurrency: 2 });
  const ms = Date.now() - t0;
  const ok = stats.errors === 0;
  return {
    name: 'content-refresh',
    ok,
    summary: `scanned=${stats.scanned} generated=${stats.generated} skipped=${stats.skipped} errors=${stats.errors} (${ms}ms)`,
    ...(ok ? {} : { error: `${stats.errors} field(s) failed` }),
  };
}

export async function runDailyCharRefresh(): Promise<TaskResult> {
  const t0 = Date.now();
  const today = await getDailyChar(todayStr());
  const tomorrow = await getDailyChar(tomorrowStr());
  const ms = Date.now() - t0;
  if (!today || !tomorrow) {
    return {
      name: 'daily-char',
      ok: false,
      summary: `missing daily char (today=${today?.char ?? '?'} tomorrow=${tomorrow?.char ?? '?'})`,
      error: 'rare_chars table empty or pickDailyChar failed',
    };
  }
  return {
    name: 'daily-char',
    ok: true,
    summary: `today=${today.char} (${today.pinyin}) tomorrow=${tomorrow.char} (${tomorrow.pinyin}) (${ms}ms)`,
  };
}

export async function runStatsRefresh(): Promise<TaskResult> {
  const t0 = Date.now();
  const s = await getSystemStats();
  const ms = Date.now() - t0;
  return {
    name: 'stats-refresh',
    ok: true,
    summary: `users=${s.users} admins=${s.admins} history=${s.history} favorites=${s.favorites} audit=${s.audit} (${ms}ms)`,
  };
}

/**
 * Email campaign sender — picks up campaigns with status='sending' and
 * dispatches their pending recipients in small batches. Designed so the
 * scheduler tick is short (a few seconds) and any remaining work resumes
 * on the next tick — survives server restarts mid-send.
 *
 * One tick sends at most BATCH rows per campaign to keep the run bounded.
 */
const BATCH = 50;
const CONCURRENCY = 4;

export async function runEmailCampaignSend(): Promise<TaskResult> {
  const t0 = Date.now();
  const pool = getPool();
  // Active campaigns (one row each, status='sending').
  const [campaigns] = await pool.query<any[]>(
    `SELECT id, subject FROM email_campaigns WHERE status = 'sending' ORDER BY id LIMIT 5`
  );
  if (campaigns.length === 0) {
    return { name: 'email-campaign-send', ok: true, summary: 'no active campaigns (0ms)' };
  }
  let totalSent = 0, totalFailed = 0, totalSkipped = 0;
  for (const c of campaigns as Array<{ id: number; subject: string }>) {
    const [pending] = await pool.query<any[]>(
      `SELECT r.id, r.user_id, r.email, u.username, c.html_body, c.text_body
       FROM email_campaign_recipients r
       JOIN users u ON u.id = r.user_id
       JOIN email_campaigns c ON c.id = r.campaign_id
       WHERE r.campaign_id = ? AND r.status = 'pending'
       ORDER BY r.id LIMIT ?`,
      [c.id, BATCH]
    );
    let sent = 0, failed = 0, skipped = 0;
    // Simple bounded concurrency: process in chunks of CONCURRENCY.
    for (let off = 0; off < pending.length; off += CONCURRENCY) {
      const slice = pending.slice(off, off + CONCURRENCY);
      await Promise.all(slice.map(async (row) => {
        try {
          // Honor opt-out at send time — race with /unsubscribe.
          const [u] = await pool.query<any[]>(
            `SELECT marketing_opted_out FROM users WHERE id = ? LIMIT 1`,
            [row.user_id]
          );
          if (u[0]?.marketing_opted_out) {
            await markRecipient(row.id, 'skipped', 'opted-out');
            skipped++;
            return;
          }
          const unsub = issueUnsubscribeToken(row.user_id);
          // Use site url from env at send time (admin may have updated it).
          const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4444').replace(/\/+$/, '');
          const unsubUrl = `${siteUrl}/api/email/unsubscribe?token=${encodeURIComponent(unsub)}`;
          const tpl = campaignEmail({
            username: row.username,
            bodyHtml: row.html_body,
            bodyText: row.text_body,
            unsubscribeUrl: unsubUrl,
          });
          await sendEmail({
            to: row.email,
            subject: c.subject,
            html: tpl.html,
            text: tpl.text,
            template: 'campaign',
          });
          await markRecipient(row.id, 'sent');
          sent++;
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          try { await markRecipient(row.id, 'failed', err); } catch { /* swallow */ }
          failed++;
        }
      }));
    }
    const status = await finalizeCampaignIfDone(c.id);
    totalSent += sent; totalFailed += failed; totalSkipped += skipped;
    if (status !== 'sending') {
      // Campaign terminal — nothing more for it.
    }
  }
  const ms = Date.now() - t0;
  return {
    name: 'email-campaign-send',
    ok: true,
    summary: `campaigns=${campaigns.length} sent=${totalSent} failed=${totalFailed} skipped=${totalSkipped} (${ms}ms)`,
  };
}

export async function runTask(name: TaskName): Promise<TaskResult> {
  switch (name) {
    case 'content-refresh':      return runContentRefresh();
    case 'daily-char':           return runDailyCharRefresh();
    case 'stats-refresh':        return runStatsRefresh();
    case 'email-campaign-send':  return runEmailCampaignSend();
  }
}

export const ALL_TASKS: TaskName[] = ['content-refresh', 'daily-char', 'stats-refresh', 'email-campaign-send'];
