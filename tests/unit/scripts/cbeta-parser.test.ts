import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCbetaXml } from '@/scripts/cbeta-parser';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cbeta-parser-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeXml(name: string, xml: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, xml, 'utf-8');
  return p;
}

// A minimal TEI P5 doc with 2 paragraphs in <body>, 1 <note> inside a paragraph,
// a <lb/> self-closing tag, a <g ref=...> gaiji placeholder, and a <cb:div> wrapper.
// Uses 繁体 throughout to also exercise the t→s conversion.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:cb="http://www.cbeta.org/ns/1.0" xml:id="T99n9999">
<teiHeader>
  <fileDesc>
    <titleStmt>
      <title level="s">Taish&#x14D; Tripi&#x1E6D;aka</title>
      <title level="m" xml:lang="zh-Hant">觀自在菩薩</title>
      <author>唐 玄奘譯</author>
    </titleStmt>
  </fileDesc>
</teiHeader>
<text><body>
<lb n="0001a01"/>
<cb:div type="jing">
<p xml:id="p1">觀<note>這是註腳</note>自在菩薩行深般若波羅蜜多時照見五<lb n="0001a02"/>蘊皆空。</p>
<p xml:id="p2">舍利子<g ref="#CB00001"/>色不異空空不異色。</p>
</cb:div>
</body></text>
</TEI>`;

describe('parseCbetaXml', () => {
  it('extracts title, author, juan, paragraphs (no markup, simplified)', () => {
    const xmlPath = writeXml('T99n9999_001.xml', SAMPLE_XML);
    const sutra = parseCbetaXml(xmlPath);
    expect(sutra.cbetaId).toBe('T99n9999');
    expect(sutra.title).toBe('观自在菩萨');
    expect(sutra.author).toContain('玄奘');
    expect(sutra.author).not.toContain('譯');
    expect(sutra.juan).toBe(1);
    expect(sutra.paragraphs.length).toBe(2);
    // 繁→简 verified
    expect(sutra.paragraphs[0]).toContain('观自在菩萨');
    expect(sutra.paragraphs[0]).not.toContain('觀');
    // note content removed
    expect(sutra.paragraphs[0]).not.toContain('註腳');
    expect(sutra.paragraphs[0]).not.toContain('这是注脚');
    // <lb> removed
    expect(sutra.paragraphs[0]).not.toContain('<lb');
    expect(sutra.paragraphs[0]).not.toMatch(/^\s*蘊/);
    // <g> removed
    expect(sutra.paragraphs[1]).not.toContain('<g');
    expect(sutra.paragraphs[1]).not.toContain('CB00001');
  });

  it('parses juan from filename suffix', () => {
    const p = writeXml('T01n0001_007.xml', SAMPLE_XML);
    expect(parseCbetaXml(p).juan).toBe(7);
  });

  it('falls back to cbetaId as title when no title element is present', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xml:id="T01n0002"><teiHeader><fileDesc><titleStmt><title level="s">NoTitle</title><author>無</author></titleStmt></fileDesc></teiHeader>
<text><body><p>無內容。</p></body></text></TEI>`;
    const p = writeXml('T01n0002_001.xml', xml);
    const sutra = parseCbetaXml(p);
    expect(sutra.title).toBe('T01n0002');
    expect(sutra.paragraphs).toEqual(['无内容。']);
  });

  it('filters to a specific <cb:mulu> section when keepOnlyMuluLabel is set', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xml:id="T09n0262"><teiHeader><fileDesc><titleStmt><title level="m" xml:lang="zh-Hant">妙法蓮華經</title><author>姚秦 鳩摩羅什譯</author></titleStmt></fileDesc></teiHeader>
<text><body>
<cb:div type="pin"><cb:mulu level="1" n="24" type="品">24 妙音菩薩品</cb:mulu>
<p>第一段妙音內容。</p>
</cb:div>
<cb:div type="pin"><cb:mulu level="1" n="25" type="品">25 觀世音菩薩普門品</cb:mulu>
<p>爾時無盡意菩薩即從座起。</p>
<p>佛告無盡意菩薩善男子。</p>
</cb:div>
<cb:div type="pin"><cb:mulu level="1" n="26" type="品">26 陀羅尼品</cb:mulu>
<p>陀羅尼品內容。</p>
</cb:div>
</body></text></TEI>`;
    const p = writeXml('T09n0262_007.xml', xml);
    const sutra = parseCbetaXml(p, { keepOnlyMuluLabel: '观世音菩萨普门品' });
    expect(sutra.paragraphs.length).toBe(2);
    expect(sutra.paragraphs[0]).toContain('无尽意菩萨');
    expect(sutra.paragraphs[0]).not.toContain('妙音');
    expect(sutra.paragraphs[1]).not.toContain('陀罗尼');
  });
});
