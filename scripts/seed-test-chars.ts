/**
 * Smoke-test seed: insert ~40 representative rare chars with pre-filled
 * pinyin + meaning + story so the UI can be exercised end-to-end without
 * the public 通用规范汉字表 source (which is currently 404) or an LLM key.
 */
import { pinyin } from 'pinyin-pro';
import { getPool, closePool } from '../lib/db';

interface SeedChar { char: string; pinyin: string; meaning: string; story: string; }

const SEED: SeedChar[] = [
  { char: '龘', pinyin: 'dá', meaning: '龙腾飞走之貌', story: '繁体的"龍"三个叠加,形容龙在云端腾飞的姿态。' },
  { char: '靐', pinyin: 'bìng', meaning: '雷声', story: '三个"雨"字叠加,表示雷声连绵不断。' },
  { char: '齉', pinyin: 'nàng', meaning: '鼻塞,说话不清', story: '形容感冒时鼻塞导致说话含糊的样子。' },
  { char: '麤', pinyin: 'cū', meaning: '粗俗,鲁莽', story: '"粗"的异体字,三个"鹿"叠加。' },
  { char: '灥', pinyin: 'xún', meaning: '众水汇聚', story: '三个"水"字叠加,形容水流汇聚之处。' },
  { char: '鱻', pinyin: 'xiān', meaning: '鱼鲜,味道鲜美', story: '三个"鱼"字叠加,形容鱼味极其鲜美。' },
  { char: '犇', pinyin: 'bēn', meaning: '奔跑,急驰', story: '"奔"的异体字,三个"牛"叠加,形容牛群奔跑。' },
  { char: '毳', pinyin: 'cuì', meaning: '鸟兽细毛', story: '三个"毛"字叠加,形容细密柔软的绒毛。' },
  { char: '淼', pinyin: 'miǎo', meaning: '水面辽阔', story: '三个"水"字叠加,形容水势浩渺无边。' },
  { char: '焱', pinyin: 'yàn', meaning: '火花,火焰', story: '三个"火"字叠加,形容火焰炽盛的样子。' },
  { char: '垚', pinyin: 'yáo', meaning: '土山高耸', story: '三个"土"字叠加,形容土堆高起的样子。' },
  { char: '晶', pinyin: 'jīng', meaning: '水晶,光亮', story: '三个"日"字叠加,形容光亮透明的样子。' },
  { char: '磊', pinyin: 'lěi', meaning: '石头堆积', story: '三个"石"字叠加,形容光明正大、坦荡的品格。' },
  { char: '森', pinyin: 'sēn', meaning: '树木众多', story: '三个"木"字叠加,形容树木茂密。' },
  { char: '鑫', pinyin: 'xīn', meaning: '财富兴盛', story: '三个"金"字叠加,常用于人名寓意财富。' },
  { char: '众', pinyin: 'zhòng', meaning: '许多人', story: '三个"人"字叠加,表示人数众多。' },
  { char: '鼎', pinyin: 'dǐng', meaning: '古代炊器', story: '三足两耳的古代炊具,象征王权和显赫。' },
  { char: '勋', pinyin: 'xūn', meaning: '功勋,功劳', story: '为国建立功业的人,称为"功臣勋将"。' },
  { char: '瑾', pinyin: 'jǐn', meaning: '美玉', story: '握瑾怀瑜比喻人具有美好的品德。' },
  { char: '瑜', pinyin: 'yú', meaning: '美玉的光彩', story: '怀瑾握瑜,比喻人品德高尚纯洁。' },
  { char: '珏', pinyin: 'jué', meaning: '合璧的玉', story: '两块玉合在一起,比喻夫妻或好友相伴。' },
  { char: '璟', pinyin: 'jǐng', meaning: '玉的光彩', story: '形容玉的光润明亮,常用于人名。' },
  { char: '麒', pinyin: 'qí', meaning: '麒麟', story: '麒麟中的雄性,传说中的祥瑞神兽。' },
  { char: '麟', pinyin: 'lín', meaning: '麒麟', story: '麒麟中的雌性,传说中的祥瑞神兽。' },
  { char: '鸾', pinyin: 'luán', meaning: '传说中神鸟', story: '凤凰一类的神鸟,常用来比喻贤才。' },
  { char: '凤', pinyin: 'fèng', meaning: '传说中的鸟王', story: '百鸟之王,象征美好与重生。' },
  { char: '鸿', pinyin: 'hóng', meaning: '大雁,宏大', story: '鸿鹄之志比喻远大的志向。' },
  { char: '鹤', pinyin: 'hè', meaning: '仙鹤', story: '寓意长寿的吉祥之鸟,常出现在国画中。' },
  { char: '鸑', pinyin: 'yuè', meaning: '凤凰别名', story: '鸑鷟是凤凰的别名,五彩而多文。' },
  { char: '羲', pinyin: 'xī', meaning: '伏羲氏', story: '上古三皇之一,传说他发明了八卦。' },
  { char: '禹', pinyin: 'yǔ', meaning: '大禹', story: '治水英雄,三过家门而不入的典故流传至今。' },
  { char: '尧', pinyin: 'yáo', meaning: '唐尧', story: '上古五帝之一,以禅让闻名。' },
  { char: '舜', pinyin: 'shùn', meaning: '虞舜', story: '上古五帝之一,以孝道著称。' },
  { char: '儒', pinyin: 'rú', meaning: '儒家学者', story: '孔子开创的儒家学派,影响中国两千余年。' },
  { char: '禅', pinyin: 'chán', meaning: '佛教禅宗', story: '主张不立文字、直指人心的修行方式。' },
  { char: '萱', pinyin: 'xuān', meaning: '萱草,忘忧', story: '古人认为萱草可以让人忘忧,故称母亲为"萱堂"。' },
  { char: '芷', pinyin: 'zhǐ', meaning: '白芷,香草', story: '香草名,屈原《离骚》中多有提及。' },
  { char: '兰', pinyin: 'lán', meaning: '兰花', story: '花中君子,象征高洁的品格。' },
  { char: '蕙', pinyin: 'huì', meaning: '蕙兰', story: '兰科植物,一茎多花,香气清雅。' },
  { char: '茗', pinyin: 'míng', meaning: '茶,品茶', story: '品茗即品茶,自古文人雅集必备。' },
];

async function main() {
  const pool = getPool();
  let inserted = 0, updated = 0;
  for (const c of SEED) {
    const py = c.pinyin || pinyin(c.char, { toneType: 'symbol', type: 'array' })[0] || '';
    const [r] = await pool.execute<any>(
      `INSERT INTO rare_chars (\`char\`, pinyin, meaning, story, needs_review, generated_by, generated_at)
       VALUES (?, ?, ?, ?, 0, 'smoke-seed', NOW())
       ON DUPLICATE KEY UPDATE
         pinyin = VALUES(pinyin),
         meaning = VALUES(meaning),
         story = VALUES(story),
         generated_by = VALUES(generated_by),
         generated_at = VALUES(generated_at)`,
      [c.char, py, c.meaning, c.story]
    );
    if (r.affectedRows === 1) inserted++; else updated++;
  }
  console.log(`[seed-test] inserted=${inserted}, updated=${updated}, total=${SEED.length}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
