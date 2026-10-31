# 后台字体流水线（/admin/settings/webfonts）设计文档

> **状态**：待用户批准（本文是本功能的**唯一需求来源**；实施计划另写）。
> **分支**：另开分支（`feature/admin-webfont-pipeline`），从 wave-2 的收尾 tip 切出。
> **与 wave-2 的关系**：本功能**不改** wave-2 的 spec
> （`docs/superpowers/specs/2026-10-29-site-optimization-wave2-design.md`），
> 也**不改** wave-2 的切分算法与预算。它只是把 wave-2 已经建好的那条流水线
> **搬进后台，让管理员能自己跑**。凡是需要改 wave-2 既有脚本的地方，本文件
> §5.8 逐条列出「改什么、为什么必须改」。

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
| **G-3** | 应用后**不产生豆腐块**：任何一份**曾经发布过**的样式表，它引用的字体文件**必须仍然存在且内容不变** |
| **G-4** | 缺能力（Python / fontTools / 网络 / 磁盘）**明确报错并说清怎么装**；**绝不**假装成功、绝不静默跳过 |
| **G-5** | 每次「开始构建」「构建失败」「应用」「应用失败」都进**审计日志** |
| **G-6** | 零新增运行时依赖（G3）；零云端字体请求（页面上线后不引用任何 CDN 字体） |

### 2.2 非目标（本波明确不做）

- **不做**字体上传 / 自定义字体源（只从上游固定清单下载）。
- **不做**在后台调热区字数、Ext 块宽、字符集白名单（那些是 wave-2 的设计参数，
  改它们 = 改 wave-2 的 spec 与切分计划，超出本功能）。
- **不做**在服务器上跑 `npm run build`（理由见 §5.6）。
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
- 页面分三块：
  1. **能力面板**（服务器具备什么、缺什么、怎么装）；
  2. **构建面板**（四步进度 + 日志 + 「开始构建」/「取消」）；
  3. **应用面板**（staging 里的产物摘要 + 「应用」按钮 + 应用后的说明）。

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
| **③ 切分** | 三族切成 hot/Ext/latin/latin-ext + 三份样式表 + manifest | `scripts/fonts/build-webfont-subsets.mjs` | **staging 输出目录**（§3.5） | 任一族失败 ⇒ 整步失败 |
| **④ 校验** | 零缺字 + **产物内禀**门禁（块大小/CSS 大小/face 数/覆盖率/拉丁）＋ **页面成本只报不算**（§3.5.7） | `scripts/fonts/verify-webfont-subsets.mjs`（`WEBFONT_PAGE_COST=report`） | 报告 | 任一内禀校验不过 ⇒ **失败**，并把超标数字写进作业日志 |

**关键约束**：

- **①②的产物目录是共享的**（`scripts/fonts/staging/web/`）：
  下载器按「远端 Content-Length == 本地大小」决定跳过 ⇒ 重复构建**不会**重复下载 70 MB。
  ⚠️ 但**轴裁剪会重写**那两份轴实例 ⇒ 它们的字节可能变 ⇒ 版本令牌变 ⇒ 全量重下载。
  ⇒ 因此 **② 只在 ① 之后、且当轴实例不存在时**才跑；已存在则**跳过并如实标注**。
- **③必须写进 staging，不能就地写 `public/font/`**（否则「staging + 显式应用」就没了，
  而且会破坏 §3.5 的发布模型）。⇒ 需要给切分脚本加**输出根目录覆盖**（§5.8）。
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

⚠️ 探针**只读不写生产目录**；上游探测**只发一个 HEAD**（不下载 70 MB），
真正的下载在 ① 里做（那里有 size contract）。

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
8. 记录审计日志。

⇒ **「apply 之后 verify 变红」这件事不可能发生**：校验通过之后才换。


#### 3.5.3 为什么这个模型不会产生豆腐块

