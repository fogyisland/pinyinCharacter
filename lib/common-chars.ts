/**
 * First-grade common Chinese chars used as the chain game starter pool.
 * Order is meaningful — earlier chars are more common; pickStarter uses
 * random selection from this list (no need to preserve order at runtime).
 *
 * Source: 教育部《现代汉语常用字表》常用字前 80 位 + 拼音接龙常用字。
 * No DB dependency. Curated manually; if user reports chain too hard or
 * too easy, swap chars here.
 */
export const COMMON_CHARS: readonly string[] = [
  '的', '一', '是', '不', '了', '在', '人', '有', '我', '他',
  '这', '中', '大', '来', '上', '国', '个', '到', '说', '们',
  '为', '子', '和', '你', '地', '出', '道', '也', '时', '年',
  '得', '就', '那', '要', '下', '以', '生', '会', '自', '着',
  '去', '之', '过', '家', '学', '对', '可', '她', '里', '后',
  '小', '么', '心', '多', '天', '而', '能', '好', '都', '然',
  '没', '日', '于', '起', '还', '发', '成', '事', '只', '作',
  '当', '想', '看', '文', '无', '开', '手', '十', '用', '主',
];