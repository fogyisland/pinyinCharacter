import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';

describe('renderMarkdown', () => {
  it('renders ATX headings at 6 levels', () => {
    const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const out = renderMarkdown(md);
    expect(out).toContain('<h1 class="');
    expect(out).toContain('<h2 class="');
    expect(out).toContain('<h6 class="');
  });

  it('renders a paragraph', () => {
    const out = renderMarkdown('Hello world, this is a paragraph.');
    expect(out).toContain('<p class="text-ink-soft leading-relaxed my-3">');
    expect(out).toContain('Hello world');
  });

  it('joins consecutive lines into a single paragraph', () => {
    const out = renderMarkdown('Line one\nLine two\nLine three\n\nNew paragraph');
    expect(out).toContain('Line one Line two Line three');
    expect(out.match(/<p/g)?.length).toBe(2);
  });

  it('renders fenced code blocks with language tag', () => {
    const out = renderMarkdown('```bash\npnpm dev\n```');
    expect(out).toContain('data-lang="bash"');
    expect(out).toContain('<code>pnpm dev</code>');
  });

  it('renders fenced code blocks without language', () => {
    const out = renderMarkdown('```\nplain\n```');
    expect(out).toContain('<pre');
    expect(out).not.toContain('data-lang="');
  });

  it('renders unordered lists', () => {
    const out = renderMarkdown('- apple\n- banana\n- cherry');
    expect(out).toContain('<ul class="list-disc');
    expect(out).toContain('<li>apple</li>');
    expect(out).toContain('<li>banana</li>');
    expect(out).toContain('<li>cherry</li>');
  });

  it('renders ordered lists', () => {
    const out = renderMarkdown('1. first\n2. second\n3. third');
    expect(out).toContain('<ol class="list-decimal');
    expect(out).toContain('<li>first</li>');
  });

  it('renders bold and italic', () => {
    const out = renderMarkdown('**bold** and *italic*');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    const out = renderMarkdown('Use `pnpm dev` to start');
    expect(out).toContain('<code class="rounded bg-paper-deep');
    expect(out).toContain('pnpm dev');
  });

  it('does not apply bold/italic inside inline code', () => {
    const out = renderMarkdown('Code: `**not bold**` end');
    expect(out).not.toContain('<strong>not bold</strong>');
    expect(out).toContain('**not bold**');
  });

  it('renders external links with target=_blank rel=noopener', () => {
    const out = renderMarkdown('See [docs](https://example.com)');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://example.com"');
  });

  it('renders internal links without target=_blank', () => {
    const out = renderMarkdown('Go [home](/home) please');
    expect(out).toContain('href="/home"');
    expect(out).not.toContain('target="_blank"');
  });

  it('escapes HTML special chars in text', () => {
    const out = renderMarkdown('<script>alert("xss")</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>alert');
  });

  it('renders GFM tables', () => {
    const md = '| Name | Age |\n| --- | --- |\n| alice | 30 |\n| bob | 25 |';
    const out = renderMarkdown(md);
    expect(out).toContain('<table');
    expect(out).toContain('<th class="');
    expect(out).toContain('<td class="');
    expect(out).toContain('alice</td>');
    expect(out).toContain('30</td>');
    expect(out).toContain('bob</td>');
  });

  it('renders the README.md sample without crashing', () => {
    const md = `# 字 ↔ 拼音 工具

在线汉字与拼音互转工具。

## 功能（v1 / Plan A）

- 汉字 → 拼音：客户端实时转换
- 拼音 → 汉字：两种模式

## 启动

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| DATABASE_URL | ✓ | MySQL 连接串 |

**Note**: 这是一段 **bold** 和 *italic* 的文字。
`;
    const out = renderMarkdown(md);
    expect(out).toContain('<h1');
    expect(out).toContain('<h2');
    expect(out).toContain('<ul class="list-disc');
    expect(out).toContain('data-lang="bash"');
    expect(out).toContain('<table');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('handles headings followed immediately by a list', () => {
    const out = renderMarkdown('## Setup\n- step 1\n- step 2');
    expect(out).toContain('<h2');
    expect(out).toContain('<li>step 1</li>');
  });

  it('renders multiple paragraphs separated by blank lines', () => {
    const out = renderMarkdown('First para.\n\nSecond para.');
    expect(out.match(/<p/g)?.length).toBe(2);
    expect(out).toContain('First para.');
    expect(out).toContain('Second para.');
  });
});