| 谁 | 请求什么 | 拿到什么 | 一致吗 |
|---|---|---|---|
| 访客 A：**没缓存过**样式表 | `/font/fonts-sans.css?v=<旧 manifest>` | 服务器返回**新**样式表（新版本的内容）⇒ 新样式表指向 `r<新令牌>/…` ⇒ 新文件在盘上 | ✅ 一致 |
| 访客 B：**缓存了旧样式表**（immutable 一年） | 旧样式表里的 `/font/web/sans/hot.woff2?v=旧族令牌` | **release 0 的目录原封不动** ⇒ 旧字节 ⇒ 与旧样式表的 unicode-range 一致 | ✅ 一致 |
| 访客 C：缓存了旧样式表，但某个 ext 块**当时没被画过**⇒ 没缓存那个 woff2 | 同上 | 服务器返回**旧字节**（release 0 未被覆盖） | ✅ 一致 |

⇒ **只要旧 release 目录不被覆盖，任何一份旧样式表都仍然指向它声明的那批字节。**

#### 3.5.4 旧 release 的清理

- 规则：一个 release 目录只有在**同时**满足下面两条时才可以删：
  1. 它**不是**最近 3 份之一（当前 + 前 2）；
  2. 它的创建时间**超过 30 天**。
- 为什么要第 2 条：`/font/**` 的 `max-age` 降到 30 天之后，访客可能**缓存着
  30 天内的旧样式表**；只要旧样式表还在有效期内，它声明的 woff2 就必须还在。
- ⚠️ **release 0（`web/sans/`、`web/serif/`、`web/wenkai/`，无 `r` 前缀）
  永远不许删** —— 它是当前所有旧样式表的依赖。
- 顺序：按**目录 mtime** 倒序（「最近」= 最新 mtime）。
  ⚠️ 发布令牌 T 是哈希，**不是单调的** ⇒ 不许按 T 排序。
- TTL 改动属于 wave-2 的 `next.config.ts`，实施计划里**单列一条**并说明理由：
  版本令牌机制本来就负责改版 ⇒ 字体文件不需要 immutable 一年。
- 磁盘占用：3 份 release × 41 MB ≈ 123 MB，**外加永不删除的 release 0 ≈ 41 MB**
  ⇒ 合计 ≈ 164 MB。页面上要显示这个数。

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
**写死了三处**：

| # | 位置 | 写死的东西 | 不改会怎样 |
|---|---|---|---|
| 1 | `parseFaceUrl()` | 正则只允许 `/font/web/<一段>/<文件>` | 新布局有三段 ⇒ 解析失败 ⇒ 门禁报「face 没指向 /font/web/…」 |
| 2 | `checkFaceDirectory()` | URL 的目录段必须**等于**族名 | 新布局的目录段是 `r<T>/<族>` ⇒ 报「指向了别的族的目录」 |
| 3 | 读盘路径 | `join(WEB_DIR, url.dir, url.file)` | 读不到文件 ⇒ 报「文件缺失」 |

⇒ **解法是让解析器多认一种「可选的发布目录段」**：

```
/font/web/<发布段?>/<族>/<文件>
```

- 发布段**缺省**（release 0，今天的布局）⇒ 行为与今天**逐字节一致**；
- 发布段存在 ⇒ 新能力。

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

### 3.6 权限 / 审计 / 错误

- **权限**：所有三个 API 路由都走 `lib/auth.ts` 的 `requireAdmin()`
  （未登录 401 / 非管理员 403），与后台其它页面一致。
- **审计**（沿用 `logUserAction`，metadata 带标题/版本号）：
  | 事件 | action 名 |
  |---|---|
  | 开始构建 | `admin_webfont_build_started` |
  | 构建失败 | `admin_webfont_build_failed` |
  | 应用发布 | `admin_webfont_build_applied` |
  | 应用失败 | `admin_webfont_build_apply_failed` |
- **错误**：所有失败**必须**非零退出/非 2xx 响应，且**文案说真话**（G12）：
  - HTTP 层：4xx/5xx + 一句人话 + `code` 字段（机器可判）+ `detail`（可读的细节）；
  - 作业层：`status = 'failed'` + `error` 字段写清**卡在哪一步、为什么、怎么修**；
  - **不许**把子进程的 stderr 原样糊给用户（可能含路径/内部信息）——
    要**摘取关键行**并附上「完整日志见作业日志」。

