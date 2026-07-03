'use client';

export function ChainSummary({
  chain,
  onRestart,
}: {
  chain: string[];
  onRestart: () => void;
}) {
  const text = chain.join(' → ');
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch (e) {
      console.error('share failed', e);
    }
  };
  return (
    <div className="mx-auto max-w-md rounded-lg border bg-paper p-8 text-center">
      <h2 className="text-2xl font-bold">接龙结束</h2>
      <p className="mt-2 text-ink-soft">
        接龙长度: <span className="text-3xl text-seal">{chain.length}</span> 字
      </p>
      <div className="mt-4 max-h-32 overflow-y-auto rounded bg-paper-deep p-2 text-sm font-kai">
        {text}
      </div>
      <div className="mt-6 flex justify-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-md bg-seal px-4 py-2 text-white hover:bg-seal/80"
        >
          再来一局
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="rounded-md border border-ink/20 px-4 py-2 hover:bg-paper-deep"
        >
          分享
        </button>
      </div>
    </div>
  );
}
