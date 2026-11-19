/**
 * 汉字加减法（变字魔术）的规则 —— 纯函数，无 DOM、无 React、无 IO。
 *
 * 判定用「减法」而不是「逐笔配对」：加一笔会让别的笔画重新排布，
 * 所以被改动的那一笔跟对方往往离得很远，逐笔配对必然失败。真正
 * 共享的是「除那一笔以外的部分」——所以两边都去掉那一笔再比。
 *
 * 举例：「太」和「犬」一笔之差，但「太」的点跑到「犬」的右上角，
 * 两个点相距甚远，逐笔配对必然失败；而「太」去掉点之后和「犬」
 * 去掉点之后完全一样 —— 这才是对的问法。
 *
 * 共享的部分要用两个尺度同时衡量：
 *
 *   位置（position）—— 共享的笔画还站在原来的地方吗？
 *       「大」变「太」：三笔原封不动，位置分很低。
 *
 *   形状（shape）—— 扣掉整体平移之后，共享的笔画形状还一样吗？
 *       「一」变「二」：唯一那横从字框正中挪到了下面，这是整体平移，
 *       形状分几乎为零（3），位置分却很高（171）。两个尺度一起看，
 *       这一对才被认出来。
 *
 * 只有位置、而没有形状，就分不出「一→二」；只有形状、而没有位置，
 * 就分不出「本→末」（那根短横在「本」里标根、在「末」里标梢，
 * 位置变了，它认的就不再是同一个位置上的那一笔）。
 *
 * 共享的部分必须逐笔同类型：横只配横、撇只配撇。类型不同却配上，
 * 是「凑数」而不是「共享」——「木」的撇和「水」的钩长得像，配上
 * 之后「木」和「水」就成了一笔之差，可它们明明是两笔换了一笔。
 */

/** 一笔的中线采样点。 */
export type Stroke = number[][];

/** 两个字之间的变换关系。 */
export type MagicRelation = 'add' | 'remove' | 'modify';

/** 采样点数：笔画被切成多少段来比较。 */
const SAMPLE_COUNT = 8;

/**
 * 「点」的绝对长度上限（1024 坐标系）。
 *
 * 全表里最短的那些笔画都在 60 以下，所以 90 是一个稳的下限。
 */
const DOT_LENGTH = 90;

/**
 * 「点」相对整个字的长度上限。
 *
 * 「太」右下角那一点有 101 长，是全表里最大的点之一 —— 拿绝对门槛
 * 去卡会把它当成捺，笔画类型一错，配对的容差就跟着错。
 */
const DOT_RATIO = 0.16;

/**
 * 「横」的角度上限（度）：比这更斜就不是横了。
 *
 * 「干」底下那根短横斜了 6.2 度，「大」的第一笔斜了 5.6 度 ——
 * 汉字的横都有一点点斜，这是正常的。
 */
const HORIZONTAL_ANGLE = 12;

/**
 * 「竖」的角度下限（度）：比这更斜就是撇或捺了。
 */
const VERTICAL_ANGLE = 72;

/**
 * 「钩」的判定阈值：末两段夹角的余弦。越小折得越急。
 */
const HOOK_DOT = 0.55;

/**
 * 「钩」的最小末段长度（相对笔画全长）：太短的末段不算钩。
 */
const HOOK_MIN_SEGMENT = 0.08;

/**
 * 字的大小与容差的换算：容差 = 字的大小 × 这个系数。
 */
const SIZE_RATIO = 0.16;

/**
 * 位置分的上限（相对容差）：共享的笔画还能站在多远的地方。
 */
const POSITION_RATIO = 1.4;

/**
 * 形状分的上限（相对容差）：扣掉整体平移之后，形状还能差多少。
 */
const SHAPE_RATIO = 1.2;

/**
 * 改动的那一笔换了形状时，最多能移动多远（相对容差）。
 *
 * 「干」变「千」：上面那根横变成一撇，起点几乎没动，只是拐了个弯。
 * 这种改动是「就地改形」，走不远。
 */
const MOVE_CHAR_RATIO = 1;

/**
 * 改动的那一笔没换形状时，最多能移动多远（相对整个字）。
 *
 * 「太」变「犬」：那一点从字裆挪到右上角，走掉了大半个字 —— 但它
 * 还是那一点，形状一模一样，所以只要没走出这个字就算数。
 */
const MOVE_SAME_TYPE_RATIO = 0.9;

/** 两笔之间允许配对的最远距离（相对容差）。 */
const PAIR_LIMIT = 2.4;