### 3.7 要改的既有脚本（清单，每条都要有理由）

| 文件 | 改什么 | 为什么必须 |
|---|---|---|
| `scripts/fonts/build-webfont-subsets.mjs` | 字体根目录可覆盖：**新增 `WEBFONT_FONT_DIR`**（指向**字体根目录**，默认 = `public/font`；切分输出 = `<root>/web`，样式表 = `<root>/fonts-<族>.css`，manifest = `<root>/fonts-manifest.json`）。默认行为**一字不变** | 让 ③ 写进 staging 而不是就地写线上（§3.5） |
| `scripts/fonts/verify-webfont-subsets.mjs` | ① 认**同一个 `WEBFONT_FONT_DIR`**（默认不变 ⇒ 行为不变）；② **新增 `WEBFONT_PAGE_COST`**（`enforce` 默认 / `report`），语义见 §3.5.7 | 让 ④ 校验 staging 里那一份（§3.3），且候选模式不拿「描述线上那份」的样本预算判失败 |
| `scripts/fonts/download-webfont-sources.ts` | **不改逻辑**；只是在被 API 调用时复用它已导出的 `downloadFont()` | 避免把「size contract」抄第二份（wave-2 的教训：抄一份就会漂） |
| `scripts/fonts/instance-webfont-axis.mjs` | 暴露一个可被调用的函数（把 `main()` 的逻辑抽成 `instanceAll()`），`main()` 变成薄壳 | 让 ② 能在作业里被调用并拿到逐步日志 |
| `next.config.ts` | `/font/**` 的 `max-age` 从一年改成 **30 天** | §3.5.4：让「保留最近 3 个 release」足以覆盖缓存窗口 |

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

⚠️ **除上面这 9 个文件之外的既有文件一律不许改。** 尤其：
wave-2 的 spec、预算 `LIMITS`、切分计划 `webfont-charset.mjs`、fixture `data/font-page-profiles.json`。

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

---

## 5. API 契约

| 方法 | 路径 | 用途 | 成功 | 失败 |
|---|---|---|---|---|
| `GET` | `/api/admin/webfonts/capability` | 能力探针（§3.4） | `200 { ok, python, fonttools, network, disk, sources[] }` | `200` 但 `ok:false`（探针本身失败不是服务器错误） |
| `POST` | `/api/admin/webfonts/build` | 开始一次构建 | `202 { jobId }` | `409`（已有活跃作业，带 `jobId`） |
| `GET` | `/api/admin/webfonts/build` | 最近 10 条作业 | `200 { jobs: [...] }` | — |
| `GET` | `/api/admin/webfonts/build/[id]` | 单个作业状态 + 日志 | `200 { job }` | `404` |
| `POST` | `/api/admin/webfonts/build/[id]/cancel` | 取消（仅 `pending`/`running`） | `200 { job }` | `409`（已结束） |
| `POST` | `/api/admin/webfonts/build/[id]/apply` | 把 staging 的产物应用上线 | `200 { job, manifestVersion, releaseDir }` | `409`（作业不是 `done`）/ `500`（应用失败） |

- 全部走 `withErrorHandling` + `requireAdmin`（与后台其它路由同构）。
- 入参用 zod 校验（与 `/api/admin/chars/generate` 同款）。
- **apply 的幂等**：同一个作业**不允许 apply 两次** ⇒ 第二次返回 409 并说明「已应用过」。

---

## 6. 前端

