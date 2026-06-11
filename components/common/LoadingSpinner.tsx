'use client';

export function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <div
      className="inline-block animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
      style={{ width: size, height: size }}
      role="status"
      aria-label="loading"
    />
  );
}
