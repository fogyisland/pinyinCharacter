'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { PinyinOutput } from './PinyinOutput';
import { ReadAloudButton } from './ReadAloudButton';
import { textToPinyin, renderWithSpaces, renderWithoutSpaces, type PinyinToken } from '@/lib/pinyin-client';
import { useAppStore } from '@/lib/store';
import { createHistoryRequest } from '@/lib/api-history';

export function TextToPinyin() {
  const [text, setText] = useState('');
  const [withSpaces, setWithSpaces] = useState(true);
  const [tokens, setTokens] = useState<PinyinToken[]>([]);
  const [recognizing, setRecognizing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'info' } | null>(null);
  const user = useAppStore(s => s.user);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{ input: string; ts: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 字 → 拼音：实时
  useEffect(() => {
    if (!text.trim()) { setTokens([]); return; }
    setTokens(textToPinyin(text));
  }, [text]);

  // 自动入库：1.5s debounce
  useEffect(() => {
    if (!user) return;
    if (!text.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void saveHistory(text); }, 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, user]);

  // unmount 时 flush
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (user && text.trim()) void saveHistory(text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveHistory(input: string) {
    if (!user) return;
    const last = lastSavedRef.current;
    if (last && last.input === input && Date.now() - last.ts < 60_000) return;
    try {
      await createHistoryRequest({
        kind: 'text2pinyin', input, output: null, char_count: input.length, dedup: true,
      });
      lastSavedRef.current = { input, ts: Date.now() };
    } catch (e) { console.error('history save failed', e); }
  }

  const showToast = (msg: string, type: 'error' | 'info' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('image load failed'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_W = 1024;
          const scale = Math.min(1, MAX_W / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas 2d unavailable')); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片', 'error');
      return;
    }
    setRecognizing(true);
    try {
      const dataUrl = await compressImage(file);
      const res = await fetch('/api/ai/char-recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const body = await res.json();
      if (res.ok && body.ok && typeof body.char === 'string') {
        setText((prev) => prev + body.char);
      } else {
        showToast(body?.message ?? '识别失败,请重试', 'error');
      }
    } catch {
      showToast('网络异常,请重试', 'error');
    } finally {
      setRecognizing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const rendered = text.trim()
    ? (withSpaces ? renderWithSpaces(tokens) : renderWithoutSpaces(tokens))
    : '';

  return (
    <section className="card-paper p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">字 → 拼音</h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={withSpaces} onChange={e => setWithSpaces(e.target.checked)} />
            带空格
          </label>
        </div>
      </div>
      <div className="relative">
        <textarea
          className="w-full border rounded p-2 min-h-24"
          placeholder="输入汉字，如「你好世界」"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={recognizing}
          aria-label="拍照识别单字"
          title="拍照识别单字"
          className="absolute right-2 top-2 p-2 rounded hover:bg-muted/50 disabled:opacity-50"
        >
          {recognizing ? (
            <span className="inline-block w-5 h-5 border-2 border-ink-soft border-t-transparent rounded-full animate-spin" />
          ) : (
            <Camera className="w-5 h-5 text-ink-soft" />
          )}
        </button>
        {toast && (
          <div
            role="alert"
            className={`absolute left-1/2 -translate-x-1/2 -top-10 px-3 py-1.5 rounded text-sm whitespace-nowrap ${
              toast.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-paper text-ink border border-line'
            }`}
          >
            {toast.msg}
          </div>
        )}
      </div>
      {rendered && (
        <div className="space-y-2">
          <PinyinOutput tokens={tokens} withSpaces={withSpaces} />
          <div className="flex gap-2">
            <ReadAloudButton text={text} />
            <button
              type="button"
              className="text-sm px-3 py-1 border rounded hover:bg-paper-deep"
              onClick={async () => { await navigator.clipboard.writeText(rendered); }}
            >复制</button>
            <button
              type="button"
              className="text-sm px-3 py-1 border rounded hover:bg-paper-deep ml-auto"
              onClick={() => setText('')}
            >清空</button>
          </div>
        </div>
      )}
    </section>
  );
}
