# 对韵消消 — 实施记录（2026-11-20）

计划：`docs/superpowers/plans/2026-11-20-duiyun-match-game.md`
分支：`main`（直接落在 main 上，未开工作树）
提交：`57d91d1c9` 抽取语料 → `90515d899` 规则 → `2f498abe7` 接口 →
`c847517a5` 组件 → `5e092a268` 挂到 /game → `3e2d84bd3` 真机走查修的三个坑 →
`72c933d69` 拼音规则修正

这份记录保存的是**裁决和发现** —— 每一处「计划说的」和「代码实际做的」
不一致的地方，以及为什么这么定。台账本身是 git-ignored 的草稿，这里留一份
能进版本库的。

---

Executor: inline (superpowers:executing-plans). Branch: main (repo convention — the other games landed on main). No push.

Pre-flight shared interfaces:
- Task 1 produces `data/duiyun-pairs.json`; Task 3's `lib/duiyun-data.ts` reads it. Shape pinned in Task 1's Interfaces block; Task 3's `DuiyunPair` import comes from `lib/duiyun-rules.ts` (Task 2). No shape conflict found.
- Task 2 produces `lib/duiyun-rules.ts`; Task 3 and Task 4 consume it. Task 2's `DuiyunPair` interface and Task 1's generated JSON must agree on field names: upper / lower / upperPinyin / lowerPinyin / rhyme / book. Task 1's script declares its own copy of the interface (it must not import from Task 2 — the script runs before the rules module exists in the same commit order); the field names are identical by construction.
- Task 4 produces `components/game/DuiYunGame.tsx`; Task 5 wires it into `components/game/quest/QuestTabs.tsx`. `QuestTab` union gains 'duiyun'; `?tab=duiyun` is the URL contract.

Task 1: complete (commits 57d91d1c9, tests: npx vitest run tests/unit/scripts/build-duiyun.test.ts → 8 passed)

Ruling: 计划里的「212 对」是错的 —— 那次统计用的汉字计数正则没带 g，`match`
        只返回第一个匹配，于是所有两字的对句都被误判成「一边一字、一边两字」
        而丢掉。真实数字是 761 对（1 字 283 + 2 字 478）。
        我改的是代码不是规格 —— 规格说的是「平仄逐位相反的那些」，761 对才是
        满足这个条件的东西，212 是统计工具的错。
        代价：计划文档的 Assessment Evidence 表和 Task 1/3/6 的 Expected 数字
        都已订正；台账模板里的裁决行也改了。
Ruling: 汉字计数必须用带 g 的正则 —— 已写成回归测试
        「keeps the couplets whose two sides have more than one character」。
        变异验证过：把 matchAll 改回 match，两个用例立刻变红。
        代价：无 —— 这是纯 bug 修复。
Ruling: 计划预期「205–220 对」改成了「700–820 对」。
        代价：若将来语料变了，这个区间要重新量。
Ruling: 全量测试跑出 tests/integration/api/quest-file-vs-db.test.ts 超时，
        单独跑该文件是绿的（6/6，6.3s）。这是仓库既有的 5s 超时问题
        （记忆 boundary-test-times-out-under-full-suite），与本次改动无关
        —— 本次只新增了 scripts/、data/、tests/unit/scripts/ 下的文件，
        没有碰任何既有模块。
        代价：无 —— 但收尾时要如实报告，不能装作全绿。

Task 2: complete (commits 90515d899, tests: npx vitest run tests/unit/lib/duiyun-rules.test.ts → 21 passed)

Ruling: 声调表不复制一份 —— 直接用 lib/pinyin-tone.ts 的 TONE_MAP 和
        toneFromPinyin。计划里写的是「在 duiyun-rules.ts 里自己写一张表」，
        那是多余的：仓库已经把这 24 个声调符号收在一处，抄一份就是制造
        第二个事实来源。
        代价：无。

Ruling: isBlank 和 filled 分开记（计划只写了 isBlank 一个字段）。
        计划的做法有个洞：填好之后 isBlank 变 false，这一位就跟「从来没
        挖过」长得一模一样，liftCharacter 取不回来玩家的字，「填错了可以
        点空格把字取回来」这条就废了。
        代价：DuiyunSlot 多一个字段，界面要用 filled 决定显示「？」还是字。

