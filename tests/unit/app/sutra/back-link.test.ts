import { describe, it, expect } from 'vitest';
import { getSutraBackLink } from '@/app/sutra/[id]/back-link';

describe('getSutraBackLink', () => {
  it('returns dictionary link for from=dictionary', () => {
    expect(getSutraBackLink('dictionary')).toEqual({ href: '/dictionary', label: '返回字典' });
  });
  it('returns rare-chars link for from=rare-chars', () => {
    expect(getSutraBackLink('rare-chars')).toEqual({ href: '/rare-chars', label: '返回罕见字库' });
  });
  it('returns sutras link for from=sutras', () => {
    expect(getSutraBackLink('sutras')).toEqual({ href: '/sutras', label: '返回经文目录' });
  });
  it('defaults to sutras for unknown source', () => {
    expect(getSutraBackLink('garbage')).toEqual({ href: '/sutras', label: '返回经文目录' });
  });
  it('defaults to sutras for undefined', () => {
    expect(getSutraBackLink(undefined)).toEqual({ href: '/sutras', label: '返回经文目录' });
  });
});
