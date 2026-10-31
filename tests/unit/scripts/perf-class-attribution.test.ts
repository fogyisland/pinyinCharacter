import { describe, it, expect } from 'vitest';
import {
  classTokens,
  stripComments,
  collectFamilyCharsets,
  collectFamilyLatinCharsets,
} from '../../../scripts/perf/class-attribution.mjs';

describe('classTokens', () => {
  it('reads the class names out of an attribute string', () => {
    expect(classTokens('class="font-kai text-lg"')).toEqual(['font-kai', 'text-lg']);
  });

  it('returns an empty list when there is no class attribute', () => {
    expect(classTokens('id="a"')).toEqual([]);
  });
});

describe('stripComments', () => {
  it('drops an HTML comment', () => {
    expect(stripComments('<p>字<!-- 注释 -->词</p>')).toBe('<p>字词</p>');
  });
});

describe('collectFamilyCharsets', () => {
  it('puts kai and serif text in their own family and the rest in sans', () => {
    const html =
      '<p class="font-kai">楷</p><p class="font-serif">宋</p><p>黑</p>';
    const sets = collectFamilyCharsets(html);
    expect([...sets.wenkai]).toEqual(['楷']);
    expect([...sets.serif]).toEqual(['宋']);
    expect([...sets.sans]).toEqual(['黑']);
  });

  it('inherits the face of the parent when the element has no font class', () => {
    // `font-family` inherits. A span inside a font-kai heading is still
    // painted in the brand face. The old flat rule ("the class of the
    // immediate parent") put it in sans and emptied the kai set — that is
    // what produced the wrong fixture F27-j found.
    const sets = collectFamilyCharsets('<div class="font-kai"><span>楷</span></div>');
    expect([...sets.wenkai]).toEqual(['楷']);
    expect([...sets.sans]).toEqual([]);
  });

  it('inherits through several levels', () => {
    const sets = collectFamilyCharsets('<section class="font-serif"><p><em>宋</em></p></section>');
    expect([...sets.serif]).toEqual(['宋']);
    expect([...sets.sans]).toEqual([]);
  });

  it('ignores the Chinese inside script and style blocks', () => {
    const html =
      '<style>.x::after{content:"字"}</style><script>const a="文";</script><p>汉</p>';
    const sets = collectFamilyCharsets(html);
    expect([...sets.sans]).toEqual(['汉']);
  });

  it('ignores the Chinese inside comments', () => {
    const sets = collectFamilyCharsets('<p>汉</p><!-- 注释字 -->');
    expect([...sets.sans]).toEqual(['汉']);
  });

  it('does not push a void element onto the stack', () => {
    // A void element has no closing tag; pushing it would swallow the
    // rest of the document into its face.
    const sets = collectFamilyCharsets('<p class="font-kai">楷<br>续</p><p>黑</p>');
    expect([...sets.wenkai].sort()).toEqual(['楷', '续']);
    expect([...sets.sans]).toEqual(['黑']);
  });

  it('reads the text of a heading that Next.js splits with comment markers', () => {
    // Next.js SSR emits `<!-- -->` between adjacent text nodes:
    // <h3 class="font-kai text-lg">《<!-- -->在岳咏蝉<!-- -->》</h3>
    const sets = collectFamilyCharsets('<h3 class="font-kai">《<!-- -->在岳咏蝉<!-- -->》</h3>');
    expect([...sets.wenkai].sort()).toEqual(['在', '岳', '咏', '蝉'].concat(['》', '《']).sort());
  });

  it('reads the head of the document as nothing to paint', () => {
    const sets = collectFamilyCharsets('<head><title>标题</title></head><body><p>汉</p></body>');
    expect([...sets.sans]).toEqual(['汉']);
  });
});

describe('collectFamilyLatinCharsets', () => {
  it('puts the Latin characters of a page in the face that paints them', () => {
    const html =
      '<p class="font-kai">楷 Ā</p><p class="font-serif">宋 É</p><p>黑 á</p>';
    const sets = collectFamilyLatinCharsets(html);
    // ⚠️ The SPACE is a Latin character (U+0020 is the first code point of
    // the ASCII printable range): the pages paint spaces, and a space no
    // face claims is a space the browser draws with the system font.
    expect([...sets.wenkai]).toEqual([' ', 'Ā']);
    expect([...sets.serif]).toEqual([' ', 'É']);
    expect([...sets.sans]).toEqual([' ', 'á']);
  });

  it('leaves the Chinese characters to the Chinese collection', () => {
    // The two collections share ONE walk and ONE inheritance rule — only the
    // accepted characters differ. Two rules would drift, and a drifted rule
    // makes the fixture and the budget talk about different characters.
    const html = '<p class="font-kai">楷 Ā</p>';
    expect([...collectFamilyCharsets(html).wenkai]).toEqual(['楷']);
    expect([...collectFamilyLatinCharsets(html).wenkai]).toEqual([' ', 'Ā']);
  });

  it('inherits the face of the parent, like the Chinese collection does', () => {
    const sets = collectFamilyLatinCharsets(
      '<div class="font-serif"><p><em>É</em></p></div>',
    );
    expect([...sets.serif]).toEqual(['É']);
    expect([...sets.sans]).toEqual([]);
  });

  it('ignores the Latin inside script and style blocks', () => {
    const html = '<style>.x::after{content:"a"}</style><script>const a="b";</script><p>c</p>';
    expect([...collectFamilyLatinCharsets(html).sans]).toEqual([' ', 'c']);
  });
});