Ruling: 去声调用 NFD 分解，不能只把带调的字符删掉 ——
        'ō' 删掉就不是 'o' 了，'zhōng' 会变成 'zhng'，韵母算出 'ng'。
        代价：无。

Ruling: ~~语料里的 ü 写成 `l` + U+01DC（组合分音符挂在声母 l 上），不是挂在
        u 上。要先把它挪成 `lü` 再做 NFD。~~
        **这条 ruling 是错的，2026-11-20 订正。** U+01DC 是预组合字母 ǜ，
        不是组合记号（组合分音符是 U+0308，「below」是 U+0324）；而且语料里
        一个组合记号都没有 —— 621 个不同音节逐个拆 codepoint，combining
        mark 的数量是 0。ü 全是预组合的，且**声调不同字母就不同**：
        lǜ 006C 01DC、lǚ 006C 01DA、lǘ 006C 01D8、nǚ 006E 01DA。
        当年那条正则只认了 ǜ 一种，于是 lǚ/lǘ/nǚ 的韵母全算成了 u。
        现在的规则一次拆出声母和韵母，ü 的四种带调形式全认。
        代价：多一段专门处理 ü 的代码。

Ruling: 计划写的「挖空位永远不挖「对」字」这条删掉了 ——
        语料里的对句是以「天对地」这种形状存的，「对」字在 upper/lower
        之外，没有「对」字可挖。
        代价：无。

变异验证（每个都真的变红了）：
  isPing 只认 1 声 / drop 去掉字对不对的检查 / drop 去掉 slot_filled 检查 /
  chooseBlanks 只挖上句 / toneOf 恒返回 1 / lift 去掉 filled 守卫 /
  blanksRemaining 少一个条件 / 字盘不打乱 / buildRound 挖 0 个空 /
  buildRound 初始 filled=true / lift 之后 filled 不清 —— 全部变红。
两个「存活」的变异经查是语义等价（finalOf 的 >= 与 >、isRoundWon 的两个
条件的顺序），不是测试漏掉了什么。

Task 3: complete (commits 2f498abe7, tests: npx vitest run tests/unit/app/api/duiyun.test.ts → 7 passed; tests/unit/lib/api-duiyun.test.ts → 6 passed)

Ruling: 计划没给客户端写测试，我补了 tests/unit/lib/api-duiyun.test.ts（6 个用例）。
        理由：「失败的信封不缓存」这条规则如果没人钉住，界面的「重试」按钮
        就会静悄悄地变成摆设 —— 缓存了失败，玩家按多少次重试都读同一个错。
        变异验证过：把 eviction 改成只 catch rejection，「does not cache a
        failed answer」立刻变红。
        代价：无，多了 6 个用例。

Ruling: 真机核对过数据读取 —— 761 对、limit 生效、count 一致。
        tsc 干净。

Task 4: complete (commits c847517a5, tests: npx vitest run tests/unit/components/game/DuiYunGame.test.tsx → 16 passed)

Ruling: 计划的组件测试少写了两条，我自己补了：
        「 lowers the blank count as the player fills the blanks」——
        计划的用例只断言「还剩 1 个空」，而简单档正好只挖 1 个空，所以把
        remaining 写死成 1 也不会红。补的这条在填完一个空后断言「还剩 0 个空」。
        「 draws a different couplet for the next round」——
        不测这个的话，每一局都抽同一副对联也没有任何用例会红。
        代价：多了 2 个用例。

Ruling: 组件测试的 mock 语料原来第二副是「晨/午」（一字对一字），
        改成了「山花/海树」（两字对两字）。
        原因：超难档挖 3 个空，一字对一字的对句只有 2 个位置，规则会正确地
        把它裁到 2 个 —— 这是对的行为，但测试断言的「3 个空」就永远不成立。
        改 mock 比改断言对：真实语料里两字对两句占大多数（478/761）。
        代价：无。

变异验证（每个都真的变红了）：
  删掉韵部行 / 拒绝时不给提示 / 删掉平仄标记 / 禁用取回 / 删掉通关面板 /
  空的数量写死 / 换掉「还没有对韵数据」的话 / 忽略选中的字 /
  难度被忽略（永远简单）/ 每局抽同一副 / 通关状态不设 / 删掉「再来一副」/
  种子不递增 —— 全部变红。

