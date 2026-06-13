import { getPool } from './db';
import { getConfig } from './config';

export type AiCallStatus = 'ok' | 'error' | 'rate-limited';

export interface LogAiCallArgs {
  userId: number | null;
  feature: string;
  model: string;
  status: AiCallStatus;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export async function logAiCall(args: LogAiCallArgs): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO ai_calls
         (user_id, feature, model, status, prompt_tokens, completion_tokens, duration_ms, error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.userId,
        args.feature,
        args.model,
        args.status,
        args.promptTokens ?? null,
        args.completionTokens ?? null,
        args.durationMs ?? null,
        args.error ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
      ],
    );
  } catch (err) {
    console.warn('[logAiCall] insert failed:', (err as Error).message);
  }
}

export async function checkAiRateLimit(userId: number): Promise<boolean> {
  const limitStr = await getConfig('ai.rate_limit_per_user_per_day');
  const limit = limitStr ? parseInt(limitStr, 10) : 5;
  if (limit <= 0) return true; // 0 = unlimited
  const pool = getPool();
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM ai_calls
     WHERE user_id = ? AND created_at >= CURDATE() AND status IN ('ok','error')`,
    [userId],
  );
  return Number(rows[0].n) < limit;
}

export class RateLimitError extends Error {
  constructor() { super('rate limit exceeded'); this.name = 'RateLimitError'; }
}

export interface WithAiLoggingArgs {
  userId: number | null;
  feature: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export async function withAiLogging<T>(args: WithAiLoggingArgs, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let model = 'unknown';
  let status: AiCallStatus = 'ok';
  let error: string | undefined;
  let result: T;
  try {
    result = await fn();
    return result;
  } catch (err) {
    error = (err as Error).message;
    status = err instanceof RateLimitError ? 'rate-limited' : 'error';
    throw err;
  } finally {
    const duration = Date.now() - start;
    await logAiCall({
      userId: args.userId,
      feature: args.feature,
      model: args.model ?? 'unknown',
      status,
      durationMs: duration,
      error,
      metadata: args.metadata,
    });
  }
}
