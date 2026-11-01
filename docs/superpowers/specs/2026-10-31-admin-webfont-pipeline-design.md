# 后台字体流水线（/admin/settings/webfonts）设计文档

> **状态**：待用户批准（本文是本功能的**唯一需求来源**；实施计划另写）。
> **分支**：另开分支（`feature/admin-webfont-pipeline`），从 wave-2 的收尾 tip 切出。
> **与 wave-2 的关系**：本功能**不改** wave-2 的 spec
> （`docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`），
> 也**不改** wave-2 的切分算法与预算。它只是把 wave-2 已经建好的那条流水线
> **搬进后台，让管理员能自己跑**。凡是需要改 wave-2 既有脚本的地方，本文件
> §3.7 逐条列出「改什么、为什么必须改」。

---

## 1. 背景

用户的原话有两句，本功能是第二句的落地：

1. **「不要引用云端字体，提供字体下载到本地方法，避免引用云端导致体验差」**
   —— wave 2 已经做完：源字体从 `raw.githubusercontent.com/google/fonts` 拉到
   `scripts/fonts/staging/web/`，再切分成 7 981 个本地 woff2。方法写在
   `docs/superpowers/notes/2026-10-31-site-optimization-wave2-implementation.md` 的附录 A。
2. **「字体下载放到后台配置中的一个界面」** —— 现在这套流程**只有 4 条 npm 脚本**，
   只有能进开发者本机的���能跑。管理员（= 有服务器 shell 权限的那个人）想让
   **语料更新后自己在后台点几下就把字体重建好**，而不是找人改代码。

**现状的事实**（这些是设计的地基，不是猜测）：

| 事实 | 证据 |
|---|---|
| 切分产物**已入 git** | `git ls-files 'public/font/web/*.woff2'` = **7 981** 个 woff2（另有 3 份 OFL 许可证 ⇒ `public/font/web` 下共 7 984 个文件）；真实字节 **28 249 296 B ≈ 26.94 MB**（`du -sh` 报 41 MB 那是 7 984 个小文件的 4 KB 块对齐开销，不是真实体积） |
| 重建的**输入**是源字体 + **语料**（诗/故事/字典），不是仓库里的产物 | `scripts/fonts/webfont-charset.mjs` 从 `data/` 下的语料文件统计频率 |
| 语料**每天都在长**（新诗、新故事、新字）⇒ 切分产物**会过期** | `data/` 下有按日期命名的语料批次 |
| 四步流水线**已经存在且各有脚本** | `fonts:download-web` → `fonts:instance-web` → `fonts:subset-web` → `fonts:verify-webfont` |
| 每一步的**失败语义都已经很严**（非零退出、文案说真话） | 见 wave-2 实施记录附录 A |
| 后台**已有**「站点」分组与 `/admin/settings/*` 的页面先例 | `components/admin/AdminSidebar.tsx:105-111`；`app/admin/settings/fonts/page.tsx` |
| 后台**已有**审计日志约定 | `lib/audit.ts` 的 `logUserAction(req, userId, action, metadata)` |
| `lib/font-css.ts` 的 `?v=` 令牌来自**构建期**读进来的 `fonts-manifest.json` | `import manifest from '@/public/font/fonts-manifest.json'` |

⇒ **这个后台页面的价值不是「把字体传上去」，而是「把重建整条流水线跑起来」。**

---

## 2. 目标 / 非目标 / 反目标

### 2.1 目标（可测）

| 编号 | 目标 |
|---|---|
| **G-1** | 管理员在 **`/admin/settings/webfonts`** 一页内跑完 **下载 → 轴裁剪 → 切分 → 校验** 四步，**每一步的进度与失败都能看到** |
| **G-2** | 产物**先落 staging**；只有管理员**显式点「应用」**才切到线上目录；不点就永远不动线上 |
| **G-3** | 应用后**不产生豆腐块**：任何一份**曾经发布过**的样式表，它引用的字体文件**必须仍然存在且内容不变** —— ⚠️ 这条对**仍然保留的 release** 成立；被清理掉的 release 会让那份样式表指向 404 ⇒ 回退**系统 CJK 字体**（**不是豆腐块**，但字形不同，§3.5.4 末段） |
| **G-4** | 缺能力（Python / fontTools / 网络 / 磁盘 / **构建工具链依赖**）**明确报错并说清怎么装**；**绝不**假装成功、绝不静默跳过 |
| **G-5** | 每次「开始构建」「构建失败」「应用」「应用失败」都进**审计日志** |
| **G-6** | 零新增运行时依赖（G3）；零云端字体请求（页面上线后不引用任何 CDN 字体） |

### 2.2 非目标（本波明确不做）

- **不做**字体上传 / 自定义字体源（只从上游固定清单下载）。
- **不做**在后台调热区字数、Ext 块宽、字符集白名单（那些是 wave-2 的设计参数，
  改它们 = 改 wave-2 的 spec 与切分计划，超出本功能）。
- **不做**在服务器上跑 **Next.js 的** `npm run build`（理由见 §3.5.5）。
  ⚠️ **这条只禁 Next 构建，不禁字体流水线** —— §3.4 的能力探针查的就是**这台服务器**，
  四步流水线（下载 / 轴裁剪 / 切分 / 校验）**本来就要在这台服务器上跑**。
  两者碰巧都叫 `npm run`，但是一件不同的事：一个是 43 MB 静态资源 + Next 编译，
  一个是 Node 拉起子进程（Python + npm 包）。
- **不做**多版本 release 的自动回滚 UI（本波只保留旧 release，不做一键回退）。
- **不做**把下载/切分搬出 Node（不引入 Rust/Go/WASM 工具链）。

### 2.3 反目标（做成这些算失败）

- 让**发布目录**出现「样式表引用了不存在的文件」或「文件内容与它声明的 unicode-range 不符」
  ⇒ **豆腐块**（wave-2 的头号反目标）。
- 让一个**没有验证过**的构建进入线上目录。
- 让后台页面**在服务器没有 Python 时**显示「成功」。
- 让**上一次**任务的状态**串到**这一次（并发/重入串味）。

---

## 3. 方案

### 3.1 页面与导航

- 新页面：**`app/admin/settings/webfonts/page.tsx`**，
  与 `app/admin/settings/fonts/page.tsx` 同构：
  `requireAdmin()` → 取数据 → 渲染客户端组件；`export const dynamic = 'force-dynamic'`。
- 导航：加进 **`站点`** 分组（`components/admin/AdminSidebar.tsx` 的
  `ADMIN_NAV_GROUPS`），文案 **「网站字体」**，图标沿用 lucide 的 `Type`
  （与「字源字体」同族但不同项；实施时若 `Type` 已占用则用 `Type` 的近邻图标）。
  ⚠️ 导航是**扁平平铺**的约定（≤10 项/组），加一项后 `站点` 组变 4 项，不破约定。
- 页面分四块：
  1. **能力面板**（服务器具备什么、缺什么、怎么装；§3.4）；
  2. **构建面板**（四步进度 + 日志 + 「开始构建」/「取消」）；
  3. **应用面板**（staging 里的产物摘要 + 「应用」按钮 + 应用后的说明
     ＋ **「待回灌」提示** ＋ **「要重标定的钉死数字」表**，§3.5.8 / §3.5.9）；
  4. **release 列表**（台账、磁盘占用、可否清理的**建议** + 单独的「清理」按钮，§4.1 / §4.2）。

### 3.2 任务模型：异步任务 + 轮询

用户已选定「异步任务 + 轮询进度」。落法：

- **状态存 MySQL**（不是内存）：表 `webfont_build_jobs`。
  理由：构建要跑几分钟，Next.js 进程重启 / dev 热重载 / 多进程部署都可能让
  内存态丢失；DB 态还能顺带留下审计与历史。
  ⚠️ 本仓库**没有 CI**，也没有现成的作业队列 ⇒ 用「**一行一作业**」的简单模型：
  **同一时刻只允许一个活跃作业**（全局互斥，见 §3.2 的「并发闸门」）。
- **轮询**：前端每 **1.5 s** `GET /api/admin/webfonts/build/[id]`，
  页面打开时先 `GET /api/admin/webfonts/build` 拿最近 10 条历史。
- **进度模型**：每步一个状态机
  `pending → running → done | failed | skipped`，
  外加 `cancelled`。进度百分比**按步骤数**给（0/25/50/75/100），
  **不编造细粒度百分比**（切分那一步内部没有可信的进度源 ⇒ 只给「正在切分第 N 族」这种**文本**）。

**并发闸门**（防串味，防重复构建）：
- 开工前在 DB 里查「有没有 `status ∈ {pending, running}` 的作业」⇒ 有就**拒绝**（409）
  并把那条作业的 id 返给前端（前端可以跳去看它）。
- 进程内再加一道 `globalThis` 上的**互斥标志**（与 wave-2 的 `/init` token
  修复同款做法：模块级 `Map` 会在 dev 热重载后丢，必须挂 `globalThis`）。
  ⇒ **两道闸门都要有**：DB 是跨进程的真相，`globalThis` 是同进程内的快速拒绝。

### 3.3 四步流水线

每一步都是**现有脚本/函数**，只是由后台调用。**不改切分逻辑。**

