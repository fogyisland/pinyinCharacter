'use client';
import { useState } from 'react';

/**
 * Click-to-copy path cell for the /admin/analytics detail table.
 *
 * Tiny client island (~15 LoC). On click, writes `path` to the clipboard
 * via the navigator.clipboard API and shows a 1.5s toast feedback. Falls
 * back silently if clipboard API is unavailable (HTTPS-only / older
 * browsers) or permission denied — admin can still read the path text.
 */
export function CopyPathCell({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable or permission denied — silent fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-left text-ink hover:bg-muted/30 px-1 -mx-1 rounded font-mono text-xs"
      title="点击复制路径"
    >
      {copied ? '✓ 已复制' : path}
    </button>
  );
}