- `app/admin/settings/webfonts/page.tsx`（服务端壳）+ `components/admin/WebfontPipelinePanel.tsx`（客户端）。
- 组件职责：
  - 挂载时拉一次 capability + 最近作业；
  - 「开始构建」⇒ `POST` ⇒ 拿 `jobId` ⇒ **每 1.5 s** 轮询状态 ⇒ 轮询到 `done|failed|cancelled` 停；
  - 日志区**增量追加**（只渲染新增行，别每 1.5 s 重画全文）；
  - 「应用」按钮**只在 `status === 'done'` 且存在 staging 产物时**可点；
  - **离开页面不取消作业**（作业在服务端继续），但要提示「作业仍在运行」。
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
| apply 后**旧 release 被误删** ⇒ 豆腐块 | 低 | 保留规则 + 「只有既不是当前也不是前 2 个才可删」+ 30 天 TTL（§3.5.4） |
| 切分产物**与仓库里已入库的那份不一致**（语料变了） | **高** | 这是**预期行为**：apply 就是要换产物。页面必须显示「新产物与仓库当前产物的差异摘要」（文件数/字节数） |
| **候选校验**拿「描述线上的」并集样本预算判失败 ⇒ 任何语料变化都构建不成功 | **高** | §3.5.7：候选用 `WEBFONT_PAGE_COST=report`（页面成本只报不算），内禀校验照常判失败 |
| apply 之后**服务器树里**的 `npm run fonts:verify-webfont` **变红** | **高**（语料变了就是必然） | §3.5.7：这是**漂移探测器**在正常工作，不是 bug。修法是**一次人工重新标定** `LIMITS.unionSampleBytes` / `maxUnionSampleFilesPerPage`；后台**绝不自动改预算**（自动改 = wave-2 修掉的假绿灯换个方向再来），只把新旧数字并排显示 |
| apply 改了产物但**没进 git** ⇒ 仓库与线上不一致 | 高 | 页面必须显示提示：「apply 只改服务器上的文件，**不会**自动 commit；要让仓库与线上一致，请把 `public/font/` 的变更提交并部署。」 |
| 磁盘被 release 目录吃满 | 低 | 页面显示占用；保留规则限定 3 份；磁盘探针 |

---

## 8. 验收

1. `npm run fonts:verify-webfont`（**对已发布的那一份**）仍然 **EXIT=0**，退出码与四行页数字**逐字节不变**；
2. `npm test` 全绿（含新增的后台路由/组件测试）；
3. `npx tsc --noEmit` EXIT=0；
4. `npm run build` 成功（**在沙箱里**，不动 4444 端口那棵树）；
5. **能力探针**：在**没有 Python** 的机器上打开页面 ⇒ 页面显示「缺 fontTools」并给出安装命令，
   **「开始构建」不可点**；在有 Python 的机器上 ⇒ 显示齐备。
6. **四步流水线**：在有 Python + 出网的机器上点「开始构建」⇒ 四步依次变绿、
   日志逐行出现、作业状态从 `running` 变 `done`；
   **在 ① 之后人为断网** ⇒ 作业 `failed`，失败文案点名**卡在下载**并说清原因；
   **把 `python` 从 PATH 拿掉** ⇒ 作业在 ② `failed`，文案点名 **fontTools 缺失**并给安装命令；
7. **应用**：apply 之后
   - `public/font/fonts-manifest.json` 的 `version` **变了**（= 改写后样式表的哈希）；
   - `public/font/web/r<发布令牌>/` **存在**且文件数与 staging 一致；
   - **release 0 的文件逐字节没变**（`git diff --stat public/font/web/sans` 为空）；
   - 三份样式表里的 woff2 URL **全部**指向 `r<发布令牌>/`（脚本断言，条数相等）；
   - **候选校验**（`WEBFONT_FONT_DIR=<staging> WEBFONT_PAGE_COST=report`）对 staging **EXIT=0**，
     且输出里**有**页面成本数字（标着「描述的是线上那份」）；
   - ⚠️ **若语料变了**，`npm run fonts:verify-webfont` 对 apply 之后的线上目录**按设计变红**
     （§3.5.7：漂移探测器）⇒ 页面必须显示**新旧并集样本数字**与要改的那几行
     （`LIMITS.unionSampleBytes` / `maxUnionSampleFilesPerPage`）；
     **若产物没变**（只是换了发布目录），它仍然 **EXIT=0**；
   - 审计日志里有 `admin_webfont_build_applied` 一条；
