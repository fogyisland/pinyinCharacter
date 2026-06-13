const STORAGE_KEY = 'pinyin-character:read-stories';
const MAX_HISTORY = 500;

export function getReadChars(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function addReadChar(char: string): void {
  if (typeof window === 'undefined' || !char) return;
  try {
    const arr = getReadChars();
    if (arr.includes(char)) return;
    arr.push(char);
    const trimmed = arr.length > MAX_HISTORY ? arr.slice(arr.length - MAX_HISTORY) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage unavailable (private mode, quota) — silent skip
  }
}

export function clearReadHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