/** 配不上的一笔的代价（相对容差）。 */
const UNMATCHED_COST = 3;

/**
 * 解析一个字的笔画数据。
 *
 * 数据坏了就当这个字没有 —— 返回空数组，不抛异常。一个字的数据
 * 有问题不能让整个游戏挂掉。
 */
export function parseStrokes(raw: { medians: unknown }): Stroke[] {
  const medians = raw?.medians;
  if (!Array.isArray(medians)) return [];
  const strokes: Stroke[] = [];
  for (const median of medians) {
    if (!Array.isArray(median) || median.length === 0) return [];
    const points: number[][] = [];
    for (const point of median) {
      if (
        !Array.isArray(point) ||
        point.length < 2 ||
        typeof point[0] !== 'number' ||
        typeof point[1] !== 'number' ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1])
      ) {
        return [];
      }
      points.push([point[0], point[1]]);
    }
    strokes.push(points);
  }
  return strokes;
}

/**
 * 判断一笔是什么笔画。
 *
 * 纯几何启发式：看笔画的长短、走向和末段的折角。
 *
 * 「点」必须相对它所在的那个字来判断 ——「太」右下角那一点有一百
 * 来个单位长（是全表里最大的点之一），「火」里的点只有三十来个。
 * 拿一个绝对的门槛去卡，要么把大点当成捺，要么把小点当成别的笔画。
 *
 * `referenceSize` 是那个字的大小。传了就多一道相对判断；不传就只
 * 按绝对长度判 —— 合成笔画（没有字可依）只能这么判。
 */
export function strokeType(stroke: Stroke, referenceSize?: number): string {
  if (stroke.length < 2) return '点';

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of stroke) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const size = Math.hypot(x1 - x0, y1 - y0);
  const start = stroke[0];
  const end = stroke[stroke.length - 1];

  // 点：短，而且粗细接近 —— 两条边都不长。
  //
  // 用包围盒的「最长边」判断，不用对角线：「太」右下角那一点的对角线
  // 是 135，比阈值大，但它的两条边只有 101 和 89 —— 它是点。
  const maxDim = Math.max(x1 - x0, y1 - y0);
  if (maxDim < DOT_LENGTH) return '点';
  // 相对整个字也很短的话，也是点。
  if (referenceSize !== undefined && maxDim < referenceSize * DOT_RATIO) {
    return '点';
  }
  // 钩：末段折角很急。
  if (stroke.length >= 3) {
    const p1 = stroke[stroke.length - 2];
    const l1 = Math.hypot(p1[0] - start[0], p1[1] - start[1]) || 1;
    const l2 = Math.hypot(end[0] - p1[0], end[1] - p1[1]) || 1;
    const dot =
      ((p1[0] - start[0]) * (end[0] - p1[0]) +
        (p1[1] - start[1]) * (end[1] - p1[1])) /
      (l1 * l2);
    if (dot < HOOK_DOT && l2 > size * HOOK_MIN_SEGMENT) return '钩';
  }

  // 走向用「角度」判断，而不是用绝对落差。
  //
  // 「干」底下那根短横是横，不是捺：它长 424、往下斜 46 —— 斜了
  // 百分之十一，是横微微有点斜。用绝对落差（斜 25 以上算捺）会把
  // 它误判成捺，笔画类型一错，配对的容差就跟着错。
  //
  // 角度（度）：横约 0~10，撇约 45~60，捺约 30~45，竖约 75~90。
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const angle =
    (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  if (angle <= HORIZONTAL_ANGLE) return '横';

  // 陡峭的一笔，往左走的是撇，往右走的是竖。
  //
  // 单看角度分不出这两者：「自」的第一笔是撇，斜 73.7 度；「白」
  // 的竖斜 76.4 度 —— 撇的角度比竖还陡。分开它们的是方向：竖是直
  // 着往下走（有时还微微往右偏），撇一定往左偏。
  //
  // 全表里 72~90 度这个区间有一万多笔竖，其中往左偏的五千九百多笔
  // 全是撇 —— 「东」「严」「了」「井」的第一笔都落在这个区间里，
  // 按角度判全被误判成竖。笔画类型一错，配对就配不上：「白」和
  // 「自」只差一笔（那撇变成了竖），类型错了这一对就认不出来。
  if (angle >= VERTICAL_ANGLE) return dx < 0 ? '撇' : '竖';
  // 撇往左上走，捺往右下走。方向按 dx 的正负分。
  if (dx < 0) return '撇';
  return '捺';
}

/**
 * 一个字的大小：所有笔画包围盒的 max(宽, 高)。
 *
 * 容差必须相对这个值：加一笔会让别的笔画重新排布，绝对像素不靠谱。
 */
