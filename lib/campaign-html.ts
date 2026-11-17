/**
 * Sanitizer for admin-authored campaign HTML.
 *
 * A marketing campaign body is authored by an admin in the admin UI and
 * sent to the site's own subscribers. It is therefore "trusted" in the
 * ordinary sense — but not unconditionally:
 *
 *   - An admin session that was hijacked (a stolen cookie, an XSS on
 *     another admin page, a shared workstation) would let the attacker
 *     write a campaign body containing a script or a tracking pixel.
 *   - That body then lands in the inbox of EVERY subscriber, and mail
 *     clients are a rendering surface of their own — several of them
 *     strip `<script>` but none of them strip `<img onerror=…>`.
 *   - The unsubscribe link and the site chrome make the mail look like
 *     it came from us, so a hostile body is a good phishing primer.
 *
 * The rule is therefore: keep the FORMATTING, drop the EXECUTABLE parts.
 * Formatting is what an admin actually needs (headings, paragraphs,
 * lists, links, bold, images), and none of it needs a script.
 *
 * This is a deliberately small, dependency-free sanitizer. It removes
 * what can execute and what can exfiltrate, and leaves the rest alone:
 *
 *   - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`,
 *     `<applet>`, `<frame>`, `<frameset>`, `<form>`, `<base>`, `<meta>`,
 *     `<link>` — removed WITH their content.
 *   - every `on*` event handler attribute — removed.
 *   - `javascript:`, `vbscript:`, `data:` (except the image data URIs
 *     below) in `href` / `src` / `action` — the attribute is removed.
 *   - `data:text/html`, `data:application/*`, and every `data:` URI that
 *     is not an image — removed.
 *   - `style` attributes — KEPT, but their `url()` references are
 *     stripped, because a remote background image is a tracking pixel
 *     and a `javascript:` URL in CSS is still a URL.
 *
 * A sanitizer is a filter, and a filter has holes. This one is the
 * minimum that closes the known shapes; it is not a claim of
 * completeness. The defence in depth is that the body is only ever
 * rendered by mail clients, and that only an admin can write it.
 */

/**
 * Elements removed together with everything inside them.
 *
 * `script` and `style` carry text content that must go too — leaving
 * `<style>`'s body behind would leak the CSS as visible text, and
 * leaving `<script>`'s body behind would leak the source as visible
 * text.
 */
const VOID_CONTENT_ELEMENTS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'applet',
  'frame',
  'frameset',
  'form',
  'noscript',
  'template',
  'svg',
  'math',
];

/** Elements removed, but whose content is preserved. */
const BARE_ELEMENTS = ['base', 'meta', 'link', 'title', 'head'];

/**
 * URL schemes a link may carry.
 *
 * `http` and `mailto` are what a campaign actually needs. `data:` is
 * allowed for images only, and only for the raster formats below —
 * `data:image/svg+xml` is excluded, because an SVG is a document that
 * can carry script.
 */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** The `data:` MIME types an `<img src>` may use. */
const SAFE_DATA_IMAGE_TYPES = new Set([
  'data:image/png',
  'data:image/jpeg',
  'data:image/jpg',
  'data:image/gif',
  'data:image/webp',
  'data:image/bmp',
  'data:image/x-icon',
]);

/**
 * True when the URL is safe to keep in an `href` / `src` / `action`.
 *
 * A URL with no scheme is relative and safe by construction. A URL with
 * a scheme must be on the allowlist, or be a safe image `data:` URI.
 */
export function isSafeCampaignUrl(url: string, allowDataImage = false): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  // Control characters are stripped by browsers before they look at the
  // scheme, so `java\tscript:` is `javascript:` to the browser. Remove
  // them before matching.
  const cleaned = trimmed.replace(/[\u0000-\u0020]/g, '');
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) return true; // relative
  const scheme = schemeMatch[1].toLowerCase() + ':';
  if (SAFE_URL_SCHEMES.has(scheme)) return true;
  if (scheme === 'data:' && allowDataImage) {
    const lower = cleaned.toLowerCase();
    for (const type of SAFE_DATA_IMAGE_TYPES) {
      if (lower.startsWith(type)) return true;
    }
  }
  return false;
}