Task 5: complete (commits 5e092a268, tests: npx vitest run → 2741 passed, 21 skipped; npx tsc --noEmit → clean; npm run build → 成功)

改动：components/game/quest/QuestTabs.tsx 三处 —— import DuiYunGame、
QuestTab 联合类型加 'duiyun'、TABS 加 { id: 'duiyun', label: '对韵' }、
面板分支加 tabs.tab === 'duiyun' ? <DuiYunGame />。注释里的
「六个面板 / 六项 / 其他五个档」一并改成七。

测试：tests/unit/components/game/QuestTabs.test.tsx 加了 4 个用例
（offers a 对韵 tab / opens the 对韵 panel for ?tab=duiyun /
switches to the 对韵 panel when the tab is clicked /
does not request the level map for the 对韵 panel），
照 接字、成语 两组的既有写法：游戏本体被 mock 成 <div data-duiyun-game />。

Ruling: 联合类型那一处，运行时测试钉不住 ——
        QuestTab 联合类型只是 TABS 表的 type，删掉 'duiyun' 之后
        TABS 里那一行会变成 TS2322，运行时一个用例都不会红。
        变异验证时发现这条「存活」，不是测试的漏洞，是这一层的性质：
        类型层由 tsc 把关。已单独验证：删掉联合类型成员后
        npx tsc --noEmit 报 2 个错（TS2322 + TS2367）。
        代价：无，类型层本来就不该由运行时用例来钉。

Ruling: 全量套件跑出过两次 5s 超时（client-server-boundary 的 tree 扫描，
        quest-file-vs-db），单跑都过。查过了：这次改动只动了
        components/game/quest/QuestTabs.tsx 一个既有文件，扫描的输入树
        一行没多（git diff --stat 只有那一个文件）。 stash 掉本次改动后
        全量绿、再 stash 回来重跑也绿 —— 所以是并发负载下的抖动，
        不是本次改动引入的回归。已在最终报告里如实说明。
        代价：全量套件偶发红灯，需要重跑确认。

变异验证（每个都真的变红了）：
  标签改成「对对」 → 2 红 / 删掉 TABS 里的对韵行 → 4 红 /
  删掉面板分支 → 3 红 / 联合类型删掉 'duiyun' → 运行时不变，tsc 2 错。

Task 6: complete (commits —, tests: npx tsx --env-file-if-exists=.env scripts/audit-gaps.ts → 七节全 (none))

体检：scripts/audit-gaps.ts 七节全部 (none) ——
  script environment gaps / runtime data missing from the bundle /
  references to scripts that do not exist / npm scripts pointing at a
  missing file / commands in the docs that cannot run /
  numbers in the docs that contradict the code /
  chapter ids that break their corpus convention。

数据复核（用一份独立写的 Python 声调表重算，没用项目里的 TONE_MAP）：
  761 对；一字对一字 283、二字对二字 478；
  声律启蒙 381 + 笠翁对韵 380；30 个韵部标签；
  重复 0；上下句字数不等 0；缺字段 0；
  每个音节都带声调标记（0 个没带的）；
  逐位平仄对仗不成立的对子 0。

Ruling: 有两对上下句同音同调头 —— 「漏箭/书笺」的 jiàn/jiān，
        「唐诗/汉史」的 shī/shǐ。
        这不是缺陷：箭/笺、诗/史 本来就是同音字对，
        而游戏要的是平仄相对 —— 箭(jian4,仄)对笺(jian1,平)、
        诗(shi1,平)对史(shi3,仄)，两句都成立。
        所以「声母+韵尾相同」不作废，只作记录。
        代价：无。

Ruling: ~~计划第 6 条规则（j/q/x 后的 iu 要记作 iou）已核 ——
        761 对里没有一对会被这条规则改变判定：
        规则照写，语料没有踩到它的边角。~~
        **这条 ruling 的推理是错的，2026-11-20 订正。** 语料**确实**踩到了
        这条规则的边角 —— 有 7 个音节（xiù jiù jiǔ qiū qiú xiū jiū）。
        结论碰巧成立，只是因为这些音节的近音候选在两种算法下得分一样，
        挑字结果没变。
        另：计划文件里根本不存在编号规则表 —— 全仓库 grep 过 `iou`，零命中。
        当初「计划第 6 条」这个说法是记错了来源。
        代价：无。