export function charSize(strokes: Stroke[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return 1;
  return Math.max(x1 - x0, y1 - y0) || 1;
}

/**
 * 一个字里每一笔的笔画类型。
 *
 * 类型是相对那个字来判的 —— 所以要一次算一整个字，不能一笔一笔
 * 单独问。
 */
export function strokeTypes(strokes: Stroke[]): string[] {
  const size = charSize(strokes);
  return strokes.map((stroke) => strokeType(stroke, size));
}

/**
 * 按弧长均匀采样一笔。
 *
 * 均匀采样而不是等分下标：笔画中间是弯的，等分下标会把直的部分
 * 采得比弯的部分密。
 */
function sample(stroke: Stroke, count = SAMPLE_COUNT): number[][] {
  if (stroke.length === 0) return [];
  if (stroke.length === 1) return [[stroke[0][0], stroke[0][1]]];

  const segments: number[] = [];
  let total = 0;
  for (let i = 1; i < stroke.length; i++) {
    const length = Math.hypot(
      stroke[i][0] - stroke[i - 1][0],
      stroke[i][1] - stroke[i - 1][1],
    );
    segments.push(length);
    total += length;
  }
  if (total === 0) return [[stroke[0][0], stroke[0][1]]];

  const points: number[][] = [];
  let segment = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (segment < segments.length - 1 && acc + segments[segment] < target) {
      acc += segments[segment];
      segment += 1;
    }
    const t = segments[segment] === 0 ? 0 : (target - acc) / segments[segment];
    points.push([
      stroke[segment][0] + (stroke[segment + 1][0] - stroke[segment][0]) * t,
      stroke[segment][1] + (stroke[segment + 1][1] - stroke[segment][1]) * t,
    ]);
  }
  return points;
}

/**
 * 两组采样点的平均距离。 */
function meanDistance(a: number[][], b: number[][]): number {
  const count = Math.min(a.length, b.length);
  if (count === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
  }
  return sum / count;
}

/**
 * 两笔之间最近的那一点有多近。
 *
 * 「干」变「千」：上面那根横变成一撇，横的右端就是撇的起点 —— 两笔
 * 是在一个点上接上的，所以「最近距离」很小，哪怕两笔的平均距离不小。
 * 用平均距离会把这种「就地改形」误判成「换了一笔」。
 */
function closestApproach(a: Stroke, b: Stroke): number {
  const sampledA = sample(a);
  const sampledB = sample(b);
  let best = Infinity;
  for (const point of sampledA) {
    for (const other of sampledB) {
      const distance = Math.hypot(
        point[0] - other[0],
        point[1] - other[1],
      );
      if (distance < best) best = distance;
    }
  }
  return best;
}

/**
 * 两组笔画配对得好不好。
 *
 * 分数是（配对数，越多越好；总距离，越小越好）。DFS 穷举所有配对，
 * 先比配对数，再比距离。
 *
 * 只有同类型的笔画才允许配对 —— 共享的部分必须还是那几笔，不是
 * 「长得像的那几笔」。
 */
function matchScore(
  a: Stroke[],
  b: Stroke[],
  limit: number,
  referenceSize: number,
): { pairs: number; cost: number; assign: number[] } {
  if (a.length === 0 || b.length === 0) return { pairs: 0, cost: 0, assign: [] };

  const typeA = a.map((stroke) => strokeType(stroke, referenceSize));
  const typeB = b.map((stroke) => strokeType(stroke, referenceSize));
  const sampledA = a.map((stroke) => sample(stroke));
  const sampledB = b.map((stroke) => sample(stroke));

  const distance: number[][] = a.map((_, i) =>
    b.map((__, j) => {
      // 类型不同就不配。
      if (typeA[i] !== typeB[j]) return Infinity;
      return meanDistance(sampledA[i], sampledB[j]);
    }),
  );

  let bestPairs = 0;
  let bestCost = Infinity;
  let bestAssign: number[] = [];

  const search = (
    i: number,
    usedB: boolean[],
    pairs: number,
    cost: number,
    assign: number[],
  ): void => {
    if (i === a.length) {
      if (pairs > bestPairs || (pairs === bestPairs && cost < bestCost)) {
        bestPairs = pairs;
        bestCost = cost;
        bestAssign = [...assign];
      }
      return;
    }
    // 剩下的笔画就算全配上，也追不上已找到的配对数。
    if (pairs + (a.length - i) < bestPairs) return;
    for (let j = 0; j < b.length; j++) {
      if (usedB[j]) continue;
      if (distance[i][j] > limit * PAIR_LIMIT) continue;
      usedB[j] = true;
      assign.push(j);
      search(i + 1, usedB, pairs + 1, cost + distance[i][j], assign);
      assign.pop();
      usedB[j] = false;
    }
    // 这一笔画配不上，付一笔代价。
    search(i + 1, usedB, pairs, cost + limit * UNMATCHED_COST, assign);
  };

  search(0, new Array(b.length).fill(false), 0, 0, []);
  return { pairs: bestPairs, cost: bestCost, assign: bestAssign };
}

