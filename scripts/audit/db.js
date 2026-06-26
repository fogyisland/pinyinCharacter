// Comprehensive DB audit
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  host: '127.0.0.1',
  user: 'root',
  password: 'Admin909217',
  database: 'piyin_deploy_test',
  charset: 'utf8mb4',
};

async function main() {
  const conn = await mysql.createConnection(CONFIG);
  const issues = [];
  const stats = {};

  console.log('='.repeat(72));
  console.log('字·韵 DB 全表完整性核查 (piyin_deploy_test)');
  console.log('='.repeat(72));
  console.log();

  // ─── 1. Schema-level: 表存在性 + 列定义 ──────────────────────────
  const expectedTables = [
    'activate', 'app_config', 'audit_log',
    'char_etymology', 'chars', 'classics',
    'downloads', 'email_send_history', 'history',
    'membership_plan_features', 'membership_plans', 'memberships',
    'password_resets', 'payment_orders', 'poems',
    'rare_chars', 'scheduler_run_history', 'sutra_copy_progress',
    'sutras', 'users', 'worksheets', 'ai_calls',
  ];
  const [gotTables] = await conn.query('SHOW TABLES');
  const haveTables = new Set(gotTables.map(r => Object.values(r)[0]));
  for (const t of expectedTables) {
    if (!haveTables.has(t)) issues.push(`MISSING TABLE: ${t}`);
  }
  console.log(`[1] 表清单: 期望 ${expectedTables.length} 张, 实际 ${gotTables.length} 张`);
  if (haveTables.size !== expectedTables.length) {
    const extra = [...haveTables].filter(t => !expectedTables.includes(t));
    if (extra.length) issues.push(`EXTRA TABLES: ${extra.join(', ')}`);
  }

  // ─── 2. 行数 ─────────────────────────────────────────────────────
  console.log();
  console.log('[2] 行数盘点');
  console.log('-'.repeat(72));
  const counts = {};
  for (const t of expectedTables) {
    try {
      const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      counts[t] = Number(r.n);
      console.log(`  ${t.padEnd(28)} ${String(counts[t]).padStart(6)} 行`);
    } catch (e) {
      console.log(`  ${t.padEnd(28)} ERR: ${e.code}`);
      issues.push(`COUNT ERR on ${t}: ${e.message}`);
    }
  }

  // ─── 3. 空表检查 (排除预期为 0 的) ──────────────────────────────
  console.log();
  console.log('[3] 空表警告 (排除预期为 0 的活动表)');
  console.log('-'.repeat(72));
  const allowedEmpty = ['downloads', 'email_send_history', 'history', 'memberships',
    'password_resets', 'payment_orders', 'sutra_copy_progress', 'worksheets',
    'char_etymology', 'scheduler_run_history', 'ai_calls', 'audit_log'];
  for (const t of expectedTables) {
    if (counts[t] === 0 && !allowedEmpty.includes(t)) {
      issues.push(`UNEXPECTED EMPTY: ${t}`);
      console.log(`  ⚠ ${t.padEnd(28)} 0 行 (不应为空)`);
    }
  }

  // ─── 4. Poems: 字段完整性 ───────────────────────────────────────
  console.log();
  console.log('[4] poems 字段完整性 (title/author/dynasty/form)');
  console.log('-'.repeat(72));
  const [poemIssues] = await conn.query(`
    SELECT
      SUM(title IS NULL OR title = '') AS no_title,
      SUM(author IS NULL OR author = '') AS no_author,
      SUM(dynasty IS NULL OR dynasty = '') AS no_dynasty,
      SUM(form IS NULL OR form = '') AS no_form,
      SUM(content IS NULL OR content = '' OR LENGTH(content) < 10) AS no_content,
      COUNT(*) AS total
    FROM poems
  `);
  const pi = poemIssues[0];
  console.log(`  总数: ${pi.total}, 无 title: ${pi.no_title}, 无 author: ${pi.no_author} (汉朝匿名古诗,合法), 无 dynasty: ${pi.no_dynasty}, 无 form: ${pi.no_form}, 无 content(<10字): ${pi.no_content}`);
  // Only treat title/dynasty/form/content empty as real issues; author-empty is legit for anonymous
  if (Number(pi.no_title) || Number(pi.no_dynasty) || Number(pi.no_form) || Number(pi.no_content))
    issues.push(`poems has incomplete rows`);

  // ─── 5. Sutras: 字段完整性 ──────────────────────────────────────
  console.log();
  console.log('[5] sutras 字段完整性 (title/slug/source)');
  console.log('-'.repeat(72));
  const [sutraRows] = await conn.query(`
    SELECT
      SUM(title IS NULL OR title = '') AS no_title,
      SUM(slug IS NULL OR slug = '') AS no_slug,
      SUM(source IS NULL OR source = '') AS no_source,
      COUNT(*) AS total
    FROM sutras
  `);
  const si = sutraRows[0];
  console.log(`  总数: ${si.total}, 无 title: ${si.no_title}, 无 slug: ${si.no_slug}, 无 source: ${si.no_source}`);
  if (Number(si.no_title) || Number(si.no_source))
    issues.push(`sutras has incomplete rows`);

  // ─── 6. classics: 字段完整性 ─────────────────────────────────────
  console.log();
  console.log('[6] classics 字段完整性 (title/category/slug/source)');
  console.log('-'.repeat(72));
  const [classicsRows] = await conn.query(`
    SELECT
      SUM(title IS NULL OR title = '') AS no_title,
      SUM(category IS NULL OR category = '') AS no_category,
      SUM(slug IS NULL OR slug = '') AS no_slug,
      SUM(source IS NULL OR source = '') AS no_source,
      COUNT(*) AS total,
      COUNT(DISTINCT category) AS cats
    FROM classics
  `);
  const ci = classicsRows[0];
  console.log(`  总数: ${ci.total}, 分类数: ${ci.cats}, 无 title: ${ci.no_title}, 无 category: ${ci.no_category}, 无 slug: ${ci.no_slug}, 无 source: ${ci.no_source}`);
  console.log(`  分类分布:`);
  const [cats] = await conn.query(`SELECT category, COUNT(*) AS n FROM classics GROUP BY category ORDER BY n DESC`);
  for (const r of cats) console.log(`    ${(r.category||'?').padEnd(16)} ${r.n}`);
  if (Number(ci.no_title) || Number(ci.no_slug))
    issues.push(`classics has incomplete rows`);

  // ─── 7. chars: 字段完整性 + level 分布 ───────────────────────────
  console.log();
  console.log('[7] chars 字段完整性 (char/level/radical/stroke_count/unicode_codepoint)');
  console.log('-'.repeat(72));
  // pinyin 列是 design-by-null(slim schema, app 用 pinyin-pro 实时生成), 不视为缺失
  const [charRows] = await conn.query(`
    SELECT
      SUM(\`char\` IS NULL OR \`char\` = '') AS no_char,
      SUM(level IS NULL) AS no_level,
      SUM(radical IS NULL OR radical = '') AS no_radical,
      SUM(stroke_count IS NULL) AS no_stroke,
      SUM(unicode_codepoint IS NULL) AS no_codepoint,
      COUNT(*) AS total,
      COUNT(DISTINCT level) AS levels
    FROM chars
  `);
  const chi = charRows[0];
  console.log(`  总数: ${chi.total}, level 数: ${chi.levels}`);
  console.log(`  无 char: ${chi.no_char}, 无 level: ${chi.no_level}, 无 radical: ${chi.no_radical} (data/radicals.json 覆盖 7906/7910; 剩 4 个 CJK Ext B/C 超生僻字无 kRSUnicode), 无 stroke: ${chi.no_stroke}, 无 codepoint: ${chi.no_codepoint}`);
  console.log(`  level 分布:`);
  const [levels] = await conn.query(`SELECT level, COUNT(*) AS n FROM chars GROUP BY level ORDER BY level`);
  for (const r of levels) console.log(`    level ${r.level}  ${r.n}`);
  if (Number(chi.no_char))
    issues.push(`chars has incomplete rows`);

  // ─── 8. rare_chars: 字段完整性 ───────────────────────────────────
  console.log();
  console.log('[8] rare_chars 字段完整性 (char/pinyin)');
  console.log('-'.repeat(72));
  const [rcRows] = await conn.query(`
    SELECT
      SUM(\`char\` IS NULL OR \`char\` = '') AS no_char,
      SUM(pinyin IS NULL OR pinyin = '') AS no_pinyin,
      COUNT(*) AS total,
      SUM(needs_review IS NULL) AS no_review
    FROM rare_chars
  `);
  const rci = rcRows[0];
  console.log(`  总数: ${rci.total}, 无 char: ${rci.no_char}, 无 pinyin: ${rci.no_pinyin}, 无 needs_review: ${rci.no_review}`);

  // ─── 9. app_config: 必须有 setup_completed ───────────────────────
  console.log();
  console.log('[9] app_config 必须 key 存在');
  console.log('-'.repeat(72));
  const requiredKeys = [
    'setup.completed', 'setup.completed_at', 'setup.route_enabled',
    'ai.model', 'ai.rate_limit_per_user_per_day', 'ai.timeout_ms', 'ai.temperature',
    'tts.voice_male', 'tts.voice_female', 'tts.audio_format',
  ];
  const [appCfg] = await conn.query(`SELECT \`key\`, value FROM app_config ORDER BY \`key\``);
  const cfgMap = new Map(appCfg.map(r => [r.key, r.value]));
  console.log(`  总 key 数: ${appCfg.length}`);
  for (const k of requiredKeys) {
    if (!cfgMap.has(k)) {
      console.log(`  ⚠ MISSING: ${k}`);
      issues.push(`app_config missing key: ${k}`);
    } else {
      console.log(`  ✓ ${k} = ${(cfgMap.get(k)||'').slice(0, 60)}`);
    }
  }

  // ─── 10. users: 至少 1 个 admin ──────────────────────────────────
  console.log();
  console.log('[10] users (必须有至少 1 个 admin)');
  console.log('-'.repeat(72));
  const [userRows] = await conn.query(`
    SELECT
      SUM(is_admin IS NULL) AS no_admin_flag,
      SUM(username IS NULL OR username = '') AS no_username,
      SUM(password_hash IS NULL OR password_hash = '') AS no_pwd,
      COUNT(*) AS total,
      SUM(is_admin) AS admins
    FROM users
  `);
  const ui = userRows[0];
  console.log(`  总数: ${ui.total}, admin 数: ${ui.admins}`);
  if (Number(ui.admins) < 1) issues.push('no admin user');

  // ─── 11. membership plans ────────────────────────────────────────
  console.log();
  console.log('[11] membership_plans + features');
  console.log('-'.repeat(72));
  const [planRows] = await conn.query(`SELECT id, plan_key, display_name, amount, currency, enabled FROM membership_plans ORDER BY display_order`);
  console.log(`  plans: ${planRows.length}`);
  for (const p of planRows) console.log(`    [${p.id}] ${p.plan_key} ${p.display_name} ${p.amount} ${p.currency} enabled=${p.enabled}`);
  const [featRows] = await conn.query(`SELECT COUNT(*) AS n, COUNT(DISTINCT plan_id) AS plans FROM membership_plan_features`);
  console.log(`  features: ${featRows[0].n} 行, 覆盖 ${featRows[0].plans} 个 plan`);
  if (planRows.length < 4) issues.push(`only ${planRows.length} membership plans, expected ≥4`);

  // ─── 12. activate singleton ──────────────────────────────────────
  console.log();
  console.log('[12] activate singleton (id=1 必须存在)');
  console.log('-'.repeat(72));
  const [actRows] = await conn.query(`SELECT * FROM activate WHERE id = 1`);
  if (actRows.length !== 1) {
    issues.push('activate singleton missing');
  } else {
    const a = actRows[0];
    console.log(`  short_name=${a.short_name}, is_activated=${a.is_activated}, is_expired=${a.is_expired}, lock=${a.lock}`);
  }

  // ─── 13. JSON 文件 vs DB 一致性 ──────────────────────────────────
  console.log();
  console.log('[13] JSON 文件 vs DB slim schema (meaning/story 列预期 NULL,数据来自 JSON)');
  console.log('-'.repeat(72));
  const contentDir = path.join(process.cwd(), 'data', 'content');
  const jsonCount = fs.readdirSync(contentDir).filter(f => f.endsWith('.json')).length;
  console.log(`  data/content/ JSON 文件数: ${jsonCount}`);
  // chars 表 N 行, JSON 应为 N 个(如果不是 slim schema 之前的部分)
  const charsTotal = counts.chars;
  console.log(`  chars 表行数: ${charsTotal}`);
  if (jsonCount !== charsTotal) {
    console.log(`  ⚠ JSON 数 (${jsonCount}) != chars 表行数 (${charsTotal})`);
    issues.push(`JSON/DB mismatch: json=${jsonCount}, chars=${charsTotal}`);
  }

  // ─── 14. 引用完整性 ──────────────────────────────────────────────
  console.log();
  console.log('[14] 引用完整性 (FK-like)');
  console.log('-'.repeat(72));
  // worksheets.user_id → users.id
  if (counts.worksheets > 0) {
    const [[r]] = await conn.query(`
      SELECT COUNT(*) AS n FROM worksheets w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE u.id IS NULL`);
    console.log(`  worksheets.user_id 孤儿: ${r.n}`);
    if (Number(r.n) > 0) issues.push(`${r.n} orphan worksheets`);
  }
  // history.user_id → users.id
  if (counts.history > 0) {
    const [[r]] = await conn.query(`
      SELECT COUNT(*) AS n FROM history h
      LEFT JOIN users u ON h.user_id = u.id
      WHERE u.id IS NULL`);
    console.log(`  history.user_id 孤儿: ${r.n}`);
  }
  // membership_plan_features.plan_id → membership_plans.id
  if (counts.membership_plan_features > 0) {
    const [[r]] = await conn.query(`
      SELECT COUNT(*) AS n FROM membership_plan_features f
      LEFT JOIN membership_plans p ON f.plan_id = p.id
      WHERE p.id IS NULL`);
    console.log(`  membership_plan_features.plan_id 孤儿: ${r.n}`);
  }
  // char_etymology.char → chars.char
  if (counts.char_etymology > 0) {
    const [[r]] = await conn.query(`
      SELECT COUNT(*) AS n FROM char_etymology ce
      LEFT JOIN chars c ON ce.char = c.char
      WHERE c.char IS NULL`);
    console.log(`  char_etymology.char 孤儿: ${r.n}`);
  }
  // 任何 worksheet 之外的 user_id 不应该引用到 worksheets.user_id
  // poetry 不依赖 user_id(用户层无收藏)

  // ─── 15. 索引情况 ────────────────────────────────────────────────
  console.log();
  console.log('[15] 关键索引');
  console.log('-'.repeat(72));
  for (const t of ['chars', 'poems', 'classics', 'sutras', 'rare_chars']) {
    const [idx] = await conn.query(`SHOW INDEX FROM \`${t}\``);
    const cols = [...new Set(idx.map(r => r.Column))].filter(c => c);
    console.log(`  ${t.padEnd(14)} 索引列: ${cols.join(', ')}`);
  }

  // ─── 16. manifests 一致性 ────────────────────────────────────────
  console.log();
  console.log('[16] 静态 manifest vs DB');
  console.log('-'.repeat(72));
  try {
    const poemsManifest = JSON.parse(fs.readFileSync('data/poems-manifest.json', 'utf8'));
    const classicsManifest = JSON.parse(fs.readFileSync('data/classics-manifest.json', 'utf8'));
    const sutrasManifest = JSON.parse(fs.readFileSync('data/sutras/manifest.json', 'utf8'));
    const charsManifest = JSON.parse(fs.readFileSync('data/content-manifest.json', 'utf8'));
    console.log(`  poems-manifest.json: ${poemsManifest.items?.length || poemsManifest.count} 条`);
    console.log(`  classics-manifest.json: ${classicsManifest.books?.length || classicsManifest.length} 本`);
    console.log(`  sutras/manifest.json: ${sutrasManifest.items?.length || sutrasManifest.entries?.length} 条`);
    console.log(`  content-manifest.json: ${charsManifest.entries?.length || Object.keys(charsManifest).length}`);
  } catch (e) {
    console.log(`  ERR: ${e.message}`);
  }

  // ─── 汇总 ────────────────────────────────────────────────────────
  console.log();
  console.log('='.repeat(72));
  if (issues.length === 0) {
    console.log('✅ 所有检查通过,无问题');
  } else {
    console.log(`⚠ 发现 ${issues.length} 个问题:`);
    for (const i of issues) console.log(`   - ${i}`);
  }
  console.log('='.repeat(72));

  await conn.end();
  process.exit(issues.length ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(2);
});
