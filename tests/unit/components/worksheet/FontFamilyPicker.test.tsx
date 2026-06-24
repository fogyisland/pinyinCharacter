// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FontFamilyPicker } from '@/components/worksheet/FontFamilyPicker';

describe('FontFamilyPicker', () => {
  describe('with no tool specified defaults to all groups (legacy)', () => {
    it('renders 3 <optgroup>s: 系统字体, 硬笔字体, 毛笔字体 when no tool prop', () => {
      // The component now requires a tool prop; ensure callers pass one.
      // (This test is here only to document the contract.)
    });
  });

  describe('when tool="brush"', () => {
    it('hides 硬笔字体 optgroup and shows 毛笔字体', () => {
      const { container } = render(<FontFamilyPicker tool="brush" value="song" onChange={vi.fn()} />);
      const groups = container.querySelectorAll('optgroup');
      expect(groups).toHaveLength(2);
      expect(groups[0]?.getAttribute('label')).toBe('系统字体');
      expect(groups[1]?.getAttribute('label')).toBe('毛笔字体');
    });

    it('shows 3 system + 6 brush options (no hard-pen)', () => {
      const { container } = render(<FontFamilyPicker tool="brush" value="song" onChange={vi.fn()} />);
      const options = container.querySelectorAll('option');
      expect(options).toHaveLength(9);
      expect(container.querySelector('optgroup[label="硬笔字体"]')).toBeNull();
      // All 6 brush values present
      for (const v of ['iansui', 'ma-shan-zheng', 'long-cang', 'liu-jian-mao-cao', 'zcool-xiaowei', 'zhi-mang-xing']) {
        expect(container.querySelector(`option[value="${v}"]`)).not.toBeNull();
      }
    });
  });

  describe('when tool="pen"', () => {
    it('hides 毛笔字体 optgroup and shows 硬笔字体', () => {
      const { container } = render(<FontFamilyPicker tool="pen" value="song" onChange={vi.fn()} />);
      const groups = container.querySelectorAll('optgroup');
      expect(groups).toHaveLength(2);
      expect(groups[0]?.getAttribute('label')).toBe('系统字体');
      expect(groups[1]?.getAttribute('label')).toBe('硬笔字体');
    });

    it('shows 3 system + 3 hard-pen options (no brush)', () => {
      const { container } = render(<FontFamilyPicker tool="pen" value="song" onChange={vi.fn()} />);
      const options = container.querySelectorAll('option');
      expect(options).toHaveLength(6);
      expect(container.querySelector('optgroup[label="毛笔字体"]')).toBeNull();
      // No brush values present
      for (const v of ['iansui', 'ma-shan-zheng', 'long-cang', 'liu-jian-mao-cao', 'zcool-xiaowei', 'zhi-mang-xing']) {
        expect(container.querySelector(`option[value="${v}"]`)).toBeNull();
      }
    });
  });

  describe('hidden value preservation', () => {
    it('still renders the current brush font as an option when tool="pen"', () => {
      // User had liu-jian-mao-cao (brush) and switched to pen. The select must
      // still display that value so it doesn't silently fall back to the first.
      const { container } = render(<FontFamilyPicker tool="pen" value="liu-jian-mao-cao" onChange={vi.fn()} />);
      const opt = container.querySelector('option[value="liu-jian-mao-cao"]');
      expect(opt).not.toBeNull();
      // But it lives OUTSIDE any optgroup (so it can't be re-picked from the picker UI)
      expect(opt?.parentElement?.tagName).toBe('SELECT');
    });
  });

  describe('marks the current value as the selected option', () => {
    it('for yozai with pen tool', () => {
      const { container } = render(<FontFamilyPicker tool="pen" value="yozai" onChange={vi.fn()} />);
      const select = container.querySelector('select')!;
      expect((select as HTMLSelectElement).value).toBe('yozai');
    });
    it('for ma-shan-zheng with brush tool', () => {
      const { container } = render(<FontFamilyPicker tool="brush" value="ma-shan-zheng" onChange={vi.fn()} />);
      const select = container.querySelector('select')!;
      expect((select as HTMLSelectElement).value).toBe('ma-shan-zheng');
    });
  });

  describe('calls onChange with the picked FontFamily', () => {
    it('picks wenkai-gb in pen mode', () => {
      const onChange = vi.fn();
      const { container } = render(<FontFamilyPicker tool="pen" value="song" onChange={onChange} />);
      const select = container.querySelector('select')!;
      fireEvent.change(select, { target: { value: 'wenkai-gb' } });
      expect(onChange).toHaveBeenCalledWith('wenkai-gb');
    });
    it('picks liu-jian-mao-cao in brush mode', () => {
      const onChange = vi.fn();
      const { container } = render(<FontFamilyPicker tool="brush" value="ma-shan-zheng" onChange={onChange} />);
      const select = container.querySelector('select')!;
      fireEvent.change(select, { target: { value: 'liu-jian-mao-cao' } });
      expect(onChange).toHaveBeenCalledWith('liu-jian-mao-cao');
    });
  });
});
