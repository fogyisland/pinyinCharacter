// @vitest-environment happy-dom
import { cleanup, render, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';

beforeEach(() => cleanup());

it('renders all hints at HSK 1', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  const cfg = { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false, onDemandPenalty: 1 };
  const { container } = render(
    <ToneRadicalChar
      char="你"
      slotKind="tone"
      matched={null}
      onDrop={vi.fn()}
      revealConfig={cfg as any}
      onDemandReveal={vi.fn()}
    />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="meaning"]')).toBeTruthy();
  expect(container.querySelector('[data-hint="radical"]')).toBeTruthy();
});

it('hides all hints at HSK 6; allows click-to-reveal', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  const cfg = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 1 };
  const onDemand = vi.fn();
  const { container, getByLabelText } = render(
    <ToneRadicalChar
      char="你"
      slotKind="tone"
      matched={null}
      onDrop={vi.fn()}
      revealConfig={cfg as any}
      onDemandReveal={onDemand}
    />
  );
  expect(container.querySelector('[data-hint="pinyin"]')).toBeFalsy();
  fireEvent.click(getByLabelText('显示拼音'));
  expect(onDemand).toHaveBeenCalledWith('pinyin');
});

it('at HSK 1 (allowOnDemandHints=false) no click-to-reveal button is shown', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  const cfg = { cellHints: ['pinyin'], allowOnDemandHints: false, onDemandPenalty: 1 };
  const { queryByLabelText } = render(
    <ToneRadicalChar
      char="你"
      slotKind="tone"
      matched={null}
      onDrop={vi.fn()}
      revealConfig={cfg as any}
      onDemandReveal={vi.fn()}
    />
  );
  expect(queryByLabelText('显示拼音')).toBeNull();
});

it('always renders DropSlot (drag-drop mechanic) regardless of reveal config', async () => {
  const { ToneRadicalChar } = await import('@/components/game/ToneRadicalChar');
  // HSK 1: all hints visible, but DropSlot must STILL be present
  // (the slot is a quiz answer the user drags onto, not a hint about the cell).
  const cfg = { cellHints: ['pinyin', 'meaning', 'radical'], allowOnDemandHints: false, onDemandPenalty: 1 };
  const onDrop = vi.fn();
  const { container } = render(
    <ToneRadicalChar
      char="你"
      pinyin="nǐ"
      radical="亻"
      meaning="you"
      slotKind="tone"
      matched={null}
      onDrop={onDrop}
      revealConfig={cfg as any}
      onDemandReveal={vi.fn()}
    />
  );
  const slot = container.querySelector('[data-slot="tone"]');
  expect(slot).toBeTruthy();
  expect(slot!.getAttribute('aria-label')).toBe('声调槽');
  // Empty slot shows '?' until matched.
  expect(slot!.textContent).toContain('?');
  // HSK 6: no hints, DropSlot still present.
  const cfg6 = { cellHints: [], allowOnDemandHints: true, onDemandPenalty: 1 };
  const { container: c6 } = render(
    <ToneRadicalChar
      char="好"
      slotKind="radical"
      matched="女"
      onDrop={onDrop}
      revealConfig={cfg6 as any}
      onDemandReveal={vi.fn()}
    />
  );
  expect(c6.querySelector('[data-slot="radical"]')).toBeTruthy();
  expect(c6.querySelector('[data-slot="radical"]')!.textContent).toContain('女');
});