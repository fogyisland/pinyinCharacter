'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border px-3 py-1 hover:bg-paper-deep"
    >
      打印
    </button>
  );
}