| 步 | 做什么 | 复用谁 | 产物 | 失败语义 |
|---|---|---|---|---|
| **① 下载** | 把 4 份源字体 + 3 份 OFL 协议拉到 `scripts/fonts/staging/web/` | `scripts/fonts/download-webfont-sources.ts` 的 `downloadFont()` / `SOURCES` | staging/web/*.ttf, *.txt | 任一文件失败 ⇒ **整步失败**；大小不符 ⇒ 失败（该脚本已有 size contract） |
| **② 轴裁剪** | 把 Noto Sans SC / Noto Serif SC 的 `wght` 轴剪成 400:700 | `scripts/fonts/instance-webfont-axis.mjs` 的 `instancer()` 思路（`python -I -m fontTools.varLib.instancer`） | staging/web/*-400-700.ttf | Python 或 fontTools 缺失 ⇒ **明确报错并给出安装命令**（G-4） |
| **③ 切分** | 三族切成 hot/Ext/latin/latin-ext + 三份样式表 + manifest | `scripts/fonts/build-webfont-subsets.mjs` | **staging 输出目录**（§3.5） | 任一族失败 ⇒ 整步失败。⚠️ 这一步与 ④ 都**需要 `subset-font` + `typescript`**（§3.4.1）⇒ 探针阶段就拦住，不让它跑到一半崩 |
| **④ 校验** | 零缺字 + **产物内禀**门禁（块大小/CSS 大小/face 数/覆盖率/拉丁）＋ **页面成本只报不算**（§3.5.7） | `scripts/fonts/verify-webfont-subsets.mjs`（`WEBFONT_PAGE_COST=report`） | 报告 | 任一内禀校验不过 ⇒ **失败**，并把超标数字写进作业日志 |

**关键约束**：

- **①②的产物目录是共享的**（`scripts/fonts/staging/web/`）：
  下载器按「远端 Content-Length == 本地大小」决定跳过 ⇒ 重复构建**不会**重复下载 70 MB。
  ⚠️ 但**轴裁剪会重写**那两份轴实例 ⇒ 它们的字节可能变 ⇒ 版本令牌变 ⇒ 全量重下载。
  ⇒ 因此 **② 只在 ① 之后、且当轴实例不存在时**才跑；已存在则**跳过并如实标注**。
- **③必须写进 staging，不能就地写 `public/font/`**（否则「staging + 显式应用」就没了，
  而且会破坏 §3.5 的发布模型）。⇒ 需要给切分脚本加**输出根目录覆盖**（§3.7）。
- **④必须校验 staging 里的那一份**，不是 `public/font/` 里已发布的那一份 ⇒
  校验脚本也要能指向 staging（§3.7 的 `WEBFONT_FONT_DIR`）。
- **④的「页面成本」部分在候选产物上不参与失败判定** —— 理由与具体做法见 **§3.5.7**
  （一句话：并集样本描述的是**线上**那份产物，拿它去卡**候选**必然误判）。

### 3.4 能力探针（缺能力就报错）

页面顶部先跑一次**能力探针**，结果直接显示；**探针不通过就不让点「开始构建」**。

| 能力 | 怎么探 | 缺了怎么说 |
|---|---|---|
| Node 版本 | `process.version` | 不可能缺 |
| Python 解释器 | `python --version`（尊重现有的 `PYTHON` 环境变量覆盖） | 「找不到 Python 解释器。装一个，或者设 `PYTHON` 环境变量指向它。」 |
| fontTools | `python -I -m fontTools.varLib.instancer --help` | 「Python 在，但 fontTools 没装：`pip install fonttools`（或 `python -m pip install fonttools`）。」 |
| 上游可达 | 对 `SOURCES[0].urls[0]` 做一次**只读的** HEAD/小范围 GET | 「连不上 `raw.githubusercontent.com`（DNS/TLS/超时）。这台机器可能没有出网权限。」 |
| 磁盘可写 | 在 staging 目录写一个探针文件再删掉 | 「staging 目录不可写。」 |
| **构建工具链** | `require.resolve('subset-font')`、`require.resolve('typescript')`；以及 `tsx` 这个可执行能不能跑（`tsx --version`） | 「**字体构建工具链没装齐**：`subset-font` / `typescript` / `tsx` 是**生产依赖**，服务器用 `npm install --omit=dev` 装 ⇒ 缺它们不是这台机器坏了，是依赖没提到 `dependencies` 里。修复：`npm install subset-font@^2.4.0 typescript@^5.6.3 tsx@^4.19.2 --save` 然后重装。」（见 §3.4.1） |

⚠️ 探针**只读不写生产目录**；上游探测**只发一个 HEAD**（不下载 70 MB），
真正的下载在 ① 里做（那里有 size contract）。

#### 3.4.1 构建工具链必须是**生产依赖**（**裁定：提到 `dependencies`**）

**事实**（控制器 2026-10-31 核过 `package.json` 与 `DEPLOY.md`）：

| 包 | 现在的分类 | 谁需要它 | 体积 |
|---|---|---|---|
| `subset-font` ^2.4.0 | **devDependencies** | `scripts/fonts/build-webfont-subsets.mjs:87` 直接 `import subsetFont from 'subset-font'` | 72 KB |
| `typescript` ^5.6.3 | **devDependencies** | `scripts/fonts/webfont-charset.mjs:77` `import ts from 'typescript'`（切分计划本身要用 TS AST） | 23 MB |
| `tsx` ^4.19.2 | **devDependencies** | `scripts/fonts/download-webfont-sources.ts` 是 `.ts`，`npm run fonts:download-web` 用 `tsx` 跑 | 609 KB |

⇒ **`scripts/fonts/verify-webfont-subsets.mjs:55` 静态 `import { FAMILIES } from './build-webfont-subsets.mjs'`
⇒ 校验器传递依赖 `subset-font` + `typescript`。**
⇒ 而 `DEPLOY.md:28` 与 `DEPLOY.md:227` 两处服务器安装命令都是 **`npm install --omit=dev`**
⇒ **服务器上这三个包今天根本不存在** ⇒ 四步流水线在生产机上**必然**在 ③ 或 ④ 崩掉。

⇒ **裁定：把 `subset-font`、`typescript`、`tsx` 三个包从 `devDependencies` 移到 `dependencies`。**
- 代价：`npm install --omit=dev` 多装约 **24 MB**（typescript 占 23 MB）；
- 收益：能力探针（§3.4 第五行）能在**开工之前**发现「依赖没提上来」，而不是跑到一半崩；
- ⚠️ 这**不违反** G-6「零新增运行时依赖」——这三个包**已经存在**，只是**换了一个分类**，
  没有引入任何新包，也没有让它们进入**浏览器**运行时（只有构建脚本用）。
- ⚠️ 实施时必须同时改 `package.json` 的分类**和** `DEPLOY.md` 的说明，
  并且**重新生成 `package-lock.json`**（`npm install --package-lock-only`）。

⚠️ **一条推论必须写进页面**：能力探针报「缺 `subset-font`」时，
**不要**给出「`npm install --omit=dev` 装不上、试试 `npm install`」这种建议 ——
那会把生产机的 dev 依赖装进去。修复命令必须**指名道姓**用 `--save`（写进 `dependencies`）。



### 3.5 staging → apply 的发布模型（**本设计最关键的一节**）

#### 3.5.1 为什么**不能**就地覆盖 `public/font/web/`

字体文件的 URL 是 **`/font/web/<family>/<file>.woff2?v=<族令牌>`**，
而 `/font/**` 的响应头是 `Cache-Control: immutable, max-age=31536000`（一年）。
文件名**稳定**、令牌在**查询串**里 ⇒：

- 浏览器**缓存了旧样式表**的访客，请求的是 `hot.woff2?v=旧令牌`；
- 若 apply **就地覆盖** `hot.woff2`，服务器在这个旧 URL 上返回**新字节**；
- 旧样式表声明的 `unicode-range` 与新文件实际含有的字形**不再一致**
  ⇒ **旧样式表覆盖到的、新文件没有的字符 ⇒ 豆腐块**。

⇒ **就地覆盖会制造 G-3 的反面。** 这是 wave-2 的发布模型本身带来的约束，
后台页面把重建变成日常操作 ⇒ 必须正面解决。

#### 3.5.2 发布目录模型

```
public/font/
  fonts-sans.css        ← 当前发布的三份样式表（内容可被覆盖）
  fonts-serif.css
  fonts-wenkai.css
  fonts-manifest.json   ← 当前发布的 manifest（version = 三份样式表的哈希）
  releases.json          ← 每份 release 的元数据：令牌 / 目录名 / 发布时间 / **被取代时间**（§3.5.4）
  web/
    sans/ hot.woff2 ext-001.woff2 …   ← **release 0**（wave-2 已入库的那 7 981 个 woff2）
    serif/ …
    wenkai/ …
    OFL-sans.txt …
    r<新令牌>/                           ← 后续每一次 apply 新建的发布目录
      sans/ hot.woff2 ext-001.woff2 …
      serif/ …
      wenkai/ …
```

**apply 的动作**（顺序很重要，**先搭后验再换**）：

1. 新切分的产物已经躺在 `scripts/fonts/staging/build/<jobId>/` 里；
2. **发布令牌 T** = staging manifest 里已有的 `version`
   （= 改写前三份样式表内容的哈希，沿用 wave-2 的规则）⇒ 发布目录名 `r<T>`；
3. 在**内存里**把 staging 的三份样式表做一次 URL 前缀改写：
   `/font/web/` → `/font/web/r<T>/`
   （**必须**断言改写命中的次数 == 样式表里 face 的条数，不等就**失败**，
   不许「改了一部分还当成功」）；
4. **清单版本 V** = **改写后**三份样式表内容的哈希（wave-2 的 `manifestVersion` 规则）
   ⇒ 这是写进 `public/font/fonts-manifest.json` 的那个 `version`
   ⇒ `lib/font-css.ts` 用它做样式表的 `?v=`；
   ⚠️ **V ≠ T 是正常的、也是必须的**：`checkManifest` 要求清单版本等于
   **线上**样式表的哈希，而发布令牌要**写进**样式表 ⇒ 鸡生蛋 ⇒ 两个令牌。
   两者都是**内容的函数** ⇒ 内容不变 ⇒ 两者都不变 ⇒ apply 会发现
   「线上已经是这一份」并**拒绝**（409）。
5. 把 staging 的 `web/<family>/*.woff2` 复制到
   **`public/font/web/r<T>/<family>/`**（**新目录**，不覆盖任何旧目录）；
6. 在一个**临时目录**里搭出「候选线上状态」（三份改写后的样式表 + 新 manifest +
   `web/r<T>/`），用 `WEBFONT_FONT_DIR=<临时目录>` **跑一次 wave-2 的校验脚本**；
7. 校验**通过** ⇒ 才把样式表与 manifest 写进线上目录（**只有这一步会动线上**）；
   校验**失败** ⇒ **线上一个字都不动**，删临时目录，报告失败（摘关键行，不糊 stderr）；
8. **登记「被取代时间」**（§3.5.4 的删除依据）：把**刚被这一份取代的那一份**的
   `supersededAt` 写下来（写进 `public/font/releases.json`）。
   ⇒ 这一步**必须**在第 7 步之后：被取代的时刻 = 新样式表上线的时刻，
   早于它登记就等于把一份**还被引用着**的 release 提前算成过期。
9. **把产物回灌仓库**（§3.5.8）：后台**不做 git 操作**（安全边界，§9 第 5 条），
   这一步由**脚本或人工**执行；后台只把「待回灌」的事实与那条命令显示在页面上。
10. 记录审计日志（**必须含「已发布」与「尚未回灌仓库」两个事实**）。

⇒ **「apply 之后 verify 变红」这件事不可能发生**：校验通过之后才换。


#### 3.5.3 为什么这个模型不会产生豆腐块

| 谁 | 请求什么 | 拿到什么 | 一致吗 |
|---|---|---|---|
| 访客 A：**没缓存过**样式表 | `/font/fonts-sans.css?v=<旧 manifest>` | 服务器返回**新**样式表（新版本的内容）⇒ 新样式表指向 `r<新令牌>/…` ⇒ 新文件在盘上 | ✅ 一致 |
| 访客 B：**缓存了旧样式表**（TTL 30 天，§3.5.4） | 旧样式表里的 `/font/web/<族>/<文件>.woff2?v=旧族令牌` | **那一版的 release 目录原封不动** ⇒ 旧字节 ⇒ 与旧样式表的 unicode-range 一致 | ✅ 一致 |
| 访客 C：缓存了旧样式表，但某个 ext 块**当时没被画过**⇒ 没缓存那个 woff2 | 同上 | 服务器返回**旧字节**（旧目录未被覆盖） | ✅ 一致 |
| 访客 D：持有**已被清理掉**的那一版样式表（长开的标签页） | 指向已删除目录的 woff2 | **404** ⇒ 浏览器按 `font-family` 的 fallback 链回退到**系统 CJK 字体** | ⚠️ **不是豆腐块，但字形不一样**（这是清理的已知代价，见 §3.5.4 末段） |

⇒ **只要旧 release 目录不被覆盖，任何一份旧样式表都仍然指向它声明的那批字节。**
⇒ 访客 D 是**唯一**会不一致的一类，而它只在「那份 release 已经被清理掉」时发生 ——
⇒ 所以 §3.5.4 的清理规则必须**保守**，而且必须把这件事**对用户说清**。

#### 3.5.4 旧 release 的清理（**裁定：按「被取代时间 + 30 天」**）

**裁定（用户 2026-10-31 决定）**：删除条件的时间基准是**被取代时间**，不是创建时间。

- 规则：一个 release 目录只有在**同时**满足下面两条时才可以删：
  1. 它**不是**最近 3 份之一（当前 + 前 2）；
  2. 它的**被取代时间**（`supersededAt`）**超过 30 天**。
- **「被取代时间」是什么**：这一份 release 被**下一份**取代、样式表切到新版本的那一刻。
  它记在 `public/font/releases.json` 里（§3.5.2 第 8 步登记）。
  ⚠️ **不是**目录的创建时间 —— 一份 release 可以在盘上躺很久才被取代
  （比如这一次没改语料，产物与上一份相同 ⇒ apply 会被拒；或者连着发了几次）。
  按创建时间算会**提前删掉**一份刚刚被取代的 release ⇒ 直接制造访客 D（404）。
- 为什么要第 2 条：`/font/fonts-*.css` 的 `max-age` 降到 30 天之后（§3.5.4 下方），
  访客可能**缓存着 30 天内的旧样式表**；只要旧样式表还在有效期内，
  它声明的 woff2 就必须还在。
  ⇒ 时间基准必须是**被取代那一刻**，因为那正是「旧样式表开始被取代」的时刻。
- ⚠️ **release 0（`web/sans/`、`web/serif/`、`web/wenkai/`，无 `r` 前缀）
  永远不许删** —— 它是 wave-2 已入库的那一份。
- 顺序：按**目录 mtime** 倒序（「最近」= 最新 mtime）。
  ⚠️ 发布令牌 T 是哈希，**不是单调的** ⇒ 不许按 T 排序。
  ⚠️ `supersededAt` 才是删除依据；mtime 只用来排「最近 3 份」。

**TTL 的两层拆分（**必须这样改，不许一刀切**）**：

| 路径 | 现在 | 改成 | 为什么 |
|---|---|---|---|
| `/font/web/**`（全部 woff2） | `public, max-age=31536000, immutable` | **不变** | 发布目录模型保证**这个 URL 的字节永远不变** ⇒ immutable 是对的；一刀切改成 30 天会让回访用户每月重下 ~800 KB 字体 |
| `/font/fonts-*.css`（三份样式表） | 同上（一年） | **`public, max-age=2592000`**（30 天） | 样式表是**可变层**（内容变了 URL 的 `?v=` 也变，但**旧 URL 仍会被长开的标签页持有**）⇒ 它的 TTL 就是「旧样式表还能被用多久」的上界 ⇒ 清理规则依赖这个上界 |
| `/font/fonts-manifest.json` | 同上 | **`public, max-age=2592000`** | 同上（它只在构建期被 import，但盘上那份也要有同样的上界） |

⚠️ **两条规则必须互斥**（`/font/web/**` 与「其余 `/font/**`」），
不许靠「后写的覆盖先写的」—— Next.js 的 `headers()` 命中多条规则时行为不保证。
实施时用否定前瞻把两者分开（形如 `'/font/:path((?!web/).*)'`）。

**⚠️ 线上现状（控制器 2026-10-31 实测，**必须写进实施计划**）**：

| 事实 | 实测结果 | 对本设计的影响 |
|---|---|---|
| 谁在发 `/font/**` 的响应头 | **Next.js**（`next.config.ts` 的 `headers()`），**不是 nginx** —— 响应里只有**一个** `Cache-Control`，与 `next.config.ts` 的 `year` 逐字相同；`deploy/OPTIMIZATION.md:23` 早就写着「由 Next.js 发出」 | 改 `next.config.ts` 就够了；但 `deploy/nginx.ziyun.pudafo.com.conf` 里那个 `location /font/` 的 `expires 1y` 是**模板里的危险块**（F30-a：整份模板不许安装，`/font/` 一旦被接管就全 404）⇒ 它必须**同步改成两层**，以防哪天被人单独摘过去 |
| 线上字体布局 | **还是 wave-2 之前的老布局**：线上 `fonts-sans.css`（2026-10-24，110 436 B）里的 URL 形如 `/font/noto-sans-sc/<hash>.4.woff2`；`/font/web/sans/hot.woff2` 在线上是 **404** | ⇒ **wave-2 尚未上线** ⇒ 本设计的发布目录模型是**从干净状态开始**，没有「旧布局与新布局并存」的过渡期；TTL 与布局的改动可以在同一次部署里做 |

- 磁盘占用：3 份 release × 41 MB ≈ 123 MB，**外加永不删除的 release 0 ≈ 41 MB**
  ⇒ 合计 ≈ 164 MB。页面上要显示这个数。
- **git 侧也要跟着减**：回灌进仓库的每一份 release 都是 ~41 MB（§3.5.8）⇒
  服务器清掉的 release，仓库里也要在**同一次回灌**里 `git rm -r` 掉，否则两边不一致。

#### 3.5.5 apply 之后还需要一次 build（**必须对用户说清**）

`lib/font-css.ts` 在**构建期** `import fonts-manifest.json` ⇒
**HTML 里样式表 URL 的 `?v=` 是构建时定死的**。
apply 改了 `fonts-manifest.json` ⇒ **新令牌要等下一次 build 才进到 HTML**。

⇒ 页面在 apply 成功后**必须显示**：
- 新旧两个 manifest 版本号；
- 一句明话：「样式表文件已经更新了（访客下次请求就会拿到新的），
  但 **HTML 里的令牌要等下一次构建/部署**才更新；现在不影响正确性，
  只是新版本还没有被令牌化。」

⇒ **不在服务器上跑 build**（§2.2 非目标）：构建要 43 MB 静态资源 + Next 编译，
在生产机上跑会拖垮正在服务的进程，而且失败会留下半成品。

#### 3.5.6 wave-2 校验门禁与发布目录的相容性（**必须先读这一节再动手**）

wave-2 的 `scripts/fonts/verify-webfont-subsets.mjs` 把字体 URL 布局
**写死了三处**（控制器 2026-10-31 逐行核过源码）：

| # | 位置 | 写死的东西 | 不改会怎样 | 要不要改 |
|---|---|---|---|---|
| 1 | `parseFaceUrl()`（`:224`） | 正则 `^\/font\/web\/([^/]+)\/([^/?]+)(?:\?v=([^?]*))?$` 只允许 `/font/web/<一段>/<文件>` | 新布局有三段 ⇒ 解析失败 ⇒ 门禁报「face 没指向 /font/web/…」 | **要改**：正则多认一段**可选**的发布目录，返回值多一个 `release` 字段 |
| 2 | `checkFaceDirectory()`（`:331`） | URL 的目录段必须**等于**族名（`url.dir === family.dir`） | —— | **不用改** —— 前提是解析器的契约是「`dir` = **族目录**那一段、`release` = 发布段」⇒ `url.dir` 仍然是 `sans` ⇒ 断言依然成立。⚠️ **不许**把 `release` 塞进 `dir` 里去「少改一处」 |
| 3 | 读盘路径（`:696`） | `join(WEB_DIR, url.dir, url.file)` | 读不到文件 ⇒ 报「文件缺失」 | **要改**：`release` 非空时用 `join(WEB_DIR, url.release, url.dir, url.file)`；`release` 为空时**保持今天的路径**（逐字节一致） |

⇒ **解法是让解析器多认一种「可选的发布目录段」**：

```
/font/web/<发布段?>/<族>/<文件>
```

- 发布段**缺省**（release 0，今天的布局）⇒ 行为与今天**逐字节一致**；
- 发布段存在 ⇒ 新能力。

⚠️ **`parseFaceUrl` 新增的 `release` 字段有两个外部消费者，两个都要跟着改**
（它们不在校验脚本里，改漏了会在**别的**地方炸）：

| 消费者 | 位置 | 要改什么 |
|---|---|---|
| `scripts/perf/font-load.mjs` | `:129`（键 `${url.dir}/${url.file}`）与 `:337`（`readFile(join(WEB_DIR, key))`） | 键与读盘路径都要带发布段；**`release` 为空时保持原样**（否则今天的探针行为变了） |
| `tests/unit/deploy/nginx-config.test.ts` | `:672`（`statSync(resolve(ROOT,'public','font','web', face.dir, face.file))`） | 读盘路径要带发布段 ⇒ 否则 `statSync` 直接**抛**（§3.5.9 第 7 条） |

⇒ wave-2 的门禁在现有产物上的行为**完全不变**。

**发布段的形状**：必须是 `r` + 小写十六进制（发布令牌 T 是 sha256 的前 12 位）。
形状不对的三段式 URL **解析失败**（⇒ 门禁报「face 没有指向 /font/web/…」），
不许默默当成一个族名 —— 宁可红，不要错。

**已经实测过的代价**：改写给样式表带来的 gzip 增量合计 **+1 744 B**
（sans +369 / serif +186 / wenkai +1 189），改写后总量 160 592 B，
上限 179 200 B ⇒ **余量 18 608 B** ⇒ 不会撑爆预算；face 数与
`maxFacesPerCss` 都不受影响。

#### 3.5.7 候选产物与线上门禁的分工（**W2-7 之后才成立的约束，必须先读这一节**）

wave-2 的校验脚本（W2-7 修好之后）有**三层**页面成本口径：

| 层 | fixture | 判失败吗 | 预算 | 它描述的对象 |
|---|---|---|---|---|
| 种子 | `data/font-page-profiles.json` | **不判**（只报，标成**下限**） | —— | 1 轮抽样的热区 |
| **并集样本** | `data/font-page-sample.json`（8 轮并集） | **判** | `unionSampleBytes` / `maxUnionSampleFilesPerPage` | **已发布**那份产物上，8 轮页面的并集字符集 |
| 活页探针 | 无（打真页面） | **判** | `pageFontBytes` / `maxFontFilesPerPage` | **真页面**的一次访问 |

**⚠️ 关键事实：并集样本的预算几乎没有余量。**
控制器 2026-10-31 实跑 `npm run fonts:verify-webfont` 的输出：

```
[verify] pages  : / 819 KB / 175 files   /dictionary 323 KB / 7 files   /poetry 236 KB / 6 files   /stories 1186 KB / 255 files   OK
[verify] bytes  : / 838960 B   /dictionary 330688 B   /poetry 241204 B   /stories 1214408 B
                 （预算 839680 B / 330752 B / 241664 B / 1214464 B）
```

⇒ 字节余量：`/` **720 B**、`/dictionary` **64 B**、`/poetry` **460 B**、`/stories` **56 B**；
⇒ **文件数余量：`/stories` 实测 255 = 预算 255 ⇒ 零余量**（`/` 175 / 255、`/dictionary` 7 / 255、`/poetry` 6 / 255）。
⇒ 它的作用**不是**「页面别太重」，而是**「产物不许相对样本漂移」** ——
一个**近乎零余量的漂移探测器**。

**⇒ 推论一：候选校验不能拿并集样本预算判失败。**
理由：并集样本描述的是**线上那一份**产物的块组成。语料一变，Ext 块按频率序**整体移位**
⇒ 同一批字符落在**不同的块** ⇒ 字节数变 ⇒ 必然超预算。
⇒ 若候选校验拿它判失败 ⇒ **任何一次语料变了的重建都会失败** ⇒ 功能不可用。
⇒ **裁定**：校验脚本新增一个模式开关 **`WEBFONT_PAGE_COST`**（`enforce` = 默认 / `report`）：

| 模式 | 谁用 | 产物内禀校验（覆盖率 / 不相交 / 字形 / 块大小 / CSS 大小 / face 数 / manifest / 令牌 / identity / 字重 / 目录 / 拉丁） | 页面成本（种子 + 并集样本） |
|---|---|---|---|
| `enforce`（默认） | 仓库自己的 `npm run fonts:verify-webfont` | **判失败** | 并集样本**判失败**；种子只报 |
| `report` | **后台作业的候选校验** | **判失败** | **只报不算**（数字照样打印，并标注「描述的是线上那份，不是候选」）＋ 一行**机器可读**的 `[verify] pagecost: {…}`（后台取新数字的唯一来源） |

⚠️ `enforce` 是默认值 ⇒ **仓库自己的行为一个字节都不变**（wave-2 的门禁语义不受本设计影响）。

⇒ 候选仍然被牢牢卡住：块大小 `extBlockBytes` 7 KB、热区 `hotBytes` 96 KB、
CSS 总量 `cssBytes` 175 KB / `sansCssBytes` 65 KB、face 数 `maxFacesPerCss` 3 400、
**零缺字**、拉丁覆盖 —— **全部照常判失败**。
「把块宽从 6 字改成 64 字」这种会让页面字体量爆炸的改法，
照样被 `extBlockBytes` 与 `cssBytes` 挡住 ⇒ **候选模式不会让病态产物蒙混过关**。

**⇒ 推论二：真正管「单页成本」的门禁是活页探针，而它不在候选上跑。**
`pageFontBytes` 的余量是 **25 %**（实测 448 488 B / 预算 560 128 B）⇒ 语料变化顶不破它。
⇒ apply 之后、**下一次构建/部署**让新样式表真正上线之后，
跑 `npm run perf:fonts -- --base <线上>` 就是那条真正管页面成本的门禁。

**⇒ 推论三（必须对用户说清）：apply 之后，服务器那棵树里的并集样本门禁会红。**
apply 改写了服务器上的三份样式表（指向 `r<T>/`）⇒ 校验器用并集样本的字符集去量**新**块
⇒ 字节数变 ⇒ 近乎零余量的预算被顶破 ⇒ `npm run fonts:verify-webfont` **EXIT=1**。
⇒ **这不是 bug，它 detecting 的正是「产物漂移了」这件事。**
⇒ 修法是**一次人工重新标定**：把 `scripts/fonts/verify-webfont-subsets.mjs` 里
`LIMITS.unionSampleBytes`（4 个数）与 `maxUnionSampleFilesPerPage` 更新成新的实测值
（若产物没变、只是换了发布目录，则**不需要**改）。
⚠️ **后台绝不自动改这个预算** —— 自动把门禁预算改成「让当前产物通过」，
就是 wave-2 修掉的**假绿灯**（C-1）换了个方向再来一次。
⇒ 后台页面要做的：**把新旧两个数字并排显示**，并指出要改的是哪几行。

⇒ **一句话**：后台负责**把产物做出来并安全上线**；
「门禁预算的重新标定」仍然是**人的动作**（一次代码改动，走评审）。

#### 3.5.8 产物回灌（**用户裁定：回灌，仓库与线上一致**）

**为什么必须回灌 —— 这是「静默回滚」的陷阱：**

部署是把仓库的 `public/` 用 `rsync` 推到服务器（**不带 `--delete`**）⇒
**仓库里没有的东西不会消失，但仓库里有的旧东西会覆盖服务器上的新东西。**

| 时刻 | 服务器树 | 仓库树 | 后果 |
|---|---|---|---|
| apply 之后 | 有 `web/r<T>/` + 指向它的三份样式表 + 新 manifest | **什么都没有** | 暂时没问题 |
| 下一次 rsync 之后 | 三份样式表被**仓库里的旧版本覆盖** | 还是旧的 | 新 release 变成**没人引用的孤儿**（41 MB 白占磁盘）；manifest 版本 V 被覆盖回旧的；**访客拿到的还是旧字体**；而后台页面上的「已发布」是**假象** |

⇒ 这就是**静默回滚**：没有任何报错，页面照旧显示「已发布」，线上却回到了旧字体。
⇒ **裁定（用户 2026-10-31 决定）：apply 的产物必须回灌进仓库，仓库与线上一致。**

**回灌要提交什么**（一次提交，五样东西）：

1. `public/font/web/r<T>/**` —— 全部 woff2 + **每一族自己的 `OFL-<族>.txt`**（§3.5.6 的三处硬编码之一，见 §3.7 的放宽清单）；
2. `public/font/fonts-sans.css` / `fonts-serif.css` / `fonts-wenkai.css` —— **改写后**的；
3. `public/font/fonts-manifest.json` —— 新的 V；
4. `public/font/releases.json` —— release 台账（含 `supersededAt`）；
5. **同一次提交里 `git rm -r` 掉服务器已经清掉的那些 release** ⇒ 两边一致（§3.5.4 末段）。

**怎么回灌**（后台**不做 git 操作** —— §9 第 5 条的安全边界，这条不因为回灌而放宽）：

- 一个脚本 `scripts/fonts/import-webfont-release.mjs`：
  ```
  node scripts/fonts/import-webfont-release.mjs --release r<T>
  ```
  它做四件事：
  ① 校验目标目录存在、且 manifest 的 V **等于**三份样式表的哈希（不一致就**拒绝**）；
  ② `git add` 上面五样、`git rm -r` 该删的旧 release；
  ③ **打印新的钉死数字**（§3.5.9 的 1/2/3/4 条：文件数、总字节、原始 CSS 字节、三个 gzip 字节）
     —— 这样维护者不用先跑一遍失败的测试才知道该填几；
  ④ 默认**只 stage 不提交**；`--commit` 才提交，提交消息按仓库约定：
     `feat(fonts): publish webfont release r<T> [YYYY-MM-DD HH.MM]`，
     末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 管理员在后台页面上看到「**产物已发布，但尚未回灌仓库**」+ **那条命令** ⇒ 自己跑。

**代价（必须说清，不许藏）**：

- 每份 release 给 git 加 **~41 MB** ⇒ 仓库会变大（用户明确接受了这个代价）；
- **回灌提交之后，仓库树的 `npm test` 会红**（见 §3.5.9）⇒ 每次回灌都**必须**跟着一次
  「重新标定」的代码改动 —— 这是这条路径的**固定成本**，不是意外。

**⚠️ 时序**：回灌**必须在下一次部署之前**完成，否则就是上面那条静默回滚。
⇒ 后台页面在「已发布但未回灌」状态下必须显示**醒目的**提示（**不是**一行灰色小字）。

#### 3.5.9 每次 apply 之后**必须重新标定**的钉死数字（后台要列清单）

⚠️ 这些数字**不是** bug，是**产物/布局变了**的正常后果。
⚠️ **后台绝不自动改它们**（§3.5.7 同样的理由：自动把门禁改成「让当前产物通过」= 假绿灯）。

| # | 文件:行 | 现在钉死的数 | 什么时候要改 | 新值从哪来 |
|---|---|---|---|---|
| 1 | `tests/unit/lib/fonts-css.test.ts:310` | `subsets.length` = **7 981** | **每次回灌都要改**（递归遍历 `public/font/web` ⇒ 每多一份 release 就翻倍） | import 脚本打印 |
| 2 | `tests/unit/lib/fonts-css.test.ts:311` | 总字节 **28 236 168** | 同上 | import 脚本打印 |
| 3 | `tests/unit/lib/fonts-css.test.ts:298` | `cssBytes` = **2 023 175**（原始） | **每次回灌都要改**（样式表被改写 ⇒ 原始字节变） | import 脚本打印 |
| 4 | `tests/unit/lib/fonts-css.test.ts:73/82/91` | 三个 `gzipBytes` = **55 821 / 64 536 / 38 491** | 同上 | import 脚本打印（候选校验的 `[verify] css` 行也可） |
| 5 | `scripts/fonts/verify-webfont-subsets.mjs` `LIMITS.unionSampleBytes` | **839 680 / 330 752 / 241 664 / 1 214 464** | **只有语料变了**才要改（只换发布目录、产物没变 ⇒ **不用改**） | 候选校验 `report` 模式的 `[verify] pagecost` |
| 6 | 同上 `LIMITS.maxUnionSampleFilesPerPage` | **255** | 同上 | 同上 |
| 7 | `tests/unit/deploy/nginx-config.test.ts:672` | 读盘路径 `public/font/web/<dir>/<file>` | **每次回灌都要改**（样式表指向 `r<T>/` ⇒ `statSync` 直接抛） | 解析器新增的 `release` 字段（§3.5.6） |

⚠️ 第 1/2/3/4/7 条**每次回灌都要改**（哪怕产物一个字没变，只换了发布目录）；
第 5/6 条**只有语料变了**才要改。
⚠️ 后台页面在 apply 成功之后要把这份清单**列出来**（哪几行、现在钉的是几、新的该是多少），
但**只显示、不代写**（§3.5.7：门禁预算是人的动作）。

### 3.6 权限 / 审计 / 错误

- **权限**：所有 API 路由（§5 的 8 个）都走 `lib/auth.ts` 的 `requireAdmin()`
  （未登录 401 / 非管理员 403），与后台其它页面一致。
- **审计**（沿用 `logUserAction`，metadata 带标题/版本号）：
  | 事件 | action 名 |
  |---|---|
  | 开始构建 | `admin_webfont_build_started` |
  | 构建失败 | `admin_webfont_build_failed` |
  | 应用发布 | `admin_webfont_build_applied` |
  | 应用失败 | `admin_webfont_build_apply_failed` |
  | 清理旧 release | `admin_webfont_releases_cleaned` |
  ⚠️ `admin_webfont_build_applied` 的 metadata **必须含两个事实**：
  `published: true` 与 `importedToRepo: false`（后台不知道仓库有没有回灌 ⇒ 它**永远**是 `false`，
  这一行是让审计日志能回答「这次发布的产物回灌了没有」的**唯一**依据）。
- **错误**：所有失败**必须**非零退出/非 2xx 响应，且**文案说真话**（G12）：
  - HTTP 层：4xx/5xx + 一句人话 + `code` 字段（机器可判）+ `detail`（可读的细节）；
  - 作业层：`status = 'failed'` + `error` 字段写清**卡在哪一步、为什么、怎么修**；
  - **不许**把子进程的 stderr 原样糊给用户（可能含路径/内部信息）——
    要**摘取关键行**并附上「完整日志见作业日志」。

### 3.7 要改的既有脚本（清单，每条都要有理由）

| 文件 | 改什么 | 为什么必须 |
|---|---|---|
| `scripts/fonts/build-webfont-subsets.mjs` | 字体根目录可覆盖：**新增 `WEBFONT_FONT_DIR`**（指向**字体根目录**，默认 = `public/font`；切分输出 = `<root>/web`，样式表 = `<root>/fonts-<族>.css`，manifest = `<root>/fonts-manifest.json`）。默认行为**一字不变**；② **许可证要跟着字体走**：现在 `OFL-<族>.txt` 只写到 `web/` 的根（`:504`），发布目录 `web/r<T>/` 里**一份都没有** ⇒ 每一份 release 必须**自带**许可证（SIL OFL 要求分发时附许可证）⇒ 改成**同时**写 `<root>/web/<族>/OFL-<族>.txt` | 让 ③ 写进 staging 而不是就地写线上（§3.5）；让每一份 release 都是**自足的**（许可证合规 + 回灌时能整目录带走，§3.5.8） |
| `scripts/fonts/verify-webfont-subsets.mjs` | ① 认**同一个 `WEBFONT_FONT_DIR`**（默认不变 ⇒ 行为不变）；② **新增 `WEBFONT_PAGE_COST`**（`enforce` 默认 / `report`），语义见 §3.5.7 | 让 ④ 校验 staging 里那一份（§3.3），且候选模式不拿「描述线上那份」的样本预算判失败 |
| `scripts/fonts/download-webfont-sources.ts` | **不改逻辑**；只是在被 API 调用时复用它已导出的 `downloadFont()` | 避免把「size contract」抄第二份（wave-2 的教训：抄一份就会漂） |
| `scripts/fonts/instance-webfont-axis.mjs` | 暴露一个可被调用的函数（把 `main()` 的逻辑抽成 `instanceAll()`），`main()` 变成薄壳 | 让 ② 能在作业里被调用并拿到逐步日志 |
| `next.config.ts` | `/font/**` 的 `max-age` **拆成两层**：`/font/web/**` **不变**（一年 immutable）；`/font/fonts-*.css` 与 `/font/fonts-manifest.json` 改成 **30 天**。两条规则**必须互斥**（否定前瞻），不许靠顺序覆盖 | §3.5.4：样式表的可变层要有**有限**的 TTL，否则「旧样式表还能被用多久」没有上界 ⇒ 清理规则（被取代时间 + 30 天）就没有依据 |

⚠️ **今天 `WEBFONT_FONT_DIR` 与 `WEBFONT_PAGE_COST` 都不存在** ——
字体脚本里现在**只有**两个 env：`WEBFONT_SAMPLE_PATH`（校验器读样本路径）与 `PYTHON`（轴裁剪的解释器）。
`build-webfont-subsets.mjs` 的输出根是写死的 `OUT_ROOT = public/font/web`，
校验器的 `FONT_DIR` / `WEB_DIR` / `MANIFEST_PATH` 也是写死的。
⇒ 这两个 env 是**新增**的，**名字在本设计里定死，实施时不许再改名**。

**⚠️ 下面这 4 个是 wave-2 已封板的文件**（本设计第一次要动 wave-2 封板的代码，
必须如实列出，不许藏）：

| 文件 | 改什么 | 为什么必须 |
|---|---|---|
| `scripts/fonts/verify-webfont-subsets.mjs` | `parseFaceUrl()` 多返回一个 `release` 字段；读盘路径带上发布段 | §3.5.6 的第 1、3 条：门禁的 URL 正则只允许一层目录 ⇒ 它对**新布局**一律报「文件缺失」 |
| `scripts/fonts/verify-webfont-subsets.d.mts` | `FaceUrl` 接口多一个 `release: string`；另加 `PageCostMode` 与 `PageCostReport` 两个类型（§3.5.7） | 类型声明必须与实现一致，否则 `tsc` 不过 |
| `scripts/perf/font-load.mjs` | 盘上相对路径带上发布段 | 探针**按 URL 自己的路径**读盘；不改就会读到不存在的文件 |
| `tests/unit/scripts/verify-webfont-subsets.test.ts` | `parseFaceUrl` 的期望多一个 `release: ''`；补一条「带发布段的 URL」的用例 | 既有断言会因多一个字段而红；新能力必须有测试 |

⇒ 对这 4 个文件的改动**只有一条纪律**：它们是**纯粹的「超集扩展」** ——
wave-2 的校验门禁在**现有产物上的行为一个字节都不变**，14 条校验的**判据一个数字都不改**
（详见 §3.5.6）；`LIMITS` 的每一个数字不许动、wave-2 的 spec 不许动（R-12）。
只许让解析器**多认一种布局**。
⚠️ **例外一条，且必须显式承认**：§3.5.7 的**页面成本模式**（`WEBFONT_PAGE_COST=report`）
**不是**纯粹的扩展 —— 它**改变**了候选校验的判定层（页面成本只报不算）。
⇒ 但**默认模式 `enforce` 的行为一个字节都不变**（仓库自己的 `npm run fonts:verify-webfont`
输出与退出码逐字节相同）⇒ 它是「**默认不变、显式开启**」的加法，不是替换。

**⚠️ 下面这 8 个文件是因 §3.4.1（依赖裁定）与 §3.5.8（回灌裁定）而必须动的**
（本设计第一次要动它们，必须如实列出，不许藏）：

| 文件 | 改什么 | 为什么必须 |
|---|---|---|
| `package.json` | `subset-font`、`typescript`、`tsx` 三个包从 `devDependencies` **移到** `dependencies` | §3.4.1：服务器 `npm install --omit=dev` 装不上它们 ⇒ 流水线在 ③/④ 必崩 |
| `package-lock.json` | 随 `package.json` 重新生成（`npm install --package-lock-only`） | 分类变了而锁文件没变 ⇒ `--omit=dev` 仍然按旧分类装 ⇒ 依赖还是缺 |
| `DEPLOY.md` | 两处 `npm install --omit=dev`（`:28`、`:227`）旁边补一句：「字体构建工具链（`subset-font`/`typescript`/`tsx`）已是**生产依赖**，不用单独装」 | 不写清楚 ⇒ 下次有人「精简依赖」时把它们挪回 devDependencies ⇒ 同一个坑再踩一次 |
| `deploy/nginx.ziyun.pudafo.com.conf` | `location /font/` 的 `expires 1y` 拆成两层：`/font/web/` 1y immutable；样式表/manifest 30d | §3.5.4 的两层 TTL。⚠️ 这份模板**整份不许安装**（F30-a，`/font/` 一旦被接管就全 404），但它不许留着一条**与线上不一致**的规则 |
| `deploy/OPTIMIZATION.md` | `:23` 与 `:327` 写着 `max-age=31536000, immutable` ⇒ 改成两层；字体那节的 Latin 计数/字节数跟着回灌后的产物**重算** | 手册是部署者读的第一份文档，它写的必须等于实际响应头（现在 `:23` 已经自己写着「由 Next.js 发出」——这是今天唯一没坏的证据） |
| `tests/unit/lib/fonts-css.test.ts` | 读盘路径要带发布段；4 处钉死的数字（§3.5.9 第 1/2/3/4 条）改成「当前 release 口径」 | 回灌之后仓库里会同时有 release 0 和新 release ⇒ 递归遍历的计数与字节数全变 ⇒ 门禁必须重标定 |
| `tests/unit/deploy/nginx-config.test.ts` | 读盘路径要带发布段（`:672`）；手册里的 Latin 数字重算 | §3.5.9 第 7 条：不改就是 `statSync` 直接抛 |
| `scripts/fonts/import-webfont-release.mjs`（**新建**） | 回灌脚本（§3.5.8）：校验 → stage → 打印新的钉死数字 → 可选提交 | 回灌要动 ~8 000 个文件 ⇒ 不许人肉 `git add`；而且**后台不做 git 操作**（§9 第 5 条） |

⚠️ **除上面这 5 + 4 + 8 = 17 个文件之外的既有文件一律不许改。** 尤其：
wave-2 的 spec、预算 `LIMITS`、切分计划 `webfont-charset.mjs`、fixture `data/font-page-profiles.json`。

⚠️ **一条必须说清的例外**：「`LIMITS` 的每一个数字不许动」这条纪律，
约束的是**本功能的实施**（实施者不许为了让门禁变绿去动它）。
§3.5.9 说的「apply 之后由人重新标定」是**另一次独立的、有人评审的代码改动** ——
它不由本功能自动发生，也不由本功能的实施顺带完成。

---

## 4. 数据模型

新增迁移 `scripts/migrations/2026-10-31-webfont-build-jobs.sql`
（**必须幂等**——本仓库的迁移曾经因为非幂等把 `/init` 卡死）：

```sql
CREATE TABLE IF NOT EXISTS webfont_build_jobs (
  id            VARCHAR(40)  NOT NULL,
  status        VARCHAR(16)  NOT NULL,          -- pending | running | done | failed | cancelled
  step          VARCHAR(16)  NOT NULL DEFAULT '',-- download | instance | subset | verify | apply
  step_progress VARCHAR(8)   NOT NULL DEFAULT '',-- 文本，例如「切分第 2/3 族」
  message       VARCHAR(500) NOT NULL DEFAULT '',
  error         TEXT        NULL,
  log           MEDIUMTEXT  NOT NULL,
  manifest_version VARCHAR(16) NOT NULL DEFAULT '', -- apply 之后 = 新的 manifest version
  release_dir   VARCHAR(64)  NOT NULL DEFAULT '',   -- apply 之后 = 新建的 release 目录名
  started_by    BIGINT       NULL,                 -- 触发作业的管理员 user id
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  finished_at   DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_webfont_build_jobs_status (status),
  KEY idx_webfont_build_jobs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- `id`：短随机串（`crypto.randomUUID()` 的紧凑形式），只出现在 URL 与日志里。
- `log`：**只追加**，每行带时间戳；作业结束后不再追加。
- `started_by` 指向 `users.id`（后台管理员）。

### 4.1 release 台账（**文件**，不进 DB）

**为什么是文件而不是表**：这份台账必须**跟着仓库走** —— 回灌时它要被一起提交（§3.5.8），
而且服务器上的清理逻辑与仓库里的记录必须是**同一份**，否则两边会漂。
（作业表在 DB 里，因为它只描述「一次作业」，与 release 无关。）

`public/font/releases.json`：

```json
{
  "releases": [
    {
      "dir": "r3f2a1b0c9d8",
      "token": "3f2a1b0c9d8",
      "publishedAt": "2026-11-01T10:00:00Z",
      "supersededAt": null,
      "files": 7981,
      "bytes": 28236168
    },
    {
      "dir": "r9a8b7c6d5e4f",
      "token": "9a8b7c6d5e4f",
      "publishedAt": "2026-10-20T10:00:00Z",
      "supersededAt": "2026-11-01T10:00:00Z",
      "deletedAt": null,
      "files": 7981,
      "bytes": 28236168
    }
  ]
}
```

- `dir`：发布目录名（`r` + 令牌）；release 0 不在这里（它**永不被取代、也永不被删**）。
- `publishedAt`：这份 release 上线的时刻。
- `supersededAt`：**被下一份取代的时刻**（`null` = 还没被取代 = 当前发布的那份）
  ⇒ **删除条件就靠它**（§3.5.4）。
- `deletedAt`：被清理掉的时刻（`null` = 还在盘上）；**删掉的条目留在台账里**（台账是历史）。
- `files` / `bytes`：这一份的 woff2 个数与总字节（页面显示占用用；也用来校验回灌的完整性）。
- ⚠️ **写它的时候必须原子**（写临时文件再 `rename`）—— 中途崩了不能留下半个 JSON。
- ⚠️ `releases.json` 在 `public/` 下 ⇒ **它是可以被公开 URL 读到的**。
  它里面只有目录名、时间戳与字节数，**没有任何秘密** ⇒ 可以接受；
  但**不许**往里写令牌、密钥、路径之类的内部信息。

### 4.2 旧 release 的清理是**单独的动作**（**裁定**）

- **apply 不删任何东西**。删是不可逆操作，必须是**一个独立、显式**的后台动作：
  `POST /api/admin/webfonts/releases/cleanup`（§5）。
- 清理按 §3.5.4 的规则执行：不是最近 3 份 **且** 被取代时间超过 30 天。
  ⚠️ 清理**只给被删的那一条**加 `deletedAt`，**其余条目一个字不动** ——
  台账是**历史**，不是「当前目录列表」。
- 清理**必须**同时：① 删服务器上的目录；② 在页面与回灌脚本的提示里说清
  「仓库里那份也要 `git rm -r`」（§3.5.8 第 5 项）⇒ 两边一致。

---

## 5. API 契约

| 方法 | 路径 | 用途 | 成功 | 失败 |
|---|---|---|---|---|
| `GET` | `/api/admin/webfonts/capability` | 能力探针（§3.4） | `200 { ok, python, fonttools, network, disk, toolchain, sources[] }` | `200` 但 `ok:false`（探针本身失败不是服务器错误） |
| `POST` | `/api/admin/webfonts/build` | 开始一次构建 | `202 { jobId }` | `409`（已有活跃作业，带 `jobId`） |
| `GET` | `/api/admin/webfonts/build` | 最近 10 条作业 | `200 { jobs: [...] }` | — |
| `GET` | `/api/admin/webfonts/build/[id]` | 单个作业状态 + 日志 | `200 { job }` | `404` |
| `POST` | `/api/admin/webfonts/build/[id]/cancel` | 取消（仅 `pending`/`running`） | `200 { job }` | `409`（已结束） |
| `POST` | `/api/admin/webfonts/build/[id]/apply` | 把 staging 的产物应用上线 | `200 { job, manifestVersion, releaseDir, reimport, rebaseline }` | `409`（作业不是 `done`）/ `500`（应用失败） |
| `GET` | `/api/admin/webfonts/releases` | release 台账（§4.1）+ 磁盘占用 | `200 { releases[], bytes, keep }` | — |
| `POST` | `/api/admin/webfonts/releases/cleanup` | 清理过期 release（§4.2，**单独的动作**） | `200 { removed[], kept[] }` | `409`（没有可清理的） |

- 全部走 `withErrorHandling` + `requireAdmin`（与后台其它路由同构）。
- 入参用 zod 校验（与 `/api/admin/chars/generate` 同款）。
- **apply 的幂等**：同一个作业**不允许 apply 两次** ⇒ 第二次返回 409 并说明「已应用过」。
- `capability` 的 `toolchain` 字段：`{ subsetFont: boolean, typescript: boolean, tsx: boolean }`
  ⇒ 三个里缺任何一个，`ok` 就是 `false`，「开始构建」不可点（§3.4.1）。
- `apply` 响应的两个新字段：
  ```jsonc
  {
    "job": { … },
    "manifestVersion": "…",   // 新的 V
    "releaseDir": "r<令牌>",
    "reimport": {              // §3.5.8：产物必须回到仓库
      "required": true,
      "command": "node scripts/fonts/import-webfont-release.mjs --release r<令牌>",
      "note": "产物已发布到服务器，但尚未回灌仓库；在回灌之前不要部署 —— 否则会把旧样式表覆盖回去。"
    },
    "rebaseline": [            // §3.5.9：apply 之后要重标定的钉死数字
      { "file": "tests/unit/lib/fonts-css.test.ts", "line": 310, "what": "subsets.length",
        "current": 7981, "expected": 15962, "always": true },
      { "file": "scripts/fonts/verify-webfont-subsets.mjs", "line": 0, "what": "LIMITS.unionSampleBytes",
        "current": [839680, 330752, 241664, 1214464], "expected": null,
        "always": false, "note": "只有语料变了才需要改" }
    ]
  }
  ```
  ⚠️ `expected` 是**新值**：`always: true` 的那几条由候选校验/回灌脚本算出来；
  `always: false` 的那几条（`LIMITS` 的并集样本预算）**只有语料变了**才有新值，
  没有就填 `null`（= 不用改）。⚠️ 后端**只算不写** —— 它不许碰仓库里的任何文件。

---

## 6. 前端

- `app/admin/settings/webfonts/page.tsx`（服务端壳）+ `components/admin/WebfontPipelinePanel.tsx`（客户端）。
- 组件职责：
  - 挂载时拉一次 capability + 最近作业 + release 台账；
  - 「开始构建」⇒ `POST` ⇒ 拿 `jobId` ⇒ **每 1.5 s** 轮询状态 ⇒ 轮询到 `done|failed|cancelled` 停；
  - 日志区**增量追加**（只渲染新增行，别每 1.5 s 重画全文）；
  - 「应用」按钮**只在 `status === 'done'` 且存在 staging 产物时**可点；
  - **离开页面不取消作业**（作业在服务端继续），但要提示「作业仍在运行」。
- **能力面板**（§3.4）：五行 + **工具链**一行；任一行缺 ⇒ 「开始构建」**不可点**，
  每行给**具体的修复命令**（工具链那行必须带 `--save`）。
- **apply 之后的两个区块**（**这页的重点**）：
  1. **「产物已发布，但尚未回灌仓库」** —— **醒目**（不是灰色小字）：
     一句话说清**为什么**（不回灌 ⇒ 下次部署会用旧样式表覆盖回去 = 静默回滚），
     给出**那条命令**（可一键复制），并给出「回灌之前不要部署」这句硬提醒；
  2. **「apply 之后要重标定的钉死数字」** —— 一张表：`文件:行` / `钉的是什么` /
     `现在钉的是几` / `新的该是多少`；`expected` 为 `null` 的行标「不用改」。
     ⚠️ 表格只**显示**，页面上**没有**「一键修改」按钮（那是人的动作，§3.5.9）。
- **release 列表**（§4.1）：目录名 / 发布时间 / **被取代时间** / 文件数 / 字节数 /
  「可否清理」（按 §3.5.4 的规则算出来的**建议**，执行要另点一个按钮 ⇒ §4.2）。
- 视觉沿用后台已有的**宣纸案牍**风格（与 `/admin/settings/fonts` 同族）。
- 文案**中文**（与后台其它页面一致）；**脚本日志与代码注释用英文**。

---

## 7. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 服务器**没有出网** ⇒ ① 失败 | 中 | 能力探针提前告知；失败文案给出「这台机器没有出网」这个具体判断 |
| 服务器**没有 Python/fontTools** ⇒ ② 失败 | 中 | 同上；文案给安装命令；**不自动装**（生产机装包不是后台页面的职责） |
| 构建**跑到一半进程重启** | 低 | 作业状态在 DB；重启后 `running` 的作业由启动时的清理逻辑标成 `failed`（文案写「进程中断」） |
| **重复构建**（两个管理员同时点） | 中 | DB 闸门 + 进程内 `globalThis` 闸门（§3.2） |
| apply 后**旧 release 被误删** ⇒ 访客 D（404 ⇒ 回退系统字体） | 低 | 保留规则（§3.5.4：不是最近 3 份 **且** 被取代时间 > 30 天）+ **清理是单独的动作**（§4.2，apply 不顺手删）+ release 0 永不被删 |
| 切分产物**与仓库里已入库的那份不一致**（语料变了） | **高** | 这是**预期行为**：apply 就是要换产物。页面必须显示「新产物与仓库当前产物的差异摘要」（文件数/字节数） |
| **候选校验**拿「描述线上的」并集样本预算判失败 ⇒ 任何语料变化都构建不成功 | **高** | §3.5.7：候选用 `WEBFONT_PAGE_COST=report`（页面成本只报不算），内禀校验照常判失败 |
| apply 之后**服务器树里**的 `npm run fonts:verify-webfont` **变红** | **高**（语料变了就是必然） | §3.5.7：这是**漂移探测器**在正常工作，不是 bug。修法是**一次人工重新标定** `LIMITS.unionSampleBytes` / `maxUnionSampleFilesPerPage`；后台**绝不自动改预算**（自动改 = wave-2 修掉的假绿灯换个方向再来），只把新旧数字并排显示 |
| apply 改了产物但**没进 git** ⇒ **下一次部署静默回滚** | **高** | §3.5.8：产物**必须回灌**（用户裁定）；页面**醒目**提示「待回灌」+ 给命令 + 「回灌之前不要部署」；后台**不做 git 操作**（§9 第 5 条） |
| 服务器**没装构建工具链**（`subset-font`/`typescript`/`tsx` 是 devDep） ⇒ ③/④ 必崩 | **高**（今天就是这个状态） | §3.4.1：三个包**提到生产依赖** + 能力探针**开工前**发现它（而不是跑到一半崩）+ `DEPLOY.md` 写清楚，防止被挪回去 |
| 回灌之后**仓库树变红** | **高**（必然） | §3.5.9：这是**预期**的（产物/布局变了）。回灌脚本**打印**新的钉死数字；页面列出那 7 条；**红的必须恰好是那 7 条**，别的红就是 bug |
| 磁盘被 release 目录吃满 | 低 | 页面显示占用；保留规则限定 3 份 + 30 天；磁盘探针 |

---

## 8. 验收

⚠️ **验收必须分两组** —— 「产物回灌」（§3.5.8）这个裁定让仓库在 apply 之后
**不再只有一份 release**，于是仓库自己的门禁在 apply 之前与 apply 之后**状态不同**：

| 组 | 什么时候 | 仓库树的样子 | 门禁的期望 |
|---|---|---|---|
| **甲组** | 功能刚落地、**还没有 apply 过** | 只有 release 0 | **必须全绿** |
| **乙组** | apply 之后、**回灌已提交** | release 0 + 新 release | **按设计会红**，红的位置**必须且只能是** §3.5.9 那 7 条 |

### 8.1 甲组（仓库里只有 release 0）

1. `npm run fonts:verify-webfont`（**对已发布的那一份**）仍然 **EXIT=0**，退出码与四行页数字**逐字节不变**；
2. `npm test` **全绿**（含新增的后台路由/组件测试）；
3. `npx tsc --noEmit` EXIT=0；
4. `npm run build` 成功（**在沙箱里**，不动 4444 端口那棵树）；
5. **能力探针**：在**没有 Python** 的机器上打开页面 ⇒ 页面显示「缺 fontTools」并给出安装命令，
   **「开始构建」不可点**；在有 Python 的机器上 ⇒ 显示齐备；
   ⚠️ **新增一条**：把 `node_modules/subset-font` 藏起来 ⇒ 页面显示「**字体构建工具链没装齐**」
   并给出 `npm install subset-font@^2.4.0 typescript@^5.6.3 tsx@^4.19.2 --save`
   （**带 `--save`**，不许建议 `npm install` 无参数），**「开始构建」不可点**；
6. **四步流水线**：在有 Python + 出网的机器上点「开始构建」⇒ 四步依次变绿、
   日志逐行出现、作业状态从 `running` 变 `done`；
   **在 ① 之后人为断网** ⇒ 作业 `failed`，失败文案点名**卡在下载**并说清原因；
   **把 `python` 从 PATH 拿掉** ⇒ 作业在 ② `failed`，文案点名 **fontTools 缺失**并给安装命令；
7. **生产依赖**（§3.4.1）：
   - `package.json` 里 `subset-font` / `typescript` / `tsx` 在 **`dependencies`**（不在 `devDependencies`）；
   - 在一个**只装了生产依赖**的目录里（`npm install --omit=dev`），
     `node -e "require.resolve('subset-font')"` 与 `require.resolve('typescript')` **都成功**，
     `npx tsx --version` 也成功 ⇒ **必须真的验一遍 `npm install --omit=dev`**，不能只看 `package.json`；
   - `package-lock.json` 与 `package.json` 分类一致（`npm install --package-lock-only` 后无 diff）；
8. **TTL 两层**（§3.5.4）：
   - `/font/web/<族>/<文件>.woff2` ⇒ `public, max-age=31536000, immutable`（**没变**）；
   - `/font/fonts-sans.css` ⇒ `public, max-age=2592000`；
   - 两条规则**互斥**（用一条测试断言 `/font/web/...` **不**命中 30 天那条，反之亦然）；
9. **应用**：apply 之后
   - `public/font/fonts-manifest.json` 的 `version` **变了**（= 改写后样式表的哈希）；
   - `public/font/web/r<发布令牌>/` **存在**且文件数与 staging 一致，
     **且每族的 `OFL-<族>.txt` 也在这个 release 目录里**；
   - **release 0 的文件逐字节没变**（`git diff --stat public/font/web/sans` 为空）；
   - 三份样式表里的 woff2 URL **全部**指向 `r<发布令牌>/`（脚本断言，条数相等）；
   - **候选校验**（`WEBFONT_FONT_DIR=<staging> WEBFONT_PAGE_COST=report`）对 staging **EXIT=0**，
     且输出里**有**页面成本数字（标着「描述的是线上那份」）；
   - ⚠️ **若语料变了**，`npm run fonts:verify-webfont` 对 apply 之后的线上目录**按设计变红**
     （§3.5.7：漂移探测器）⇒ 页面必须显示**新旧并集样本数字**与要改的那几行
     （`LIMITS.unionSampleBytes` / `maxUnionSampleFilesPerPage`）；
     **若产物没变**（只是换了发布目录），它仍然 **EXIT=0**；
   - 审计日志里有 `admin_webfont_build_applied` 一条；
   - ⚠️ 页面同时显示「**产物已发布，但尚未回灌仓库**」的**醒目**提示 + 回灌命令；
10. **无豆腐块**：拿 apply 之前抓到的**旧样式表**去请求它声明的每个 woff2 URL ⇒
    **每个都 200 且字节与 apply 之前完全一致**（这条是 G-3 的直接证明，必须写成自动化测试）；
11. **并发**：两个请求同时打 `POST /api/admin/webfonts/build` ⇒ **只有一个 202**，另一个 409；
12. **权限**：未登录 401、非管理员 403；
13. **门禁的相容性**（§3.5.6）：
    - `npm run fonts:verify-webfont` 在**未 apply** 的仓库上仍然 EXIT=0，
      且输出与扩展解析器之前**逐字节相同**；
    - `parseFaceUrl('/font/web/sans/hot.woff2?v=X')` 的返回值与扩展前**语义一致**
      （多一个 `release: ''`）；
    - `parseFaceUrl('/font/web/r<令牌>/sans/hot.woff2?v=X')` 能解析出
      `dir='sans'`、`file='hot.woff2'`、`release='r<令牌>'`；
    - `checkFaceDirectory()` **一个字都没改**（因为 `dir` 仍然是族目录那一段）；
    - 对一个**带发布目录**的目录跑校验脚本，14 条校验**全部照常生效**
      （不是「因为解析不了所以跳过」）；
14. **候选模式不削弱仓库自己的门禁**（§3.5.7）：
    - `npm run fonts:verify-webfont`（**不带任何 env**）的退出码与四行页数字**逐字节不变**
      ⇒ 默认仍是 `enforce`；
    - `WEBFONT_PAGE_COST=report` 下，**内禀**校验仍然判失败：造一个**缺字 / 块超 7 KB /
      CSS 超 175 KB / face 超 3 400** 的产物 ⇒ 仍然 **EXIT=1**；
    - `WEBFONT_PAGE_COST=report` 下，**页面成本**只报不算：造一个**并集样本超预算**的产物
      ⇒ **EXIT=0**，但输出里**必须有**那个超预算的数字 + 「描述的是线上那份」的标注；
    - `WEBFONT_FONT_DIR` 不设时，校验器读的文件路径与今天**逐字节一致**。

### 8.2 乙组（apply 之后、回灌已提交）

**前提**：甲组全绿 ⇒ 在生产机上 apply 一次 ⇒ 回灌脚本跑完并提交 ⇒ 仓库里现在有**两份** release。

15. **回灌脚本**（§3.5.8）：
    - `node scripts/fonts/import-webfont-release.mjs --release r<T>` **成功**，
      `git status` 里**只有**那五样东西（新增 release 目录、三份样式表、manifest、releases.json）；
    - 它**打印**了 §3.5.9 的 4 组新数字（文件数、总字节、原始 CSS 字节、三个 gzip 字节），
      且这 4 组数字**就是**把那些值填进 `tests/unit/lib/fonts-css.test.ts` 之后测试能过的值；
    - manifest 的 V **等于**三份样式表的哈希（不一致 ⇒ 脚本**拒绝**，不 stage）；
16. **仓库树按设计变红，且只红在那几处**：
    - `npm test` **红**，红的地方**恰好**是 §3.5.9 的第 1/2/3/4/7 条；
    - **其余任何一条测试红 ⇒ 是 bug**（不是「预期变红」）；
    - 按 import 脚本打印的数字重标定之后 ⇒ `npm test` **重新全绿**；
    - ⚠️ 第 5/6 条（`LIMITS` 的并集样本预算）**只有语料变了才红**；
      只换发布目录、产物没变 ⇒ 那一条**不红**；
17. **仓库与线上一致**：回灌提交之后，仓库树与服务器树的
    `public/font/web/r<T>/` **文件数与字节数相等**（一条比对脚本），
    三份样式表**逐字节相等**，manifest **逐字节相等**；
18. **静默回滚这条陷阱被堵住**：模拟一次不带 `--delete` 的 rsync
    （仓库 → 服务器）⇒ 服务器上的样式表**没有被旧版本覆盖**
    ⇒ 访客拿到的仍是新字体（这条要写成自动化测试，别靠人记）。

---

## 9. 未决（留给实施期裁决，控制器定）

⚠️ 标了「**已定（用户 2026-10-31）**」的三条，是**用户拍板的**，实施期不再讨论。

| # | 问题 | 裁决方向 |
|---|---|---|
| 1 | 作业表的 `log` 无限增长怎么办 | 保留最近 20 条作业的完整日志，更早的**清空 log 但保留元数据**（触发时机：新建作业时） |
| 2 | 取消语义 | 「取消」= 置 `cancelled` 并**让子进程自然跑完**（不强杀），因为强杀可能留下半个 woff2。下一次清理会扫掉残留 |
| 3 | 是否允许**不下载**（复用已有 staging） | 允许：能力面板给一个「源字体已在本地（大小已核对）」的提示，① 显示为 `skipped` 而不是假装下载了 |
| 4 | 旧 release 保留 3 份还是更多 | 3 份（当前 + 前 2）。⚠️ 理由要改成新的：**删除条件是「被取代时间 + 30 天」**，而 30 天这个上界来自**样式表那一层**的 TTL（§3.5.4），不是来自「woff2 的 TTL 变了」 |
| 5 | 仓库与线上不一致时要不要自动 commit | **不要**（**已定（用户 2026-10-31）**：回灌，仓库与线上一致）。⚠️ 但「回灌」**不等于**后台自动 commit —— 后台**依然不做任何 git 操作**（安全边界）；回灌由**脚本 + 人工**完成（§3.5.8），后台只显示「待回灌」的事实与命令 |
| 6 | 页面要不要显示「与仓库当前产物的差异」 | 要（§7 的「切分产物与仓库里已入库的那份不一致」那一行）—— 用文件数 + 总字节两个数就够，不必做逐文件 diff |
| 7 | **发布令牌与清单版本是不是同一个** | **不是**（§3.5.2）：发布令牌 T = 改写前样式表的哈希（进目录名），清单版本 V = 改写后样式表的哈希（进 manifest）。wave-2 的 `checkManifest` 要求 manifest 版本等于**线上**样式表的哈希 ⇒ V 必须是改写后的。两者都是内容的函数 |
| 8 | 发布目录的保留规则怎么定「最近」 | 按**目录 mtime** 倒序（「最近」= 最新 mtime；发布令牌是哈希，不是单调的）；⚠️ **删除条件的时间基准是「被取代时间」（`supersededAt`），不是创建时间**（**已定（用户 2026-10-31）**）—— 删除条件 = 「不是最近 3 份」**且**「被取代时间超过 30 天」（§3.5.4） |
| 9 | wave-2 的校验门禁要不要动 | **要动，但只是「超集扩展」**：解析器多认一种可选的发布目录段（§3.5.6）。涉及 4 个 wave-2 文件，**必须在实施记录里披露**，且**不许改 14 条校验的判据**、**不许改 `LIMITS` 的任何数字** |
| 10 | 服务器上缺构建工具链怎么办 | **提到生产依赖**（**已定（用户 2026-10-31）**）：`subset-font` / `typescript` / `tsx` 移进 `dependencies`（§3.4.1）；代价 ≈ 24 MB；收益 = 能力探针能在开工前发现它，而不是跑到 ③/④ 崩 |
| 11 | 子进程怎么跑（作业里 import 脚本 vs 拉起子进程） | **拉起子进程**（`child_process.spawn`）：四个 npm 脚本本来就各自是独立进程；作业要拿到**逐步日志**、要能**取消**、崩了不能拖垮 Next 进程 |
| 12 | staging 什么时候删 | **成功就删**（产物已经进 release 目录，staging 只是中转）；**失败保留 7 天**（给人排查），页面显示「这份 staging 还剩几天会被清掉」 |
| 13 | `OFL` 许可证放在哪 | **每一份 release 目录里都要有自己那份**（§3.7 表 1 第二行）：现在许可证只在 `web/` 根上，发布目录里一份都没有 ⇒ 每一份 release 必须自足 |
| 14 | apply 面板要不要列「要改哪些钉死的数」 | **要**：列 §3.5.9 那 7 条（文件:行 + 现在钉的数 + 新的该是多少），新数字来自候选校验的 `report` 输出与 import 脚本的打印；⚠️ **只显示、不代写**（自动改预算 = wave-2 修掉的假绿灯） |
| 15 | 下载跳过按什么判 | **按大小**（响应的 `Content-Length` 与本地文件一致 ⇒ 跳过）；⚠️ **盲区要如实说明**：大小相同但内容不同的情况**判不出来**；而且**服务器不可达时绝不允许授权跳过**（那是「没拿到证据」，不是「证据是相同的」） |
