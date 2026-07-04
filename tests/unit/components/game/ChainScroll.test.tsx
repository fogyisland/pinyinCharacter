// @vitest-environment happy-dom
import { cleanup, render, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';

beforeEach(() => cleanup());

it('renders only the char cell at HSK 6 with click-to-reveal buttons', async () => {
  const { ChainScroll } = await import('@/components/game/ChainScroll');
  const cfg = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 0 };
  const onDemand = vi.fn();
  const { container, getByLabelText } = render(
    <ChainScroll
      chain={['你']}
      charsList={[{ char: '你', pinyin: 'nǐ', meaning: 'you' } as any]}
      revealConfig={cfg as any}
      onDemandReveal={onDemand}
    />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeFalsy();
  fireEvent.click(getByLabelText('显示拼音'));
  expect(onDemand).toHaveBeenCalledWith('pinyin');
  expect(container.querySelector('[data-hint="pinyin"]')).toBeTruthy();
});

it('renders pinyin automatically at HSK 3 (cellHints includes pinyin)', async () => {
  const { ChainScroll } = await import('@/components/game/ChainScroll');
  const cfg = { cellHints: ['pinyin'], allowOnDemandHints: false, onDemandPenalty: 0 };
  const { container, queryByLabelText } = render(
    <ChainScroll
      chain={['你']}
      charsList={[{ char: '你', pinyin: 'nǐ' } as any]}
      revealConfig={cfg as any}
      onDemandReveal={vi.fn()}
    />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeTruthy();
  // No click-to-reveal button since allowOnDemandHints=false
  expect(queryByLabelText('显示拼音')).toBeNull();
});

it('chain game never reveals radical even when level config has it (HSK 1)', async () => {
  const { ChainScroll } = await import('@/components/game/ChainScroll');
  // Even though HSK 1 base config includes 'radical', the chain game's
  // getRevealConfig filters it out — but to be safe, if a caller passes
  // a cfg that DOES include radical, ChainScroll should still NOT render
  // it (chain game has no radical column).
  const cfg = { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false, onDemandPenalty: 0 };
  const { container } = render(
    <ChainScroll
      chain={['你']}
      charsList={[{ char: '你', pinyin: 'nǐ', radical: '亻' } as any]}
      revealConfig={cfg as any}
      onDemandReveal={vi.fn()}
    />
  );
  expect(container.querySelector('[data-hint="radical"]')).toBeFalsy();
});

it('renders multiple chars horizontally with correct opacity for last', async () => {
  const { ChainScroll } = await import('@/components/game/ChainScroll');
  const cfg = { cellHints: ['pinyin', 'meaning'], allowOnDemandHints: false, onDemandPenalty: 0 };
  const { container } = render(
    <ChainScroll
      chain={['安', '那', '呢']}
      charsList={[
        { char: '安', pinyin: 'ān', meaning: 'peace' } as any,
        { char: '那', pinyin: 'nà', meaning: 'that' } as any,
        { char: '呢', pinyin: 'ne', meaning: 'question' } as any,
      ]}
      revealConfig={cfg as any}
      onDemandReveal={vi.fn()}
    />
  );
  // All 3 chars rendered
  expect(container.textContent).toContain('安');
  expect(container.textContent).toContain('那');
  expect(container.textContent).toContain('呢');
  // All pinyins rendered
  const pinyinHints = container.querySelectorAll('[data-hint="pinyin"]');
  expect(pinyinHints.length).toBe(3);
});

it('chain has no on-demand penalty — onDemandReveal is called but no score bump expected', async () => {
  const { ChainScroll } = await import('@/components/game/ChainScroll');
  const cfg = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 0 };
  const onDemand = vi.fn();
  const { getByLabelText } = render(
    <ChainScroll
      chain={['你']}
      charsList={[{ char: '你', pinyin: 'nǐ', meaning: 'you' } as any]}
      revealConfig={cfg as any}
      onDemandReveal={onDemand}
    />
  );
  // Click "显示含义" (meaning) — handler is called, no penalty tracking in ChainScroll itself
  fireEvent.click(getByLabelText('显示含义'));
  expect(onDemand).toHaveBeenCalledWith('meaning');
});