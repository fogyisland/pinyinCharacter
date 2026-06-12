// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LogRow } from '@/components/admin/LogRow';
import type { UnifiedLogEntry } from '@/lib/admin-logs';

const baseEntry: UnifiedLogEntry = {
  id: 'audit:1', source: 'audit', event: 'login', userId: 7, username: 'alice',
  ip: '127.0.0.1', createdAt: '2026-06-12T10:00:00Z', metadata: {},
};

describe('LogRow', () => {
  it('renders the event and username', () => {
    render(<LogRow entry={baseEntry} />);
    expect(screen.getByText('login')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('shows the source badge', () => {
    render(<LogRow entry={{ ...baseEntry, source: 'download' }} />);
    expect(screen.getByText('download')).toBeInTheDocument();
  });
});