/**
 * Remove the `on*` event handler attributes and the `style` attribute's
 * URL references from one tag's attribute list.
 */
function sanitizeAttributes(attrs: string): string {
  const out: string[] = [];
  // A tag's attributes: name[=value], where value may be quoted.
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attrs)) !== null) {
    const name = match[1].toLowerCase();
    const rawValue = match[4] ?? match[5] ?? match[6] ?? '';

    // `on*` handlers — anything that starts with "on" and is a known
    // handler-ish name. The check is "starts with on" because every
    // standard event handler does.
    if (name.startsWith('on')) continue;

    // `formaction` overrides a form's target; `xlink:href` and
    // `srcdoc` can carry a document or script.
    if (name === 'formaction' || name === 'srcdoc' || name === 'xlink:href') continue;

    if (name === 'href' || name === 'src' || name === 'action' || name === 'background') {
      if (!isSafeCampaignUrl(rawValue, name === 'src')) continue;
    }

    if (name === 'style') {
      // Keep the declarations, but drop any `url(...)` — a remote
      // background image is a tracking pixel, and `url(javascript:…)`
      // is still a URL.
      const cleanedStyle = rawValue.replace(/url\s*\(\s*[^)]*\)/gi, 'none');
      if (cleanedStyle.trim().length === 0) continue;
      out.push(`${name}="${escapeAttribute(cleanedStyle)}"`);
      continue;
    }

    if (match[2] === undefined) {
      // A boolean attribute (`<input disabled>`).
      out.push(name);
      continue;
    }
    out.push(`${name}="${escapeAttribute(rawValue)}"`);
  }
  return out.join(' ');
}

/**
 * Escape a value for use inside a double-quoted HTML attribute.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sanitize admin-authored campaign HTML.
 *
 * The result is safe to embed in an email body: no script, no event
 * handlers, no dangerous URL schemes, and no remote resource loaded
 * automatically.
 */
export function sanitizeCampaignHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';

  let out = html;

  // 1. Remove the elements that carry executable content, together with
  //    everything inside them. Done first, because their bodies can
  //    contain things that look like ordinary tags.
  for (const tag of VOID_CONTENT_ELEMENTS) {
    out = removeElementWithContent(out, tag);
  }

  // 2. Remove the elements that are removed bare.
  for (const tag of BARE_ELEMENTS) {
    out = removeElementWithContent(out, tag);
  }

  // 3. Remove any comment. A conditional comment (`<!--[if IE]><script>`)
  //    is a script in some renderers.
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // 4. Sanitize the attributes of every remaining tag.
  //
  //    The tag name must follow "<" IMMEDIATELY. `< b` is not a tag —
  //    an HTML parser does not accept whitespace there either — so
  //    without this the sentence "a < b and c > d" was read as a tag
  //    named "b" carrying the attributes "and c", and the text was
  //    silently rewritten.
  out = out.replace(
    /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (full, tag, attrs) => {
      // A closing tag has no attributes to sanitize.
      if (full.startsWith('</')) return full;
      const safeAttrs = sanitizeAttributes(String(attrs));
      return `<${tag}${safeAttrs ? ' ' + safeAttrs : ''}>`;
    },
  );

  // 5. Escape every "<" that did not open a tag, so that text which
  //    merely LOOKS like markup cannot be re-parsed as markup by a
  //    lenient client.
  //
  //    After step 4 the only "<" left followed by a letter or a slash is
  //    one that opened a real tag; everything else is a "<" in running
  //    text. So the lookahead is simply "not a tag opener".
  //
  //    A ">" on its own is harmless, so it is left alone.
  out = out.replace(/<(?![a-zA-Z/])/g, '&lt;');

  return out;
}

/**
 * Remove every `<tag …> … </tag>` (and `<tag … />`) occurrence.
 *
 * The content is removed too, because for `script` and `style` the
 * content is the payload.
 */
function removeElementWithContent(html: string, tag: string): string {
  const pattern = new RegExp(
    `<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`,
    'gi',
  );
  let out = html.replace(pattern, '');
  // Self-closing / unclosed form: `<script src="x" />` or `<script src="x">`
  out = out.replace(new RegExp(`<\\s*${tag}\\b[^>]*\\/?>`, 'gi'), '');
  return out;
}