8. **无豆腐块**：拿 apply 之前抓到的**旧样式表**去请求它声明的每个 woff2 URL ⇒
   **每个都 200 且字节与 apply 之前完全一致**（这条是 G-3 的直接证明，必须写成自动化测试）；
9. **并发**：两个请求同时打 `POST /api/admin/webfonts/build` ⇒ **只有一个 202**，另一个 409；
10. **权限**：未登录 401、非管理员 403；
11. **门禁的相容性**（§3.5.6）：
    - `npm run fonts:verify-webfont` 在**未 apply** 的仓库上仍然 EXIT=0，
      且输出与扩展解析器之前**逐字节相同**；
    - `parseFaceUrl('/font/web/sans/hot.woff2?v=X')` 的返回值与扩展前**语义一致**
      （多一个 `release: ''`）；
    - `parseFaceUrl('/font/web/r<令牌>/sans/hot.woff2?v=X')` 能解析出
      `dir='sans'`、`file='hot.woff2'`、`release='r<令牌>'`；
    - 对一个**带发布目录**的目录跑校验脚本，14 条校验**全部照常生效**
      （不是「因为解析不了所以跳过」）。
12. **候选模式不削弱仓库自己的门禁**（§3.5.7）：
    - `npm run fonts:verify-webfont`（**不带任何 env**）的退出码与四行页数字**逐字节不变**
      ⇒ 默认仍是 `enforce`；
    - `WEBFONT_PAGE_COST=report` 下，**内禀**校验仍然判失败：造一个**缺字 / 块超 7 KB /
      CSS 超 175 KB / face 超 3 400** 的产物 ⇒ 仍然 **EXIT=1**；
    - `WEBFONT_PAGE_COST=report` 下，**页面成本**只报不算：造一个**并集样本超预算**的产物
      ⇒ **EXIT=0**，但输出里**必须有**那个超预算的数字 + 「描述的是线上那份」的标注；
    - `WEBFONT_FONT_DIR` 不设时，校验器读的文件路径与今天**逐字节一致**。

---

## 9. 未决（留给实施期裁决，控制器定）

| # | 问题 | 裁决方向 |
|---|---|---|
| 1 | 作业表的 `log` 无限增长怎么办 | 保留最近 20 条作业的完整日志，更早的**清空 log 但保留元数据**（触发时机：新建作业时） |
| 2 | 取消语义 | 「取消」= 置 `cancelled` 并**让子进程自然跑完**（不强杀），因为强杀可能留下半个 woff2。下一次清理会扫掉残留 |
| 3 | 是否允许**不下载**（复用已有 staging） | 允许：能力面板给一个「源字体已在本地（大小已核对）」的提示，① 显示为 `skipped` 而不是假装下载了 |
| 4 | 旧 release 保留 3 份还是更多 | 3 份（当前 + 前 2），因为 §3.5.4 把 TTL 降到 30 天 |
| 5 | 仓库与线上不一致时要不要自动 commit | **不要**。后台页面不做 git 操作（安全边界），只显示提示 |
| 6 | 页面要不要显示「与仓库当前产物的差异」 | 要（§7 最后一行的风险）—— 用文件数 + 总字节两个数就够，不必做逐文件 diff |
| 7 | **发布令牌与清单版本是不是同一个** | **不是**（§3.5.2）：发布令牌 T = 改写前样式表的哈希（进目录名），清单版本 V = 改写后样式表的哈希（进 manifest）。wave-2 的 `checkManifest` 要求 manifest 版本等于**线上**样式表的哈希 ⇒ V 必须是改写后的。两者都是内容的函数 |
| 8 | 发布目录的保留规则怎么定「最近」 | 按**目录 mtime** 倒序（发布令牌是哈希，不是单调的）；删除条件 = 「不是最近 3 份」**且**「超过 30 天」（§3.5.4） |
| 9 | wave-2 的校验门禁要不要动 | **要动，但只是「超集扩展」**：解析器多认一种可选的发布目录段（§3.5.6）。涉及 4 个 wave-2 文件，**必须在实施记录里披露**，且**不许改 14 条校验的判据**、**不许改 `LIMITS` 的任何数字** |
