/**
 * scripts/perf/class-attribution.mjs — HTML → 字族归因。
 *
 * 页面上的同一个汉字可能用三款字渲染：正文字族（sans）、衬线字族（serif）、
 * 楷体（kai）。这个模块按**栈**遍历服务端 HTML，把每个文本节点归到它真正
 * 渲染时用的那一款字。
 *
 * 归属规则是**栈式**的，因为 `font-family` 会继承：一个元素渲染成哪款字，
 * 取决于它自己的 `font-*` class；自己没有，就继承父元素的那款；再往上没有，
 * 就是 `body` 的默认（sans，`app/globals.css:66`）。
 *
 * ⚠️ 第一版用的是「文本块的直属父元素的 class」，**这条规则是错的**
 * （F27-j-a）：Next.js SSR 会在相邻文本节点之间插 `<!-- -->`，
 * `<h3 class="font-kai">《<!-- -->在岳咏蝉<!-- -->》</h3>` 的直属父元素
 * class 抓对了，但正则 `([^<]*)` 抓到的文本只有 `《`——于是楷体集合被掏空，
 * 剩下的字全被算成 sans。已提交的 fixture 就是这样错的。
 *
 * 为什么要单独成模块：`data/font-page-profiles.json`（页面取字 fixture，Task 4 的
 * 采集器产出）与 `scripts/perf/font-load.mjs`（每页字体载荷测量，Task 9 产出）
 * 必须用**同一条**归因规则。两处各写一份，规则迟早漂移，于是 fixture 说的字符集
 * 和预算算的字符集不是一回事，测出来的载荷就是假的。
 */

import { isCjkChar, isLatinChar } from '../fonts/webfont-charset.mjs';

/** class 名 → 字族。 */
const FAMILY_BY_CLASS = {
  'font-kai': 'wenkai',
  'font-serif': 'serif',
  'font-sans': 'sans',
};

/** 没有任何字族 class 时的默认字族：`body` 用的是 sans。 */
const DEFAULT_FAMILY = 'sans';

/** 空元素：没有闭合标签，不能进栈。 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** 从 `class="..."` 里取 class 名列表。 */
export function classTokens(attrs) {
  const match = /class="([^"]*)"/.exec(attrs);
  if (!match) return [];
  return match[1].split(/\s+/).filter(Boolean);
}

/** 去掉 <script> / <style> 的内容——里面的中文不是页面文字。 */
export function stripScriptsAndStyles(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ');
}

/** 去掉 HTML 注释——注释里的中文不是页面文字。 */
export function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * 一个元素渲染成哪款字：自己的 `font-*` class，否则继承父元素的那款。
 */
export function familyOfAttrs(attrs, parentFamily) {
  const tokens = classTokens(attrs);
  for (const className of Object.keys(FAMILY_BY_CLASS)) {
    if (tokens.includes(className)) return FAMILY_BY_CLASS[className];
  }
  return parentFamily;
}

/**
 * 把一段 HTML 的汉字归到三个字族。
 *
 * @returns {{ sans: Set<string>, serif: Set<string>, wenkai: Set<string> }}
 */
export function collectFamilyCharsets(html) {
  return collectFamilySets(html, isCjkChar);
}

/**
 * 把一段 HTML 的**拉丁字符**归到三个字族。
 *
 * 与 `collectFamilyCharsets` 是同一个函数、同一条栈式归因规则，只是收的
 * 字符集不同（拉丁 vs 中文）。
 *
 * ⚠️ 归因规则只有一份：`collectFamilySets` 是唯一的实现，两个导出只是把
 * 不同的过滤器传给它。**不许**另写一份正则或另写一次栈遍历 —— 两份归因
 * 规则迟早漂移，于是 fixture 说的字符集和预算算的字符集不是一回事，
 * 测出来的载荷就是假的（这正是 F27-j-a 的教训）。
 *
 * @returns {{ sans: Set<string>, serif: Set<string>, wenkai: Set<string> }}
 */
export function collectFamilyLatinCharsets(html) {
  return collectFamilySets(html, isLatinChar);
}

/**
 * 把一段 HTML 的字符归到三个字族，收哪些字符由 `accept` 决定。
 *
 * @param {string} html 页面的 HTML
 * @param {(ch: string) => boolean} accept 收下这个字符吗
 * @returns {{ sans: Set<string>, serif: Set<string>, wenkai: Set<string> }}
 */
function collectFamilySets(html, accept) {
  const source = stripComments(stripScriptsAndStyles(html));
  const sets = { sans: new Set(), serif: new Set(), wenkai: new Set() };
  const stack = [{ tag: '#root', family: DEFAULT_FAMILY }];
  let inHead = false;
  let i = 0;
  const n = source.length;

  const addText = (text) => {
    if (inHead) return;
    const family = stack[stack.length - 1].family;
    for (const ch of text) {
      if (accept(ch)) sets[family].add(ch);
    }
  };

  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) { addText(source.slice(i)); break; }
    if (lt > i) addText(source.slice(i, lt));

    // 注释：整段跳过（`stripComments` 已经删了，这里是兜底）。
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // 声明（`<!DOCTYPE html>` 之类）：整段跳过。
    if (source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const closing = source[lt + 1] === '/';
    const nameStart = lt + (closing ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(source.slice(nameStart));
    if (!nameMatch) { i = lt + 1; continue; }
    const tag = nameMatch[0].toLowerCase();
    const end = source.indexOf('>', lt);
    if (end === -1) { addText(source.slice(lt)); break; }
    const attrs = source.slice(nameStart + tag.length, end).trim();

    if (closing) {
      if (tag === 'head') inHead = false;
      // 弹到最近的一个同名开标签为止。
      for (let s = stack.length - 1; s >= 1; s -= 1) {
        if (stack[s].tag === tag) { stack.length = s; break; }
      }
    } else {
      const selfClosing = source[end - 1] === '/';
      if (tag === 'head') inHead = true;
      const family = familyOfAttrs(attrs, stack[stack.length - 1].family);
      if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push({ tag, family });
    }
    i = end + 1;
  }
  return sets;
}
