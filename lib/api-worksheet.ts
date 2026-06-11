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