/** 一组点的重心。 */
function centroid(points: number[][]): number[] {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  const count = points.length;
  return count === 0 ? [0, 0] : [x / count, y / count];
}

/**
 * 扣掉整体平移之后，共享的两组笔画差多远。
 *
 * 各自减去自己的重心再比 —— 这一步消掉的正是「整体挪了个位置」。
 * 「一」变「二」就是靠这一条才被认出来：那根横只是往下挪了，
 * 形状本身没变。
 */
function shapeResidual(
  a: Stroke[],
  b: Stroke[],
  assign: number[],
): number {
  if (a.length === 0 || b.length === 0 || assign.length === 0) return Infinity;

  const sampledA = a.map((stroke) => sample(stroke));
  const sampledB = b.map((stroke) => sample(stroke));

  const flatA: number[][] = [];
  const flatB: number[][] = [];
  assign.forEach((j, i) => {
    flatA.push(...sampledA[i]);
    flatB.push(...sampledB[j]);
  });
  if (flatA.length === 0 || flatB.length === 0) return Infinity;

  const centerA = centroid(flatA);
  const centerB = centroid(flatB);
  return meanDistance(
    flatA.map((point) => [point[0] - centerA[0], point[1] - centerA[1]]),
    flatB.map((point) => [point[0] - centerB[0], point[1] - centerB[1]]),
  );
}

/**
 * 两个字是不是一变笔关系。
 *
 * - 笔画数差 1：B 去掉一笔后跟 A 一样，是「加」；反过来是「减」。
 * - 笔画数一样：各去掉一笔后一样，是「改」——但被去掉的那两笔
 *   必须还是同一笔，否则那是换了一笔而不是改了一笔（「木」和「水」
 *   就是这种情况）。
 */
export function relate(
  a: Stroke[],
  b: Stroke[],
  ratio = SIZE_RATIO,
): MagicRelation | null {
  if (a.length === 0 || b.length === 0) return null;

  const size = charSize([...a, ...b]);
  const limit = size * ratio;
  const diff = b.length - a.length;

  if (diff < -1 || diff > 1) return null;

  let bestQuality = Infinity;
  let bestKind: MagicRelation | null = null;

  const consider = (
    kind: MagicRelation,
    aPart: Stroke[],
    bPart: Stroke[],
  ): void => {
    const { pairs, cost, assign } = matchScore(aPart, bPart, limit, size);
    // 共享的部分必须每一笔都配上。
    if (pairs < Math.min(aPart.length, bPart.length)) return;
    // 位置：共享的笔画还站在原来的地方吗？
    const position = cost / Math.max(1, pairs);
    if (position > limit * POSITION_RATIO) return;
    // 形状：扣掉整体平移之后，形状还一样吗？
    const shape = shapeResidual(aPart, bPart, assign);
    if (shape > limit * SHAPE_RATIO) return;
    if (position < bestQuality) {
      bestQuality = position;
      bestKind = kind;
    }
  };

  if (diff === 1) {
    // B 比 A 多一笔：去掉 B 的任意一笔，应该就等于 A。
    for (let j = 0; j < b.length; j++) {
      consider('add', a, b.filter((_, k) => k !== j));
    }
  } else if (diff === -1) {
    // A 比 B 多一笔：去掉 A 的任意一笔，应该就等于 B。
    for (let i = 0; i < a.length; i++) {
      consider('remove', a.filter((_, k) => k !== i), b);
    }
  } else {
    // 笔画数一样：各去掉一笔，剩下的部分应该一样。
    //
    // 被去掉的那两笔必须还是同一笔 —— 走多远算数，取决于它有没有
    // 换形状：
    //
    //   没换形状（点挪到点、横挪到横）：还是那一笔，只要没走出这个
    //     字就算数。「太」变「犬」那一点走掉了大半个字。
    //   换了形状（横变撇）：那是就地改形 —— 两笔得在同一个点接上，
    //     否则那不是改一笔，是换了一笔。「干」变「千」那根横就是在
    //     原地拐了个弯；而「木」的横变「水」的钩，压根接不上。
    const typeA = strokeTypes(a);
    const typeB = strokeTypes(b);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        const sameType = typeA[i] === typeB[j];
        if (sameType) {
          const moved = meanDistance(sample(a[i]), sample(b[j]));
          if (moved > size * MOVE_SAME_TYPE_RATIO) continue;
        } else {
          const anchor = closestApproach(a[i], b[j]);
          if (anchor > limit * MOVE_CHAR_RATIO) continue;
        }
        consider('modify', a.filter((_, k) => k !== i), b.filter((_, k) => k !== j));
      }
    }
  }

  return bestKind;
}

/** 两个字是不是一变笔关系。 */
export function isOneStrokeApart(
  a: Stroke[],
  b: Stroke[],
  ratio = SIZE_RATIO,
): boolean {
  return relate(a, b, ratio) !== null;
}

/**
 * 一道题：一个基础字 + 四个选项。
 */
export interface MagicQuestion {
  /** 玩家出题的那个字。 */
  base: string;
  /** 正确答案。 */
  answer: string;
  /** 四个选项（正确答案也在里面）。 */
  options: string[];
  /** 从基础字到正确答案的关系。 */
  relation: MagicRelation;
}

/**
 * 一个带种子的随机数发生器（mulberry32）。
 *
 * 出题必须是可复现的：同一颗种子必须出同一道题，否则一个断言
 * 「干扰项是哪些字」的测试什么都断言不了。每一轮把种子传进来，
 * 同一个种子永远出同一道题。
 *
 * 这份实现是照着 `lib/catch-char-rules.ts` 里那一份重写的 —— 那是
 * 另一个游戏的模块，不跨文件引用。
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 用给定的随机数把一个数组洗牌（返回新数组）。 */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** 一道题有几个选项。 */
const OPTION_COUNT = 4;

/**
 * 从关系表里造一道题。
 *
 * 正确答案是基础字一笔之差的字，三个错误选项是**一笔之差以外**的
 * 字 —— 玩家得懂规则，不能靠看形状蒙。
 *
 * `pool` 是这次能出题的字：基础字和干扰项都从这里取。正确答案来自
 * 关系表 —— 它是基础字的邻居，不必在 pool 里（pool 是玩家能看见的
 * 候选范围，答案是其中被选中的那个邻居）。
 *
 * 出不了题就返回 `null`：pool 里没有任何一个有邻居，或者凑不出三个
 * 「不是邻居」的干扰项。
 */
export function buildQuestion(
  table: Record<string, Record<string, MagicRelation>>,
  pool: readonly string[],
  seed: number,
): MagicQuestion | null {
  if (pool.length === 0) return null;

  const rng = makeRng(seed);

  // 基础字：自己在 pool 里，而且至少有一个邻居（邻居在不在 pool 里
  // 不作要求 —— 答案是从表里选的）。
  const bases = pool.filter((char) => {
    const neighbours = table[char];
    if (!neighbours) return false;
    return Object.keys(neighbours).length > 0;
  });
  if (bases.length === 0) return null;

  const base = bases[Math.floor(rng() * bases.length)];
  const neighbours = table[base] ?? {};

  // 正确答案：表里的任意一个邻居。
  const answers = Object.keys(neighbours);
  if (answers.length === 0) return null;
  const answer = answers[Math.floor(rng() * answers.length)];

  // 错误选项：**不是**邻居的字。
  //
  // 先从 pool 里取 —— pool 是玩家这一轮能看见的字。pool 不够的时候，
  // 从表里的其他字补：补进来的必须是这个基础字**没有邻居关系**的字
  // （邻居关系是双向的，基础字的邻居就是答案那一类，补进来会多一个
  // 正确答案）。基础字自己也不能当干扰项。
  const wrongs = pool.filter(
    (char) => char !== base && char !== answer && neighbours[char] === undefined,
  );
  const topUp = Object.keys(table).filter(
    (char) =>
      char !== base &&
      char !== answer &&
      !wrongs.includes(char) &&
      neighbours[char] === undefined &&
      table[char]?.[base] === undefined,
  );
  for (const char of topUp) {
    if (wrongs.length >= OPTION_COUNT - 1) break;
    wrongs.push(char);
  }
  if (wrongs.length < OPTION_COUNT - 1) return null;

  const picked = shuffle(wrongs, rng).slice(0, OPTION_COUNT - 1);
  const options = shuffle([answer, ...picked], rng);

  return { base, answer, options, relation: neighbours[answer] };
}
