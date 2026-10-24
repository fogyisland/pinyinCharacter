'use client';

import { useRef, useState } from 'react';
import {
  EMPTY_PROGRESS,
  MAX_FIELD_ERRORS,
  extractHanChars,
  type BatchProgress,
  type BatchStatus,
  type FieldProgress,
  type FieldResult,
  type GenerateResponse,
} from './generate-types';

/**
 * The single-character generation request.
 *
 * Returns the loading flag, the last result and the last error, so the
 * form can show them without owning any of the request logic.
 */
export function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(chars: string, fields: Record<string, boolean>) {
    setError(null);
    setResult(null);
    const validChars = extractHanChars(chars);
    if (validChars.length === 0) {
      setError('请输入至少 1 个汉字');
      return;
    }
    if (!Object.values(fields).some(Boolean)) {
      setError('请至少勾选 1 个字段');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/chars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chars: validChars, fields }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? '生成失败');
        return;
      }
      setResult(j.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return { loading, result, error, submit };
}

/**
 * The batch runner.
 *
 * It walks the characters of one level 30 at a time, keeps its own offset
 * so a paused run can pick up where it stopped, and keeps the per-field
 * counters in the React state.
 */
export function useBatchRunner() {
  const [status, setStatus] = useState<BatchStatus>('idle');
  const [progress, setProgress] = useState<BatchProgress>(EMPTY_PROGRESS);
  const [lastError, setLastError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const pauseRef = useRef(false);
  const bodyRef = useRef<{
    level: number;
    fields: Record<string, boolean>;
    concurrency: number;
  } | null>(null);

  async function runOnce() {
    const body = bodyRef.current;
    if (!body) return;
    setLastError(null);
    try {
      const res = await fetch('/api/admin/chars/generate-by-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: body.level,
          fields: body.fields,
          offset: offsetRef.current,
          limit: 30,
          concurrency: body.concurrency,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        setLastError(j.error?.message ?? '请求失败');
        setStatus('error');
        return;
      }
      const d = j.data;
      offsetRef.current = d.nextOffset;
      setProgress((prev) => ({
        totalChars: d.totalChars,
        processed: prev.processed + d.processed,
        nextOffset: d.nextOffset,
        elapsedMs: prev.elapsedMs + d.elapsedMs,
        perField: mergePerField(prev.perField, d.perField),
      }));
      if (d.done) {
        setStatus('done');
      } else if (pauseRef.current) {
        setStatus('paused');
      } else {
        setTimeout(() => {
          if (!pauseRef.current) runOnce();
        }, 800);
      }
    } catch (err) {
      setLastError((err as Error).message);
      setStatus('error');
    }
  }

  function start(level: number, fields: Record<string, boolean>, concurrency: number) {
    if (!Object.values(fields).some(Boolean)) {
      setLastError('请至少勾选 1 个字段');
      setStatus('error');
      return;
    }
    bodyRef.current = { level, fields, concurrency };
    offsetRef.current = 0;
    pauseRef.current = false;
    setProgress(EMPTY_PROGRESS);
    setLastError(null);
    setStatus('running');
    runOnce();
  }

  function pause() {
    pauseRef.current = true;
    setStatus('paused');
  }

  function resume() {
    pauseRef.current = false;
    setStatus('running');
    runOnce();
  }

  function reset() {
    pauseRef.current = true;
    bodyRef.current = null;
    offsetRef.current = 0;
    setProgress(EMPTY_PROGRESS);
    setLastError(null);
    setStatus('idle');
  }

  return { status, progress, lastError, start, pause, resume, reset };
}

function mergePerField(
  a: Record<string, FieldProgress>,
  b: Record<string, FieldResult>,
): Record<string, FieldProgress> {
  const out: Record<string, FieldProgress> = { ...a };
  for (const k of Object.keys(b)) {
    const prev = a[k] ?? { generated: 0, skipped: 0, errorCount: 0, errors: [] };
    const incoming = b[k].errors;
    out[k] = {
      generated: prev.generated + b[k].generated,
      skipped: prev.skipped + b[k].skipped,
      errorCount: prev.errorCount + incoming.length,
      // Keep only the most recent errors. The old code appended the whole
      // list on every batch, which grew the state without bound AND copied
      // it every time — quadratic work over a long run.
      errors: prev.errors.concat(incoming).slice(-MAX_FIELD_ERRORS),
    };
  }
  return out;
}