Ruling: 一字对一字的对句在超难档只能挖 2 个空（语料里 283/761 = 37% 是
        一字对一字）。
        这是语料本身的限制 —— 一副对句只有 2 个位置，挖不了 3 个。
        规则正确地裁到 2（chooseBlanks 的 Math.min），界面也如实显示
        「还剩 2 个空」，不会骗玩家。
        开始页那句「超难 · 挖 3 个空」是档位说明，不是每局的保证。
        代价：超难档在约三分之一的局里比标称少挖一个 —— 这是语料决定的，
        不是 bug；要改只能换语料或换玩法。

Final: fixed 真机走查抓出的三个坑（commit 3e2d84bd3）——
      单元测试一个都没抓到，全靠 CDP 驱动本机 Chrome 跑真机。

      1. 字盘上出现重复的字（实测 400 局里 290 局，72.5%）。
         挑干扰字时按字挑，而同一个字在语料里常常出现在好几副对句里，
         不去重就撞车。修法：按字去重。
      2. 干扰字是另一个空的答案（实测 800 局里 5 局）。
         挖两个空时第二个空的答案字会作为干扰字上盘，玩家看得见两个
         一样的字却只填得出一个格。修法：干扰字避开所有答案字。
      3. 点字再点空格没反应 —— 游戏在真机上根本玩不了。
         空格按钮的 onClick 读的是渲染闭包里的 state.selectedTileId；
         浏览器里这两次点击在同一个任务里，React 合并渲染，
         空格拿到的还是点字之前的闭包。修法：选中的字同时记在 ref 里。

      变异验证：3 条用例全部会红。
      教训一（已写成用例）：
        去重那条的头一版用例太弱 —— 候选池不够大，凑不出重复的字，
        是真机走查先发现的。用例要能红，得先证明它能红。
      教训二（已写成用例）：
        fireEvent.click 每一次都自带一次 act()（每次都刷一遍渲染），
        所以用 fireEvent 写的用例永远抓不到 batching 类的坑。
        要抓必须在同一个 act() 里连点两次。
        仓库记忆里那条「真机验证 vs 注入测试」又中了一次。

      回归：全量 2745 通过、tsc 干净、build 通过、
      真机走查：字盘三字互不相同、拼对、通关面板出现、零 console error。

Task 5: complete (commits 5e092a268..3e2d84bd3, tests: npx vitest run → 2745 passed | 21 skipped)

Final: fixed 计划第 6 条规则和它带出来的三个拼音错（commit 72c933d69）——
      评审 agent 报了三条，我自己先在语料上核实过才动手。

      先说一条**台账写错了的事实**：台账里记着「语料里的 ü 写成 l + U+01DC
      （组合分音符挂在声母 l 上）」。这句话是错的，两处都错：
        (a) U+01DC 是预组合字母 ǜ，不是组合记号（组合分音符是 U+0308，
            「below」是 U+0324）；
        (b) 语料里一个组合记号都没有 —— 我把 621 个不同的音节逐个拆了
            codepoint，combining mark 的数量是 0。ü 全是预组合的，
            而且**声调不同字母就不同**：lǜ 006C 01DC、lǚ 006C 01DA、
            lǘ 006C 01D8、nǚ 006E 01DA。
      规则里那条正则 `([jqxnl])ǜ` 只认了其中一种，其余的 ü 悄悄变成了 u。

      1. l/n 后的 ü 只认了 ǜ 一种声调。
         「履」lǚ、「闾」lǘ、「女」nǚ 的韵母都算成了 u —— 跟「鲁」「卢」
         混成一类。而绿(lǜ) 的干扰字因此挑成了 来/律/辣：其中「来」还
         是个重复字（那正是上一轮修的重复 bug 的另一个入口）。
         修法：ü 的四种带调形式全认。
      2. y 声母吃掉了韵母的 i。
         严 yán → "an"（该是 ian）、摇 yáo → "ao"（该是 iao）、
         夜 yè → "e"（该是 ie）、云 yún → "vn"（压根不是个韵母）。
         y 是韵母头不是声母，y 后的 i 属于韵母。
      3. 零声母音节把第一个字母当成了声母。
         爱 ài → "i"、昂 áng → "ng"、鹅 é → 空（整个音节都是韵母）。
      4. 「换难度」把 seed 一起重置了。
         READY.seed 是 0，所以下一局 seed 又变回 1 —— 跟第一局抽到同一副
         对联、同样挖空的位置、同样的一盘字。玩家拼完第一局、换个难度，
         看到的还是刚才那副。同时它把「已拼好 N 副」也清零了。

      修法上的一个决定：规则改成**一次拆出声母和韵母**，而不是继续拿
      正则一路替换。之前那条正则链（`/^([jqx])u/` + `/^yu/`）之所以吃掉
      y 的 i，就是因为它是在已经切好的字符串上做的替换。
      拆完以后，全语料 621 个不同音节的韵母**全部是真正的拼音韵母**，
      0 个不是。

      变异验证：4 条（零声母规则、y 的 i、ü 的四种声调、换难度保留
      seed/成绩）全部会红，且各自只红对应的用例。

      回归：全量 2754 通过、21 跳过、tsc 干净、build 通过。
      真机走查（CDP）：11 条全过 —— 对韵标签页能开、字盘无重复字、
      干扰字不泄答案、每个字都带平/仄标记、上下句逐位相对、
      点字再点空格能填上、用掉的字从字盘消失、换难度换了新对联。

      一条**台账要改的事实**：台账里「计划第 6 条规则……761 对里没有一对
      会被这条规则改变判定」这句结论虽然碰巧成立，但推理是错的 ——
      语料里有 7 个音节（xiù jiù jiǔ qiū qiú xiū jiū）真的会被这条规则
      碰到，只是它们的近音候选两种算法得分一样，所以挑字结果没变。
      另：计划文件里根本不存在编号规则表 —— 全仓库 grep 过 `iou`，零命中。

