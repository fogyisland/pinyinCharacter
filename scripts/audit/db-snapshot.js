// DB snapshot for code review — captures current state vs what scripts produce
const mysql = require('mysql2/promise');

const CONFIG = {
  host: '127.0.0.1',
  user: 'root',
  password: 'Admin909217',
  database: 'piyin_deploy_test',
  charset: 'utf8mb4',
};

async function main() {
  const conn = await mysql.createConnection(CONFIG);

  const out = {};

  // 1. Tables
  const [tables] = await conn.query("SHOW TABLES");
  out.tables = tables.map(r => Object.values(r)[0]);

  // 2. Row counts for all content tables
  const counts = {};
  for (const t of ['chars', 'char_etymology', 'rare_chars', 'poems', 'classics',
                   'sutras', 'users', 'app_config', 'membership_plans',
                   'membership_plan_features', 'memberships', 'payment_orders',
                   'worksheets', 'downloads', 'email_send_history',
                   'audit_log', 'scheduler_run_history', 'ai_calls',
                   'sutra_copy_progress', 'password_resets', 'history',
                   'activate']) {
    try {
      const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      counts[t] = Number(r.n);
    } catch (e) {
      counts[t] = `ERR: ${e.code}`;
    }
  }
  out.counts = counts;

  // 3. chars: level distribution + radical coverage
  const [levelDist] = await conn.query(`SELECT level, COUNT(*) AS n FROM chars GROUP BY level ORDER BY level`);
  out.charLevels = levelDist;

  const [[radStats]] = await conn.query(`
    SELECT
      COUNT(*) AS total,
      SUM(radical IS NULL OR radical = '') AS no_radical,
      COUNT(DISTINCT radical) AS unique_radicals
    FROM chars
  `);
  out.charRadicals = radStats;

  // 4. poems: dynasty + form distribution
  const [dynasty] = await conn.query(`SELECT dynasty, COUNT(*) AS n FROM poems GROUP BY dynasty ORDER BY dynasty`);
  out.poemDynasty = dynasty;
  const [formDist] = await conn.query(`SELECT form, COUNT(*) AS n FROM poems WHERE form IS NOT NULL GROUP BY form ORDER BY n DESC LIMIT 20`);
  out.poemForms = formDist;
  const [[nullForm]] = await conn.query(`SELECT COUNT(*) AS n FROM poems WHERE form IS NULL`);
  out.poemsNullForm = nullForm.n;
  const [[noContent]] = await conn.query(`SELECT COUNT(*) AS n FROM poems WHERE content IS NULL OR LENGTH(content) < 10`);
  out.poemsNoContent = noContent.n;

  // 5. classics: category distribution + check if chunks col exists
  const [classicSchema] = await conn.query(`
    SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'classics'
    ORDER BY ORDINAL_POSITION`);
  out.classicsSchema = classicSchema.map(r => r.COLUMN_NAME);
  const [[classicCount]] = await conn.query(`SELECT COUNT(*) AS n FROM classics`);
  out.classicsTotal = classicCount.n;
  const [catDist] = await conn.query(`SELECT category, COUNT(*) AS n FROM classics GROUP BY category ORDER BY n DESC`);
  out.classicsCategories = catDist;

  // 6. sutras: list
  const [sutraList] = await conn.query(`SELECT id, slug, title, source, LENGTH(chunks) AS bytes FROM sutras ORDER BY id`);
  out.sutras = sutraList;

  // 7. app_config
  const [cfg] = await conn.query(`SELECT \`key\`, SUBSTRING(value, 1, 80) AS val FROM app_config ORDER BY \`key\``);
  out.appConfig = cfg;

  // 8. membership plans
  const [plans] = await conn.query(`SELECT id, plan_key, display_name, amount, currency, enabled, display_order FROM membership_plans ORDER BY display_order`);
  out.membershipPlans = plans;
  const [features] = await conn.query(`SELECT plan_id, feature_key FROM membership_plan_features ORDER BY plan_id, feature_key`);
  out.membershipFeatures = features;

  // 9. activate singleton
  const [activate] = await conn.query(`SELECT id, short_name, is_activated, is_expired, \`lock\` FROM activate`);
  out.activate = activate;

  // 10. rare_chars
  const [[rcStats]] = await conn.query(`
    SELECT COUNT(*) AS total,
           SUM(pinyin IS NULL OR pinyin = '') AS no_pinyin,
           SUM(needs_review) AS needs_review
    FROM rare_chars`);
  out.rareChars = rcStats;

  // 11. poems columns (check schema after migration)
  const [poemSchema] = await conn.query(`
    SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'poems'
    ORDER BY ORDINAL_POSITION`);
  out.poemsSchema = poemSchema;

  // 12. worksheets schema (check ENUM drift)
  const [wsSchema] = await conn.query(`
    SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'worksheets'
    ORDER BY ORDINAL_POSITION`);
  out.worksheetsSchema = wsSchema;

  console.log(JSON.stringify(out, null, 2));
  await conn.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });