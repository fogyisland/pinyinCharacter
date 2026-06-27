const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: 'Admin909217',
    database: 'piyin_deploy_test', charset: 'utf8mb4'
  });

  const out = { checks: [], gaps: [] };
  function step(name) { console.error('STEP:', name); }

  // ---------- chars ----------
  const [charsRows] = await conn.query('SELECT COUNT(*) AS n FROM chars');
  const charsRow = charsRows[0];
  const charsArr = JSON.parse(fs.readFileSync('data/general-standard-chinese-characters.json', 'utf8'));
  const bmpSource = charsArr.filter(c => c.length === 1);
  out.checks.push(`chars source: ${charsArr.length} (${bmpSource.length} BMP)`);
  out.checks.push(`chars DB: ${charsRow.n}`);
  if (Number(charsRow.n) !== bmpSource.length + 1) out.gaps.push(`chars count mismatch: DB=${charsRow.n} source BMP=${bmpSource.length}`);

  // ---------- content JSONs ----------
  const contentDir = 'data/content';
  const contentFiles = fs.existsSync(contentDir) ? fs.readdirSync(contentDir).filter(f => f.endsWith('.json')) : [];
  out.checks.push(`content JSON files: ${contentFiles.length}`);

  // Which chars in DB don't have content JSON?
  const [dbChars] = await conn.query('SELECT `char` FROM chars');
  const dbCharSet = new Set(dbChars.map(r => r.char));
  const jsonSet = new Set(contentFiles.map(f => f.replace('.json', '')));
  const dbNotJson = [...dbCharSet].filter(c => !jsonSet.has(c));
  const jsonNotDb = [...jsonSet].filter(c => !dbCharSet.has(c));
  out.checks.push(`DB chars without JSON: ${dbNotJson.length}`);
  out.checks.push(`JSON chars without DB: ${jsonNotDb.length}`);
  if (dbNotJson.length > 0) out.gaps.push(`DB chars without JSON (first 5): ${dbNotJson.slice(0, 5).join(',')}`);
  if (jsonNotDb.length > 0) out.gaps.push(`orphan JSON files (first 5): ${jsonNotDb.slice(0, 5).join(',')}`);

  // ---------- poems ----------
  const [poemsRows] = await conn.query('SELECT COUNT(*) AS n FROM poems');
  const poemsRow = poemsRows[0];
  out.checks.push(`poems DB: ${poemsRow.n}`);
  const poemsManifest = JSON.parse(fs.readFileSync('data/poems-manifest.json', 'utf8'));
  out.checks.push(`poems manifest items: ${poemsManifest.items.length}`);
  if (poemsManifest.items.length !== Number(poemsRow.n)) out.gaps.push(`poems: manifest=${poemsManifest.items.length} db=${poemsRow.n}`);

  // Check ghost ids
  const [dbPoemIds] = await conn.query('SELECT id FROM poems');
  const dbIdSet = new Set(dbPoemIds.map(r => r.id));
  const manifestIds = poemsManifest.items.map(i => i.id);
  const ghostManifestIds = manifestIds.filter(id => !dbIdSet.has(id));
  const ghostDbIds = [...dbIdSet].filter(id => !manifestIds.includes(id));
  if (ghostManifestIds.length > 0) out.gaps.push(`poems manifest ghost ids: ${ghostManifestIds.join(',')}`);
  if (ghostDbIds.length > 0) out.gaps.push(`poems DB ids not in manifest: ${ghostDbIds.join(',')}`);

  // Check poem files
  const poemsDir = 'data/poems';
  const poemFiles = fs.existsSync(poemsDir) ? fs.readdirSync(poemsDir).filter(f => f.endsWith('.json')) : [];
  out.checks.push(`poems files: ${poemFiles.length}`);

  // ---------- classics ----------
  const [classicRows] = await conn.query('SELECT COUNT(*) AS n FROM classics');
  const classicRow = classicRows[0];
  out.checks.push(`classics DB: ${classicRow.n}`);
  const classicsManifest = JSON.parse(fs.readFileSync('data/classics-manifest.json', 'utf8'));
  out.checks.push(`classics manifest: ${classicsManifest.books.length}`);
  if (classicsManifest.books.length !== Number(classicRow.n)) out.gaps.push(`classics: manifest=${classicsManifest.books.length} db=${classicRow.n}`);

  // ---------- sutras ----------
  const [sutrasRows] = await conn.query('SELECT COUNT(*) AS n FROM sutras');
  const sutrasRow = sutrasRows[0];
  out.checks.push(`sutras DB: ${sutrasRow.n}`);
  const sutrasManifest = JSON.parse(fs.readFileSync('data/sutras/manifest.json', 'utf8'));
  out.checks.push(`sutras manifest: ${sutrasManifest.items.length}`);
  if (sutrasManifest.items.length !== Number(sutrasRow.n)) out.gaps.push(`sutras: manifest=${sutrasManifest.items.length} db=${sutrasRow.n}`);

  // ---------- rare_chars ----------
  const [rareRows] = await conn.query('SELECT COUNT(*) AS n FROM rare_chars');
  const rareRow = rareRows[0];
  out.checks.push(`rare_chars DB: ${rareRow.n}`);

  // ---------- radicals ----------
  const [radRows] = await conn.query('SELECT COUNT(*) AS total, SUM(radical IS NULL OR radical="") AS no_rad FROM chars');
  const radRow = radRows[0];
  out.checks.push(`chars radical coverage: ${radRow.total - Number(radRow.no_rad)}/${radRow.total}`);
  const radicalsJson = JSON.parse(fs.readFileSync('data/radicals.json', 'utf8'));
  out.checks.push(`radicals.json: ${Object.keys(radicalsJson).length} chars`);

  // ---------- app_config ----------
  const [cfgRows] = await conn.query('SELECT `key`, value FROM app_config ORDER BY `key`');
  const expectedKeys = ['ai.model', 'ai.rate_limit_per_user_per_day', 'ai.timeout_ms', 'ai.temperature', 'tts.voice_male', 'tts.voice_female', 'tts.audio_format'];
  const actualKeys = cfgRows.map(r => r.key);
  const missingKeys = expectedKeys.filter(k => !actualKeys.includes(k));
  if (missingKeys.length > 0) out.gaps.push(`app_config missing keys: ${missingKeys.join(',')}`);
  out.checks.push(`app_config: ${cfgRows.length} keys`);

  // ---------- membership_plans + features ----------
  const [plansRows] = await conn.query('SELECT COUNT(*) AS n FROM membership_plans');
  const [featRows] = await conn.query('SELECT COUNT(*) AS n FROM membership_plan_features');
  const plansRow = plansRows[0];
  const featRow = featRows[0];
  out.checks.push(`membership_plans: ${plansRow.n}, features: ${featRow.n}`);
  if (Number(plansRow.n) !== 4) out.gaps.push(`membership_plans != 4: ${plansRow.n}`);
  if (Number(featRow.n) !== 20) out.gaps.push(`membership_plan_features != 20: ${featRow.n}`);

  // ---------- activate singleton ----------
  const [actRows] = await conn.query('SELECT id, short_name FROM activate WHERE id = 1');
  out.checks.push(`activate singleton: ${actRows.length === 1 ? 'present' : 'MISSING'}`);
  if (actRows.length !== 1) out.gaps.push(`activate singleton missing`);

  // ---------- strokes manifest ----------
  if (fs.existsSync('data/strokes-manifest.json')) {
    const strokes = JSON.parse(fs.readFileSync('data/strokes-manifest.json', 'utf8'));
    out.checks.push(`strokes-manifest: ${strokes.supported.length} supported, ${strokes.missing.length} missing (total ${strokes.totalChars})`);
  } else {
    out.gaps.push('data/strokes-manifest.json MISSING');
  }

  // ---------- era-coverage ----------
  if (fs.existsSync('data/era-coverage.json')) {
    const era = JSON.parse(fs.readFileSync('data/era-coverage.json', 'utf8'));
    out.checks.push(`era-coverage: ${Object.keys(era).length} chars`);
  } else {
    out.gaps.push('data/era-coverage.json MISSING');
  }

  // ---------- content manifest ----------
  const cm = JSON.parse(fs.readFileSync('data/content-manifest.json', 'utf8'));
  out.checks.push(`content-manifest totalChars: ${cm.totalChars}, byField: ${JSON.stringify(cm.byField)}`);

  console.log('=== SEED COMPLETENESS CHECK ===\n');
  for (const c of out.checks) console.log('  ' + c);
  console.log('\n=== GAPS ===');
  if (out.gaps.length === 0) console.log('  (none)');
  else for (const g of out.gaps) console.log('  - ' + g);

  await conn.end();
}

main().catch(e => { console.error('FATAL:', e.message); console.error(e.stack); process.exit(1); });