Final: Ruling: 评审的 4 条 Minor 全部按效果重新评过，2 条修、2 条不修 ——
      评审的标签是建议，闸门是我的。

      **修了（进 fix pass）**：
        评审 finding 2（l/n 后的 ü 只认一种声调）和 finding 3（y 声母
        吃掉韵母的 i）：这两条都是「干扰字挑不准」这一类 —— 一个合理
        的玩家拿到字盘，看到的是「律」「辣」这种跟答案音不近的字，
        于是只能瞎猜而不是分辨。评审给了 Minor（因为 spec 没提），
        但按效果算是玩家会碰到的，所以修。
        评审 finding 1（换难度重置 seed）：玩家拼完一局、换个难度、
        看到同一副对联 —— 游戏像是没听见他。修。

      **不修（记 minor deferred）**：
        评审 finding 4（buildRound 每局 5.9 ms 主线程阻塞）：
        我自己量了 —— 规则重写之后是 5.879 ms/局（200 局平均，超难档），
        比评审量的 12.6 ms 少一半（旧的 initialOf/finalOf 把每个音节
        都算了两遍）。5.9 ms 是一次阻塞任务，在中端手机上大约掉一帧，
        是「点下去的时候有一点点顿」，不是玩不下去。
        要再快就得给 (字 → 声母/韵母) 建一张预计算索引，那是另一件事。
        代价：玩家点「再来一副」时可能感觉到极轻微的一顿。

      评审「Declined to judge」里我逐条接了：
        - 语料整体发给浏览器（81 KB）：对 —— 干扰字就是从语料里挑的，
          挑近音字需要全部 1194 个不同的字。不改。
        - 干扰字的选择是确定的（不随 seed 变）：对 —— 语料的答案字本来
          就是近音字，「固定但公平」是设计选择，不是 bug。
        - 语料里有 4 副对句在同一侧重复同一个字（荡荡/巍巍 等）：
          对 —— 每一个空都配自己那块答案字，这一局照样能拼完。
        - `readJsonAuto` 每次请求重读重解析（1.52 ms/请求）：不改 ——
          这个流量下不值得为它加一层缓存，仓库自己的记忆也提醒过
          负缓存要小心。
        - buildRound 抛错发生在 setState 的 updater 里，StrictMode 下
          会对 updater 调两次，错误会打两遍日志：记下，但不改 ——
          只多一行日志，行为完全一样；把 throw 挪出 updater 是另一次改动。

      一条**改过的台账事实**（见上）：评审指出台账关于 U+01DC 的记述是
      假的，我已经订正，并且把规则改对了。
