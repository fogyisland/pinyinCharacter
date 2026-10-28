// @vitest-environment happy-dom
import { cleanup, render, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import type { RevealConfig } from '@/lib/reveal';

beforeEach(() => cleanup());

it('shows pinyin + meaning at HSK 1 (no radical in drag-match)', async () => {
  const { CharDropZone } = await import('@/components/game/CharDropZone');
  const cfg: RevealConfig = {
    cellHints: ['pinyin', 'meaning'],
    allowOnDemandHints: false,
    onDemandPenalty: 1,
  };
  const { container } = render(
    <CharDropZone
      charId="你"
      char="你"
      pinyin="nǐ"
      meaning="you"
      matchedPinyin={null}
      onDrop={vi.fn()}
      revealConfig={cfg}
      onDemandReveal={vi.fn()}
    />,
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="meaning"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="radical"]')).toBeFalsy();
});

it('hides everything at HSK 6; click-to-reveal only when allowOnDemandHints', async () => {
  const { CharDropZone } = await import('@/components/game/CharDropZone');
  const cfg: RevealConfig = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 1 };
  const onDemand = vi.fn();
  const { container, getByLabelText } = render(
    <CharDropZone
      charId="你"
      char="你"
      pinyin="nǐ"
      meaning="you"
      matchedPinyin={null}
      onDrop={vi.fn()}
      revealConfig={cfg}
      onDemandReveal={onDemand}
    />,
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeFalsy();
  fireEvent.click(getByLabelText('显示拼音'));
  expect(onDemand).toHaveBeenCalledWith('pinyin');
});

// 2026-07-04: T9 — preserve the drag-drop mechanic (per Task 8 fix
// lesson). The DropSlot (rendered as a dashed-border container with
// "拖动拼音到这里" placeholder) must remain regardless of reveal
// config so users can still drag pinyin tokens onto chars.
it('always renders DropSlot (drag-drop mechanic) regardless of reveal config', async () => {
  const { CharDropZone } = await import('@/components/game/CharDropZone');
  // HSK 1: hints visible, DropSlot must STILL be present.
  const cfg: RevealConfig = {
    cellHints: ['pinyin', 'meaning'],
    allowOnDemandHints: false,
    onDemandPenalty: 1,
  };
  const onDrop = vi.fn();
  const { container } = render(
    <CharDropZone
      charId="你"
      char="你"
      pinyin="nǐ"
      meaning="you"
      matchedPinyin={null}
      onDrop={onDrop}
      revealConfig={cfg}
      onDemandReveal={vi.fn()}
    />,
  );
  expect(container.textContent).toContain('拖动拼音到这里');
  // HSK 6: no hints, DropSlot still present (placeholder text remains).
  const cfg6: RevealConfig = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 1 };
  const { container: c6 } = render(
    <CharDropZone
      charId="好"
      char="好"
      pinyin="hǎo"
      meaning="good"
      matchedPinyin={null}
      onDrop={onDrop}
      revealConfig={cfg6}
      onDemandReveal={vi.fn()}
    />,
  );
  expect(c6.textContent).toContain('拖动拼音到这里');
});
