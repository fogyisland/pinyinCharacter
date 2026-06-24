// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FontFamilyPicker } from '@/components/worksheet/FontFamilyPicker';

describe('FontFamilyPicker', () => {
  it('renders a <select> with 3 <optgroup>s: 系统字体, 硬笔字体, 毛笔字体', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const select = container.querySelector('select');
    expect(select).toBeInTheDocument();
    const groups = container.querySelectorAll('optgroup');
    expect(groups).toHaveLength(3);
    expect(groups[0]?.getAttribute('label')).toBe('系统字体');
    expect(groups[1]?.getAttribute('label')).toBe('硬笔字体');
    expect(groups[2]?.getAttribute('label')).toBe('毛笔字体');
  });

  it('renders 12 <option>s: 3 system + 3 hard-pen + 6 brush', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(12);
    const systemOptions = container.querySelectorAll('optgroup:nth-of-type(1) > option');
    const hardPenOptions = container.querySelectorAll('optgroup:nth-of-type(2) > option');
    const brushOptions = container.querySelectorAll('optgroup:nth-of-type(3) > option');
    expect(systemOptions).toHaveLength(3);
    expect(hardPenOptions).toHaveLength(3);
    expect(brushOptions).toHaveLength(6);
  });

  it('marks the current value as the selected option', () => {
    const { container } = render(<FontFamilyPicker value="yozai" onChange={vi.fn()} />);
    const select = container.querySelector('select')!;
    expect((select as HTMLSelectElement).value).toBe('yozai');
    const selected = container.querySelector('option[value="yozai"]');
    expect(selected?.getAttribute('value')).toBe('yozai');
  });

  it('calls onChange with the picked FontFamily', () => {
    const onChange = vi.fn();
    const { container } = render(<FontFamilyPicker value="song" onChange={onChange} />);
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'wenkai-gb' } });
    expect(onChange).toHaveBeenCalledWith('wenkai-gb');
  });

  it('shows brush font labels (马善政体 for ma-shan-zheng, 龙藏体 for long-cang)', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const m1 = container.querySelector('option[value="ma-shan-zheng"]');
    const m2 = container.querySelector('option[value="long-cang"]');
    expect(m1?.textContent).toBe('马善政体 (毛笔正书)');
    expect(m2?.textContent).toBe('龙藏体 (草书)');
  });

  it('lists all 6 brush font values in the brush optgroup', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const brushGroup = container.querySelectorAll('optgroup:nth-of-type(3) > option');
    const values = Array.from(brushGroup).map((o) => o.getAttribute('value'));
    expect(values).toEqual(['iansui', 'ma-shan-zheng', 'long-cang', 'liu-jian-mao-cao', 'zcool-xiaowei', 'zhi-mang-xing']);
  });
});
