/**
 * Parse a CBETA TEI P5 XML file into structured sutra chunks.
 *
 * The CBETA XML format has a consistent structure:
 *   <TEI><teiHeader>...</teiHeader><text><body>
 *     <cb:div type="...">...<p>paragraphs...</p>...</cb:div>
 *   </body></text></TEI>
 *
 * We extract:
 *   - title from <titleStmt><title level="m" xml:lang="zh-Hant">
 *   - author from <author>
 *   - paragraphs from <p> blocks (skipping <note> footnotes)
 *
 * The CBETA markup we strip:
 *   - <lb n="..."/> (line breaks)
 *   - <note>...</note> (footnotes)
 *   - <g ref="#CBxxxxx"/> (gaiji placeholders)
 *   - <cb:...> tags (keep text content)
 *
 * We use regex extraction (not a real XML parser) because the structure is
 * well-defined and consistent. Falls back gracefully when content is missing.
 */
import * as OpenCC from 'opencc-js';
import { readFileSync } from 'node:fs';

export interface CbetaSutra {
  /** Simplified Chinese title, e.g. "心经" */
  title: string;
  /** Author/translator, simplified */
  author: string;
  /** CBETA T-number, e.g. "T08n0251" */
  cbetaId: string;
  /** Volume (juan) number — 1 for single-juan files */
  juan: number;
  /** Simplified paragraphs in order */
  paragraphs: string[];
}

// 繁→简 for cn site (CBETA XML is in 繁体)
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

function t2sStr(s: string): string {
  return s ? t2s(s).trim() : '';
}

/**
 * Extract the first text content from inside a self-closing / simple element.
 * Returns '' if not found. Strips inner XML.
 */
function firstElementText(xml: string, tag: string): string {
  // Use a non-greedy match for the element body
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1]!.trim() : '';
}

/**
 * Get an attribute value from the first matching tag in the XML.
 */
function firstAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*?\\b${attr}="([^"]*)"`, 'i'));
  return m ? m[1]! : '';
}

/**
 * Strip all CBETA inline markup from a piece of text:
 *  - <lb .../> self-closing line-break tags
 *  - <note ...>...</note> blocks (with their text) — including NESTED notes
 *    (CBETA does nest <note> inside <app> inside <note> for sub-variants)
 *  - <g ref="..."/> gaiji references
 *  - All <cb:...> opening/closing tags, but keep their inner text
 *  - <app>...</app> apparatus criticus — keep only the <lem> (base) reading;
 *    discard all <rdg> variants. Nested <app> inside <lem> is resolved
 *    recursively so the base reading has no variant markers in it.
 *  - <space .../> whitespace markers
 *
 * Returns plain simplified text with no markup.
 */
