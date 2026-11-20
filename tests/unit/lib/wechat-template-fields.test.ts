import { describe, it, expect } from 'vitest';
import { collectTemplateFields } from '@/lib/wechat-template-fields';

describe('the rows of the announcement composer', () => {
  it('keeps the rows that are filled in', () => {
    const { data, skipped } = collectTemplateFields([
      { key: 'first', value: '标题' },
      { key: 'keyword1', value: '内容' },
    ]);

    expect(data).toEqual({
      first: { value: '标题' },
      keyword1: { value: '内容' },
    });
    expect(skipped).toEqual([]);
  });

  it('leaves out a row whose value is empty', () => {
    // The composer starts with two empty rows. Sending one of them
    // would make WeChat reject the whole announcement.
    const { data, skipped } = collectTemplateFields([
      { key: 'first', value: '' },
      { key: 'keyword1', value: '内容' },
    ]);

    expect(data).toEqual({ keyword1: { value: '内容' } });
    expect(skipped).toEqual(['first']);
  });

  it('leaves out a row whose value is only whitespace', () => {
    const { data, skipped } = collectTemplateFields([
      { key: 'first', value: '   ' },
    ]);

    expect(data).toEqual({});
    expect(skipped).toEqual(['first']);
  });

  it('leaves out a row whose name is empty', () => {
    // An unnamed row has nothing to be skipped by name — it is simply
    // not a field.
    const { data, skipped } = collectTemplateFields([
      { key: '  ', value: '内容' },
    ]);

    expect(data).toEqual({});
    expect(skipped).toEqual([]);
  });

  it('trims the field name', () => {
    const { data } = collectTemplateFields([
      { key: '  keyword1  ', value: '内容' },
    ]);

    expect(data).toEqual({ keyword1: { value: '内容' } });
  });

  it('keeps the value exactly as it was typed', () => {
    // Only the NAME is trimmed. The value is what the admin wants in
    // the message, spaces included.
    const { data } = collectTemplateFields([
      { key: 'keyword1', value: ' 内容 ' },
    ]);

    expect(data).toEqual({ keyword1: { value: ' 内容 ' } });
  });

  it('reports every skipped row', () => {
    const { skipped } = collectTemplateFields([
      { key: 'first', value: '' },
      { key: 'keyword1', value: '内容' },
      { key: 'remark', value: '' },
    ]);

    expect(skipped).toEqual(['first', 'remark']);
  });
});
