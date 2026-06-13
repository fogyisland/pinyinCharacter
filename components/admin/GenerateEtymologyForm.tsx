'use client';
import { useState } from 'react';

interface GenerateResult {
  generated: number;
  skipped: number;
  errors: { char: string; message: string }[];
}

export function GenerateEtymologyForm() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const chars = Array.from(input).filter((c) => /[一-鿿]/.test(c));
    if (chars.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/chars/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chars }),
      });
      const j = await res.json();
      if (j.ok) setResult(j.data);
    } catch {
      // Network error: result stays null, user can retry.
    } finally {
      setLoading(false);
    }
  };

  const charCount = Array.from(input).filter((c) => /[一-鿿]/.test(c)).length;

  return (
    <form onSubmit={handleSubmit} className="card-paper rounded-lg p-4">
      <label className="block text-sm text-ink-soft mb-2">输入要生成的汉字(每个字单独生成一次)</label>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        maxLength={100}
        placeholder="输入汉字，如 一丁七万丈三..."
        className="w-full border border-ink/30 rounded p-2 text-base font-serif bg-paper"
      />
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={loading || charCount === 0} className="text-sm px-4 py-2 rounded bg-ink text-paper hover:bg-ink/80 disabled:opacity-50">
          {loading ? '生成中...' : '生成字源'}
        </button>
        <span className="text-xs text-ink-soft">已输入 {charCount} 个字</span>
      </div>
      {result && (
        <div className="mt-4 p-3 bg-paper-warm rounded text-sm space-y-1">
          <div>✓ 已生成 <span className="font-semibold">{result.generated}</span> 个</div>
          {result.skipped > 0 && <div>↷ 跳过 {result.skipped} 个(已有字源)</div>}
          {result.errors.length > 0 && (
            <div className="text-seal mt-1">
              ✗ 失败 {result.errors.length} 个:{result.errors.map((e) => e.char).join('、')}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
