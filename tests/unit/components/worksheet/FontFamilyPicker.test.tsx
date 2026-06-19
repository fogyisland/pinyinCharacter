// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FontFamilyPicker } from '@/components/worksheet/FontFamilyPicker';

describe('FontFamilyPicker', () => {
  it('renders a <select> with 2 <optgroup>s: 系统字体 and 硬笔字体', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const select = container.querySelector('select');
    expect(select).toBeInTheDocument();
    const groups = container.querySelectorAll('optgroup');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.getAttribute('label')).toBe('系统字体');
    expect(groups[1]?.getAttribute('label')).toBe('硬笔字体');
  });

  it('renders 7 <option>s: 3 in system, 4 in hard-pen', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(7);
    const systemOptions = container.querySelectorAll('optgroup:nth-of-type(1) > option');
    const hardPenOptions = container.querySelectorAll('optgroup:nth-of-type(2) > option');
    expect(systemOptions).toHaveLength(3);
    expect(hardPenOptions).toHaveLength(4);
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

  it('shows each option label (e.g. 霞鹜文楷 GB for wenkai-gb)', () => {
    const { container } = render(<FontFamilyPicker value="song" onChange={vi.fn()} />);
    const option = container.querySelector('option[value="wenkai-gb"]');
    expect(option?.textContent).toBe('霞鹜文楷 GB');
  });
});