function stripMarkup(text: string): string {
  // Handle nested <note>/<app> by a multi-pass loop. Each pass removes the
  // INNERMOST pair (the negative lookahead `(?!<tag\b)` blocks the regex
  // from crossing another open tag, so the match stops at the matching
  // close — the engine can no longer greedily eat through an inner close
  // tag and leave trailing note text orphaned). Repeat until stable.
  const stripInnermost = (tag: string, replacer: (m: string) => string) => {
    const re = new RegExp(`<${tag}\\b[^>]*>((?:(?!<${tag}\\b)[\\s\\S])*?)<\\/${tag}>`, 'g');
    let prev: string;
    do {
      prev = text;
      text = text.replace(re, replacer);
    } while (text !== prev);
  };

  // 1) Remove all <note>...</note> blocks (innermost first). Notes contain
  //    editorial apparatus (variant markers like ＝【宮】) that's not part
  //    of the sutra text.
  stripInnermost('note', () => '');
  // 2) Remove orphan <note>/</note> tags left over when an inner note was
  //    removed before the outer one (non-greedy regex nested edge case).
  text = text.replace(/<\/?note\b[^>]*>/g, '');

  // 3) Remove <lb .../>, <g .../>, <space .../> self-closing tags.
  text = text
    .replace(/<lb\b[^>]*\/?>/g, '')
    .replace(/<g\b[^>]*\/?>/g, '')
    .replace(/<space\b[^>]*\/?>/g, '');

  // 4) Strip <cb:...> tag wrappers (keep content).
  text = text.replace(/<\/?cb:[^>]+>/g, '');

  // 5) Resolve <app>...</app> blocks: keep only the <lem> (base) reading,
  //    dropping all <rdg> variants. Innermost-first so nested apps
  //    resolve before their parent.
  stripInnermost('app', (m) => {
    const lem = m.match(/<lem\b[^>]*>([\s\S]*?)<\/lem>/);
    return lem ? lem[1]! : '';
  });
  // 6) Strip orphan <app>/<rdg>/<lem>/etc. wrappers.
  text = text.replace(/<\/?(?:app|rdg|lem|anchor|w|tt|t|pb|milestone)\b[^>]*>/g, '');

  // 7) Remove any remaining empty/self-closing tags (catch-all).
  text = text
    .replace(/<[a-z]+:[^>]+\/>/gi, '')
    .replace(/<[a-z]+:[^>]+><\/?[a-z]+:[^>]+>/gi, '');

  // 8) Convert any remaining numeric character references that survived.
  text = text.replace(/&#xFE0F;?/g, '');

  // 9) Defense in depth: strip any CBETA apparatus witness markers that
  //    leaked through. If regex stripping ever fails on a deeply nested
  //    structure, we'd rather drop the markers than ship 【大】/【甲】/【CB】
  //    in the canonical text. See memory: cbeta-sutra-intros.
  text = text.replace(/【[一-鿿]+】/g, '');

  // 10) Collapse whitespace.
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract a balanced list of <p>...</p> blocks from inside a chunk of XML.
 * Handles nested <note>, <cb:...> etc. that may appear within <p> by treating
 * them as opaque to the outer <p> balance.
 */
function extractParagraphs(xml: string): string[] {
  const result: string[] = [];
  const re = /<p\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const start = m.index + m[0].length;
    // Find the matching </p> by scanning for any </p>, counting inner <p>...</p> + <note>...</note>
    let depth = 1;
    let i = start;
    while (i < xml.length && depth > 0) {
      const next = xml.indexOf('</p>', i);
      if (next < 0) break;
      // Look for inner <p> opens between i and next
      const segment = xml.slice(i, next);
      const innerOpens = (segment.match(/<p\b[^>]*>/g) || []).length;
      depth = depth + innerOpens - 1;
      if (depth === 0) {
        result.push(xml.slice(start, next));
        i = next + 4;
        re.lastIndex = i;
        break;
      } else {
        // keep scanning
        const innerClose = xml.indexOf('</p>', next + 4);
        if (innerClose < 0) break;
        i = innerClose + 4;
      }
    }
  }
  return result
    .map(stripMarkup)
    .map((s) => t2s(s))
    .filter((s) => s.length > 0);
}

/**
 * Extract paragraphs only from a specific <cb:div> whose <cb:mulu> matches the
 * given label (e.g. "观世音菩萨普门品"). The mulu label is matched against the
 * mulu text after t→s conversion.
 */
function extractMuluDivParagraphs(xml: string, muluLabel: string): string[] {
  // Find all top-level <cb:div ...>...</cb:div> blocks (not nested),
  // by scanning linearly. For each one, check if it contains a matching mulu.
  const targetSimple = t2s(muluLabel);
  const divRe = /<cb:div\b[^>]*>/g;
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = divRe.exec(xml)) !== null) {
    const start = m.index;
    // Find matching </cb:div> by counting depth
    let depth = 1;
    let i = start + m[0].length;
    while (i < xml.length && depth > 0) {
      const openIdx = xml.indexOf('<cb:div', i);
      const closeIdx = xml.indexOf('</cb:div>', i);
      if (closeIdx < 0) break;
      if (openIdx >= 0 && openIdx < closeIdx) {
        depth++;
        i = openIdx + 1;
      } else {
        depth--;
        i = closeIdx + 9;
      }
    }
    const divBody = xml.slice(start, i);
    // Check for matching mulu
    const muluRe = /<cb:mulu\b[^>]*>([\s\S]*?)<\/cb:mulu>/g;
    let mu: RegExpExecArray | null;
    let matched = false;
    while ((mu = muluRe.exec(divBody)) !== null) {
      const t = t2s(mu[1]!.replace(/<[^>]+>/g, '').trim());
      if (t === targetSimple || t.includes(targetSimple) || targetSimple.includes(t)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      result.push(...extractParagraphs(divBody));
    }
  }
  return result;
}

export function parseCbetaXml(xmlPath: string, opts?: { keepOnlyMuluLabel?: string }): CbetaSutra {
  const raw = readFileSync(xmlPath, 'utf-8');

  // cbetaId from the root <TEI xml:id="...">
  const cbetaId = firstAttr(raw, 'TEI', 'xml:id') || '';

  // Title: prefer <title level="m" xml:lang="zh-Hant">
  let titleHant = '';
  const titleM = raw.match(/<title\b[^>]*\blevel="m"[^>]*\bxml:lang="zh-Hant"[^>]*>([\s\S]*?)<\/title>/);
  if (titleM) {
    titleHant = stripMarkup(titleM[1]!);
  } else {
    // Fallback to any <title xml:lang="zh-Hant">
    const t2 = raw.match(/<title\b[^>]*\bxml:lang="zh-Hant"[^>]*>([\s\S]*?)<\/title>/);
    if (t2) titleHant = stripMarkup(t2[1]!);
  }
  if (!titleHant) titleHant = cbetaId;

  // Author
  const author = stripMarkup(firstElementText(raw, 'author'));

  // juan: parse from filename suffix if present (e.g. ..._001.xml = juan 1)
  let juan = 1;
  const fn = xmlPath.split(/[/\\]/).pop() || '';
  const juanM = fn.match(/_(\d{3,})\.xml$/);
  if (juanM) juan = parseInt(juanM[1]!, 10);

  // Body region: <text><body>...</body></text>
  const bodyMatch = raw.match(/<text\b[^>]*>\s*<body\b[^>]*>([\s\S]*?)<\/body>\s*<\/text>/);
  const body = bodyMatch ? bodyMatch[1]! : raw;

  // Paragraphs
  let paragraphs: string[];
  if (opts?.keepOnlyMuluLabel) {
    paragraphs = extractMuluDivParagraphs(body, opts.keepOnlyMuluLabel);
    if (paragraphs.length === 0) {
      // Fall back to whole-body extraction if mulu not found
      paragraphs = extractParagraphs(body);
    }
  } else {
    paragraphs = extractParagraphs(body);
  }

  return {
    title: t2sStr(titleHant) || cbetaId,
    author: t2sStr(author),
    cbetaId,
    juan,
    paragraphs,
  };
}
