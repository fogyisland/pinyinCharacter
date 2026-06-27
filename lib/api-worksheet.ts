import type { CellStyle, Worksheet } from './worksheet-types';

export async function listWorksheets(): Promise<Worksheet[]> {
  const res = await fetch('/api/worksheets');
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'fetch failed';
    throw new Error(msg);
  }
  return data.data.worksheets;
}

export interface WorksheetSummary {
  id: number;
  title: string;
  charCount: number;
  createdAt: string;
}

export async function listWorksheetsLightweight(): Promise<WorksheetSummary[]> {
  const res = await fetch('/api/worksheets/lightweight');
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'fetch failed';
    throw new Error(msg);
  }
  return data.data.items;
}

export async function fetchWorksheet(id: number): Promise<Worksheet> {
  const res = await fetch(`/api/worksheets/${id}`);
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'fetch failed';
    throw new Error(msg);
  }
  return data.data;
}

export async function saveWorksheetApi(input: {
  title: string;
  content: string[];
  cellStyle: CellStyle;
}): Promise<{ id: number }> {
  const res = await fetch('/api/worksheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'save failed';
    throw new Error(msg);
  }
  return data.data;
}

export async function deleteWorksheetApi(id: number): Promise<void> {
  const res = await fetch(`/api/worksheets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('delete failed');
}

export async function renameWorksheetApi(id: number, title: string): Promise<{ title: string }> {
  const res = await fetch(`/api/worksheets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (res.status === 401) {
    throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  }
  const data = await res.json();
  if (!data.ok) {
    const code = data.error?.code ?? 'rename_failed';
    throw Object.assign(new Error(data.error?.message ?? 'rename failed'), { code });
  }
  return data.data;
}

export async function printWorksheetRequest(id: number): Promise<{ id: number }> {
  const res = await fetch(`/api/worksheets/${id}/print`, { method: 'POST' });
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'print failed';
    throw new Error(msg);
  }
  return data.data;
}

export interface AppendCharToWorksheetInput {
  char?: string;
  chars?: string[];
  worksheetId?: number;
  newTitle?: string;
}

export interface AppendCharToWorksheetResult {
  worksheetId: number;
  title: string;
  added: boolean;
  addedCount: number;
  skipped: number;
  charCount: number;
  created: boolean;
}

export async function appendCharToWorksheetApi(
  input: AppendCharToWorksheetInput
): Promise<AppendCharToWorksheetResult> {
  const res = await fetch('/api/worksheets/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (res.status === 401) {
    throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
  }
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'add failed';
    throw new Error(msg);
  }
  return data.data;
}

/** @deprecated use appendCharToWorksheetApi — kept for callers that only need legacy "我的字帖" mode. */
export async function appendCharToMyWorksheetApi(char: string): Promise<{ worksheetId: number; added: boolean }> {
  const r = await appendCharToWorksheetApi({ char });
  return { worksheetId: r.worksheetId, added: r.added };
}
