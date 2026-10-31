# scripts/perf —— 性能基线探针

这个目录里是本仓库的**性能基线**：三个可以重复跑的探针，把「到底快了多少」变成一条条可以进 CI 的断言。它们不产生任何用户可见的收益，只负责**量**。

| npm script           | 脚本              | 量什么                                                                                                     | 门禁                                                   |
| -------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `npm run perf:ttfb`  | `paired-ttfb.mjs` | 服务端渲染的 delta：页面首字节时间减去同一连接上静态基线（`GET /manifest.json`）的首字节时间，取**中位数** | ≤ **+24 ms**                                           |
| `npm run perf:fonts` | `font-load.mjs`   | 每页的 webfont 载荷（按字族分开算）与字体文件数                                                            | ≤ **330 KB/页**（`/poetry` ≤ 240 KB）、≤ **12** 个文件 |
| `npm run perf:load`  | `full-load.mjs`   | 冷加载：HTML + CSS + JS + 字体一次下完的总字节与总耗时                                                     | ≤ **5 s**（首屏）                                      |

三个脚本都是**纯 ESM + Node 内置模块**，不需要构建步骤，直接 `node scripts/perf/*.mjs` 就能跑，也不引入任何新的运行时依赖。

## 共用参数

```
--base <url>     读哪个站点，默认 https://ziyun.pudafo.com
--cookie <值>    发哪个 Cookie，默认 setup_completed=1
--cookie ''      **故意不发 Cookie**（用来复现下面那个闸门，自检用）
```

`paired-ttfb.mjs` 另有 `--samples <n>`（默认 15），`full-load.mjs` 另有 `--path <p>`（默认 `/`）。

## ⚠️ 自检：为什么必须带 cookie

站点的初始化闸门（`middleware.ts:92-100`）**只看一个 cookie**。没有 `Cookie: setup_completed=1` 的请求**一律 307 跳 `/init`**，而那个 307 的响应体**只有 5 个字节**（字面量 `/init`）。

这是测量里最坏的一种坑：

- `font-load.mjs` 会从那 4 个字符里解析出约 **0 KB** 的字体载荷，然后**通过**预算；
- `full-load.mjs` 会给一次 5 字节的跳转计时，然后**通过**冷加载门禁；
- `paired-ttfb.mjs` 量的是中间件的重定向路径，不是页面渲染，**+24 ms** 的门禁什么也没量。

**三个探针都会报绿，而它们其实什么都没测。**

所以 `fetch-page.mjs`（三个探针共用）在把页面交给测量之前**先自检**：状态码必须是 **200**、`Content-Type` 必须以 **`text/html`** 开头、响应体必须 **> 10 000 字节**。任何一条不满足就**抛错**，三个探针捕获它并**以非零退出码结束，绝不打印任何载荷数字**。错误信息会写明**是哪一条不满足**以及**实际响应是什么**。

这条判定逻辑**只写在 `fetch-page.mjs` 一处**——三份拷贝会漂，而漂掉的拷贝就是一个报绿却什么都没量的探针。

自检只作用于**被测页面**。`paired-ttfb.mjs` 的静态基线 `GET /manifest.json` 是 442 B 的 `application/json`（带不带 cookie 都是 200），只查状态码。

自检自证（**必须非零退出**）：

```bash
node scripts/perf/font-load.mjs --cookie ''
# [perf:fonts] the probe failed: the page https://ziyun.pudafo.com/ did not pass the self check:
#   the status is 307, it must be 200; the content type is "", it must start with "text/html";
#   the body is 5 B, it must be more than 10000 B. The response was status 307, content-type "",
#   5 B, location "/init". — the site redirects to /init when the setup cookie is missing,
#   so this is the GATE and not the page
```

## ⚠️ css2 vs 仓库产物：版本错位，不是回归

`font-load.mjs` 读的是**本仓库发布的样式表** `public/font/fonts-{sans,serif,wenkai}.css`（Task 3 的产物），并按 `@font-face` 的 `unicode-range` 把页面的字符映射到磁盘上的 woff2 文件（`public/font/web/<dir>/<file>`），字节数是**磁盘上的原始字节**（与校验器 `verify-webfont-subsets.mjs` 的 `content.length` 同口径，两边数字可直接对照）。

**线上站点可能提供的是另一份构建**——Google Fonts CDN 那套 css2 构建，它的 face 指向 `/font/noto-sans-sc/<hash>.woff2` 这样的路径，`?v=` 令牌与本仓库不同，分档也不同。探针会**检测到**这个错位（线上样式表的 `?v=` 令牌 ≠ 本仓库的版本）并**明确说出来**：

```
[perf:fonts] WARNING: the live site serves the font stylesheets as v=<线上令牌>, this repository ships v=<仓库令牌>
[perf:fonts]   the live site therefore runs a DIFFERENT font build (the css2 build of the Google Fonts CDN cuts the fonts differently and carries another ?v= token)
[perf:fonts]   the payload below is the payload of the REPOSITORY build — a difference against the live site is a VERSION SKEW, not a performance regression
```

⇒ **这些数字与线上对不上，是版本错位，不是性能回归。** 下一个读数字的人必须先看这行 WARNING，别把它当成回退。

## 归因规则只有一份

HTML → 字族的映射**一律调用 Task 4 的 `class-attribution.mjs`（`collectFamilyCharsets()`）**，本目录**不重写**那条规则：它是**栈式**的（元素自己的 `font-kai` / `font-serif` / `font-sans` class 决定它渲染成哪款字，没有就继承父元素，再没有就是 `body` 的 sans），fixture `data/font-page-profiles.json` 和 `font-load.mjs` 的预算核算必须用同一条规则，否则测出来的载荷是假的。

## 读数字的几个约定

- **线上内容是动态的**：同一页在不同时刻的字节数会漂（`/` 实测过 45 883 / 45 919 / 45 957 B），所以断言写成**带容差的预算**，不拿某一次快照当精确基线。
- **`full-load.mjs` 像浏览器一样并行下载**（同时 6 个，浏览器每个站点的连接数上限）：5 s 的门禁是**首屏**的门禁，是按浏览器下载出来的；一个接一个下载量到的是「文件数 × 往返时间」，那个数说明不了站点的问题。即便如此，这个时间**仍然带着本机到服务器的往返时间**（本机实测约 300 ms/次），离服务器越远这个数越大 —— 要比较两个时间，必须在**同一台机器**上跑。
- **`font-load.mjs` 的字节是磁盘字节**，`full-load.mjs` 的字节是**过网的字节**（gzip/brotli 协商之后），两个口径不同，不要混着比。
- **门禁失败一律非零退出**，文案说真话（G12）：绝不报绿。
