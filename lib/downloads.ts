import { getPool } from './db';

export type DownloadFormat = 'pdf' | 'print';
export type DownloadSourceType = 'worksheet' | 'poem' | 'sutra' | 'rare-char-card';
export type DownloadStatus = 'ok' | 'error';

export interface LogDownloadArgs {
  userId: number;
  format: DownloadFormat;
  sourceType: DownloadSourceType;
  sourceId: string | null;
  status?: DownloadStatus;
  durationMs?: number;
  ip?: string | null;
}

/** Fire-and-forget. Never throws. */
export async function logDownload(args: LogDownloadArgs): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO downloads
         (user_id, format, source_type, source_id, status, duration_ms, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        args.userId,
        args.format,
        args.sourceType,
        args.sourceId,
        args.status ?? 'ok',
        args.durationMs ?? null,
        args.ip ?? null,
      ],
    );
  } catch (err) {
    console.warn('[logDownload] insert failed:', (err as Error).message);
  }
}
