'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { DuiyunPair } from '@/lib/duiyun-rules';
import { isPing, toneOf } from '@/lib/duiyun-rules';
import {
  CLASSIC_COUPLETS,
  METER_PRESETS,
  PINGSHUI_RHYMES,
  analyzeCouplet,
  analyzePoemLines,
  buildCharRhymeIndex,
} from './prosody-data';

type ActiveStudio = 'rhyme' | 'meter' | 'couplet';

function pingZeBadge(syllable: string): { label: '平' | '仄' | '轻'; isPingTone: boolean } {
  const t = toneOf(syllable);
  if (t === null) return { label: '轻', isPingTone: false };
  const p = isPing(t);
  return { label: p ? '平' : '仄', isPingTone: p };
}

export function ProsodyWorkbench({ pairs }: { pairs: readonly DuiyunPair[] }) {
  const searchParams = (() => {
    try {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- wrapped in try/catch for unit test environments without router context
      return useSearchParams();
    } catch {
      return null;
    }
  })();
  const tabParam = searchParams?.get('tab');
  const initialTab: ActiveStudio =
    tabParam === 'meter' || tabParam === 'couplet' || tabParam === 'rhyme' ? tabParam : 'rhyme';

  const [studio, setStudio] = useState<ActiveStudio>(initialTab);

  useEffect(() => {
    if (tabParam === 'meter' || tabParam === 'couplet' || tabParam === 'rhyme') {
      setStudio(tabParam);
    }
  }, [tabParam]);

  // 1) 平水韵谱状态
  const [selectedRhyme, setSelectedRhyme] = useState<string>('一东');
  const [bookFilter, setBookFilter] = useState<'all' | '声律启蒙' | '笠翁对韵'>('all');
  const [rhymeQuery, setRhymeQuery] = useState<string>('');
  const [blindMode, setBlindMode] = useState<boolean>(false);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});

  // 2) 近体格律谱状态
  const [presetId, setPresetId] = useState<string>(METER_PRESETS[0]!.id);
  const [poemInput, setPoemInput] = useState<string>(METER_PRESETS[0]!.sample);

  // 3) 楹联对仗席状态
  const [coupletCategory, setCoupletCategory] = useState<
    'all' | '蒙学成联' | '书斋励学' | '山水园林' | '岁时春联'
  >('all');
  const [horizontalBatch, setHorizontalBatch] = useState<string>('春光烂漫');
  const [upperInput, setUpperInput] = useState<string>('两岸晓烟杨柳绿');
  const [lowerInput, setLowerInput] = useState<string>('一园春雨杏花红');
  const [activeCoupletNote, setActiveCoupletNote] = useState<string>(
    CLASSIC_COUPLETS[0]!.structureNote,
  );
  const [activeCoupletSource, setActiveCoupletSource] = useState<string>(
    CLASSIC_COUPLETS[0]!.source,
  );

  const rhymeIndex = useMemo(() => buildCharRhymeIndex(pairs), [pairs]);

  const rhymeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of pairs) {
      counts[p.rhyme] = (counts[p.rhyme] ?? 0) + 1;
    }
    return counts;
  }, [pairs]);

  const currentRhymeMeta = useMemo(
    () => PINGSHUI_RHYMES.find((r) => r.name === selectedRhyme) ?? PINGSHUI_RHYMES[0]!,
    [selectedRhyme],
  );

  const filteredPairs = useMemo(() => {
    const q = rhymeQuery.trim();
    return pairs.filter((p) => {
      if (bookFilter !== 'all' && p.book !== bookFilter) return false;
      if (q) {
        return (
          p.upper.includes(q) ||
          p.lower.includes(q) ||
          p.rhyme.includes(q) ||
          p.upperPinyin.some((py) => py.includes(q)) ||
          p.lowerPinyin.some((py) => py.includes(q))
        );
      }
      return p.rhyme === selectedRhyme;
    });
  }, [pairs, selectedRhyme, bookFilter, rhymeQuery]);

  const currentPreset = useMemo(
    () => METER_PRESETS.find((p) => p.id === presetId) ?? METER_PRESETS[0]!,
    [presetId],
  );

  const analyzedPoem = useMemo(
    () => analyzePoemLines(poemInput, currentPreset.pattern, rhymeIndex),
    [poemInput, currentPreset.pattern, rhymeIndex],
  );

  const coupletResult = useMemo(
    () => analyzeCouplet(upperInput, lowerInput, rhymeIndex),
    [upperInput, lowerInput, rhymeIndex],
  );

  function selectPreset(id: string) {
    const found = METER_PRESETS.find((p) => p.id === id);
    if (!found) return;
    setPresetId(found.id);
    setPoemInput(found.sample);
  }

  return (
    <div className="space-y-10">
      {/* 案头导航条 */}
      <div
        role="tablist"
        aria-label="声律研习工作台"
        className="flex flex-wrap gap-2 border-b border-ink/25 pb-4"
      >
        {(
          [
            ['rhyme', '平水韵三十部谱', '30 韵部 · 761 副经典对句检索与盲对'],
            ['meter', '近体诗平仄格律校验', '五绝 · 七绝 · 五律定式逐字校验与押韵核验'],
            ['couplet', '楹联（对联）谱系与对仗席', '中堂竖排预览 · 历代名联谱系 · 撰联平仄校验'],
          ] as const
        ).map(([id, title, desc]) => {
          const active = studio === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStudio(id)}
              className={`flex min-h-11 flex-col items-start border px-4 py-2.5 text-left transition-colors ${
                active
                  ? 'border-seal bg-seal text-paper-soft'
                  : 'border-ink/20 bg-paper-soft text-ink hover:border-seal'
              }`}
            >
              <span className="font-kai text-xl">{title}</span>
              <span className={`text-xs ${active ? 'text-paper-soft/85' : 'text-ink-soft'}`}>
                {desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* 1) 平水韵三十部谱 */}
      {studio === 'rhyme' && (
        <div className="grid items-start gap-8 lg:grid-cols-[19rem_1fr]">
          {/* 左侧三十韵部目录 */}
          <aside className="space-y-6 border border-ink/20 bg-paper-soft p-5">
            <div>
              <label htmlFor="rhyme-search" className="block font-kai text-lg text-ink">
                检索字词或韵部
              </label>
              <input
                id="rhyme-search"
                type="search"
                value={rhymeQuery}
                onChange={(e) => setRhymeQuery(e.target.value)}
                placeholder="输入汉字、拼音或韵目（如 风、云）"
                className="mt-2 w-full border border-ink/25 bg-paper px-3 py-2 text-sm"
              />
              {rhymeQuery.trim() && (
                <p className="mt-1.5 text-xs text-seal">
                  正在跨三十韵部检索「{rhymeQuery.trim()}」· 共 {filteredPairs.length} 副
                </p>
              )}
            </div>

            {(['上平声十五韵', '下平声十五韵'] as const).map((vol) => (
              <div key={vol}>
                <h2 className="mb-2.5 border-b border-ink/15 pb-1 font-kai text-lg text-ink">
                  {vol}
                </h2>
                <div className="grid grid-cols-3 gap-1.5">
                  {PINGSHUI_RHYMES.filter((r) => r.volume === vol).map((r) => {
                    const active = !rhymeQuery.trim() && selectedRhyme === r.name;
                    return (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => {
                          setRhymeQuery('');
                          setSelectedRhyme(r.name);
                        }}
                        className={`flex min-h-10 items-center justify-between border px-2 py-1 text-sm transition-colors ${
                          active
                            ? 'border-seal bg-seal font-medium text-paper-soft'
                            : 'border-ink/15 bg-paper text-ink hover:border-seal'
                        }`}
                      >
                        <span className="font-kai">{r.name}</span>
                        <span className="text-xs opacity-75">{rhymeCounts[r.name] ?? 0}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </aside>

          {/* 右侧当前韵部详谱与对句列表 */}
          <section className="space-y-6">
            <header className="border-y border-ink/25 bg-paper-soft p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <span className="text-xs tracking-widest text-seal">
                    {currentRhymeMeta.volume}
                  </span>
                  <h2 className="mt-1 font-kai text-3xl text-ink sm:text-4xl">
                    {rhymeQuery.trim()
                      ? `检索「${rhymeQuery.trim()}」所得对句`
                      : `${currentRhymeMeta.name} · 韵部对句谱`}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <Link
                    href={`/ancient/${currentRhymeMeta.shenglvSlug}?chunk=${currentRhymeMeta.chunkIndex}`}
                    className="inline-flex min-h-10 items-center border border-ink/25 px-3 py-1.5 text-seal hover:border-seal"
                  >
                    读《声律启蒙·{currentRhymeMeta.name}》全篇 →
                  </Link>
                  <Link
                    href={`/ancient/${currentRhymeMeta.liwengSlug}?chunk=${currentRhymeMeta.chunkIndex}`}
                    className="inline-flex min-h-10 items-center border border-ink/25 px-3 py-1.5 text-seal hover:border-seal"
                  >
                    读《笠翁对韵·{currentRhymeMeta.name}》全篇 →
                  </Link>
                </div>
              </div>
              <p className="mt-3 leading-7 text-ink-soft">{currentRhymeMeta.phoneticNote}</p>

              {/* 典籍筛选与盲对开关 */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-ink/15 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-ink-soft">典籍来源：</span>
                  {(['all', '笠翁对韵', '声律启蒙'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBookFilter(b)}
                      className={`min-h-9 border px-3 py-1 text-xs ${
                        bookFilter === b
                          ? 'border-seal bg-seal text-paper-soft'
                          : 'border-ink/20 text-ink-soft hover:border-seal'
                      }`}
                    >
                      {b === 'all' ? '全部典籍' : `《${b}》`}
                    </button>
                  ))}
                </div>
                <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={blindMode}
                    onChange={(e) => {
                      setBlindMode(e.target.checked);
                      setRevealedKeys({});
                    }}
                  />
                  <span>遮蔽下联自测（盲对习练）</span>
                </label>
              </div>
            </header>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredPairs.map((pair, idx) => {
                const key = `${pair.rhyme}-${pair.book}-${pair.upper}-${pair.lower}-${idx}`;
                const hiddenLower = blindMode && !revealedKeys[key];
                return (
                  <article
                    key={key}
                    className="flex flex-col justify-between border border-ink/20 bg-paper-soft p-4"
                  >
                    <div className="flex items-center justify-between border-b border-ink/10 pb-2 text-xs text-ink-faint">
                      <span>{pair.rhyme}</span>
                      <span>《{pair.book}》</span>
                    </div>

                    <div className="my-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      {/* 上句 */}
                      <div className="flex justify-center gap-2">
                        {Array.from(pair.upper).map((ch, i) => {
                          const py = pair.upperPinyin[i] ?? '';
                          const pz = pingZeBadge(py);
                          return (
                            <div key={i} className="text-center">
                              <span className="block text-[11px] text-ink-faint">{py}</span>
                              <span className="block font-kai text-2xl text-ink">{ch}</span>
                              <span
                                className={`mt-0.5 inline-block px-1.5 text-[11px] ${
                                  pz.isPingTone ? 'bg-ink/10 text-ink' : 'bg-seal/15 text-seal'
                                }`}
                              >
                                {pz.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <span className="font-kai text-sm text-ink-faint">对</span>

                      {/* 下句 */}
                      <div className="flex justify-center gap-2">
                        {hiddenLower ? (
                          <button
                            type="button"
                            onClick={() => setRevealedKeys((prev) => ({ ...prev, [key]: true }))}
                            className="min-h-11 border border-dashed border-seal px-3 py-2 text-xs text-seal hover:bg-seal/10"
                          >
                            点击揭晓下联
                          </button>
                        ) : (
                          Array.from(pair.lower).map((ch, i) => {
                            const py = pair.lowerPinyin[i] ?? '';
                            const pz = pingZeBadge(py);
                            return (
                              <div key={i} className="text-center">
                                <span className="block text-[11px] text-ink-faint">{py}</span>
                                <span className="block font-kai text-2xl text-seal">{ch}</span>
                                <span
                                  className={`mt-0.5 inline-block px-1.5 text-[11px] ${
                                    pz.isPingTone ? 'bg-ink/10 text-ink' : 'bg-seal/15 text-seal'
                                  }`}
                                >
                                  {pz.label}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* 2) 近体诗平仄格律校验器 */}
      {studio === 'meter' && (
        <div className="grid items-start gap-8 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-5 border border-ink/20 bg-paper-soft p-6">
            <div>
              <label htmlFor="preset-select" className="block font-kai text-xl text-ink">
                选择近体诗定式
              </label>
              <select
                id="preset-select"
                value={presetId}
                onChange={(e) => selectPreset(e.target.value)}
                className="mt-2 w-full border border-ink/25 bg-paper px-3 py-2 text-sm"
              >
                {METER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}（{p.author}）
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs leading-6 text-ink-soft">{currentPreset.rhymeNote}</p>
            </div>

            <div>
              <label htmlFor="poem-meter-input" className="block font-kai text-xl text-ink">
                输入或修改诗句（每行一句）
              </label>
              <textarea
                id="poem-meter-input"
                rows={6}
                value={poemInput}
                onChange={(e) => setPoemInput(e.target.value)}
                className="mt-2 w-full border border-ink/25 bg-paper p-3 font-kai text-lg leading-relaxed"
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                图例：「○ 平」为阴平、阳平；「● 仄」为上声、去声；「◎
                中」表示该字位可平可仄（一三五不论，二四六分明）。
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <header className="border-y border-ink/25 bg-paper-soft p-6">
              <span className="text-xs tracking-widest text-seal">{currentPreset.form}</span>
              <h2 className="mt-1 font-kai text-3xl text-ink">
                {currentPreset.title} · 逐字平仄谱
              </h2>
              <p className="mt-2 text-sm text-ink-soft">
                经典范例：{currentPreset.author}。下方自动对照定式校验每个字位的平仄与句尾韵母。
              </p>
            </header>

            <div className="space-y-4">
              {analyzedPoem.map((line, lineIdx) => {
                const tail = line.chars[line.chars.length - 1];
                return (
                  <div key={lineIdx} className="border border-ink/20 bg-paper-soft p-4 sm:p-6">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 pb-2 text-xs text-ink-soft">
                      <span>
                        第 {lineIdx + 1} 句 · 定式：{currentPreset.pattern[lineIdx] ?? '自由句式'}
                      </span>
                      {tail && (
                        <span>
                          句尾「{tail.char}」：韵母 -{tail.final || '?'}（{tail.pingZe}声）
                          {tail.knownRhymes.length > 0 &&
                            ` · 见于平水韵【${tail.knownRhymes.join(' / ')}】`}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {line.chars.map((c, idx) => (
                        <div
                          key={idx}
                          className={`min-w-14 border p-2.5 text-center ${
                            c.status === 'mismatch'
                              ? 'border-seal bg-seal/10'
                              : 'border-ink/15 bg-paper'
                          }`}
                        >
                          <span className="block text-xs text-ink-faint">{c.syllable}</span>
                          <span className="my-1 block font-kai text-3xl text-ink">{c.char}</span>
                          <span className="block text-xs font-medium text-ink">
                            {c.pingZe === '平' ? '○ 平' : c.pingZe === '仄' ? '● 仄' : '轻'}
                          </span>
                          {c.expected && (
                            <span
                              className={`mt-1 block border-t border-ink/10 pt-1 text-[11px] ${
                                c.status === 'mismatch' ? 'font-medium text-seal' : 'text-ink-faint'
                              }`}
                            >
                              谱：{c.expected === '中' ? '◎ 可平仄' : `定${c.expected}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3) 楹联平仄对仗席 */}
      {studio === 'couplet' && (
        <div className="space-y-8">
          <header className="border-y border-ink/25 bg-paper-soft p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <span className="text-xs tracking-widest text-seal">由声律属对衍生之实用文体</span>
                <h2 className="mt-1 font-kai text-3xl text-ink sm:text-4xl">
                  楹联（对联）谱系与中堂对仗席
                </h2>
              </div>
              <Link
                href="/game"
                className="inline-flex min-h-10 items-center border border-ink/25 px-3 py-1.5 text-sm text-seal hover:border-seal"
              >
                去「对韵闯关」动手拆字配联 →
              </Link>
            </div>
            <p className="mt-3 leading-7 text-ink-soft">
              对联（又称楹联、对子）源于古代桃符与骈赋律诗之对仗。自《声律启蒙》一字对（天对地）、二字对（大陆对长空）、三字对（三尺剑对六钧弓），推扩至五言、七言及隔句长联。张挂之时，
              <strong>面向门堂，右手为上联（必以仄声收尾），左手为下联（必以平声收尾）</strong>。
            </p>
          </header>

          {/* 中堂竖排楹联堂挂与撰联校验并列 */}
          <div className="grid items-start gap-8 lg:grid-cols-[22rem_1fr]">
            {/* 左侧：传统竖排中堂悬挂方位图 */}
            <aside className="border-2 border-ink/30 bg-paper-soft p-6">
              <div className="mb-3 flex items-center justify-between border-b border-ink/15 pb-2 text-xs text-ink-faint">
                <span>传统门堂张贴法式（面门视角）</span>
                <span className="text-seal">左平 · 右仄</span>
              </div>

              {/* 横批 */}
              <div className="mx-auto mb-5 w-fit border border-seal bg-seal px-5 py-1.5 font-kai text-xl tracking-[0.35em] text-paper-soft">
                {horizontalBatch || '山河清朗'}
              </div>

              {/* 左右双柱竖排联（面门左为下联，面门右为上联） */}
              <div className="grid grid-cols-2 gap-6 py-2">
                <div className="flex flex-col items-center">
                  <span className="mb-2 text-xs text-ink-faint">
                    下联（居左 ·{' '}
                    {coupletResult.lower[coupletResult.lower.length - 1]?.pingZe ?? '平'}收）
                  </span>
                  <div className="min-h-64 border border-seal/45 bg-seal px-3.5 py-5 font-kai text-2xl leading-snug tracking-[0.25em] text-paper-soft [writing-mode:vertical-rl]">
                    {lowerInput || '一园春雨杏花红'}
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <span className="mb-2 text-xs text-ink-faint">
                    上联（居右 ·{' '}
                    {coupletResult.upper[coupletResult.upper.length - 1]?.pingZe ?? '仄'}收）
                  </span>
                  <div className="min-h-64 border border-seal/45 bg-seal px-3.5 py-5 font-kai text-2xl leading-snug tracking-[0.25em] text-paper-soft [writing-mode:vertical-rl]">
                    {upperInput || '两岸晓烟杨柳绿'}
                  </div>
                </div>
              </div>

              <p className="mt-4 border-t border-ink/15 pt-3 text-xs leading-6 text-ink-soft">
                出处：{activeCoupletSource}
                <br />
                法度：{activeCoupletNote}
              </p>
            </aside>

            {/* 右侧：撰联输入与逐字平仄比勘 */}
            <div className="min-w-0 space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="border border-ink/20 bg-paper-soft p-4">
                  <label htmlFor="couplet-upper" className="block font-kai text-lg text-ink">
                    上联（居右 · 仄声收）
                  </label>
                  <input
                    id="couplet-upper"
                    type="text"
                    value={upperInput}
                    onChange={(e) => {
                      setUpperInput(e.target.value);
                      setActiveCoupletSource('自撰楹联');
                      setActiveCoupletNote('系统实时校验上下联字数、逐位平仄相反度与尾字平仄。');
                    }}
                    className="mt-2 w-full border border-ink/25 bg-paper px-3 py-2 font-kai text-xl"
                  />
                </div>
                <div className="border border-ink/20 bg-paper-soft p-4">
                  <label htmlFor="couplet-lower" className="block font-kai text-lg text-ink">
                    下联（居左 · 平声收）
                  </label>
                  <input
                    id="couplet-lower"
                    type="text"
                    value={lowerInput}
                    onChange={(e) => {
                      setLowerInput(e.target.value);
                      setActiveCoupletSource('自撰楹联');
                      setActiveCoupletNote('系统实时校验上下联字数、逐位平仄相反度与尾字平仄。');
                    }}
                    className="mt-2 w-full border border-ink/25 bg-paper px-3 py-2 font-kai text-xl"
                  />
                </div>
                <div className="border border-ink/20 bg-paper-soft p-4">
                  <label htmlFor="couplet-batch" className="block font-kai text-lg text-ink">
                    横批（四字题额）
                  </label>
                  <input
                    id="couplet-batch"
                    type="text"
                    value={horizontalBatch}
                    onChange={(e) => setHorizontalBatch(e.target.value)}
                    className="mt-2 w-full border border-ink/25 bg-paper px-3 py-2 font-kai text-xl"
                  />
                </div>
              </div>

              <div className="border border-ink/25 bg-paper-soft p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-kai text-xl text-seal">{coupletResult.summary}</p>
                  <Link
                    href={`/worksheet?prefill=${encodeURIComponent(
                      Array.from(new Set(Array.from(upperInput + lowerInput)))
                        .slice(0, 12)
                        .join(''),
                    )}`}
                    className="text-xs text-seal underline underline-offset-4"
                  >
                    用本联汉字生成书法字帖 →
                  </Link>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[26rem] border-collapse text-center">
                    <thead>
                      <tr className="border-b border-ink/20 text-xs text-ink-faint">
                        <th className="py-2 text-left">联别</th>
                        {coupletResult.upper.map((_, idx) => (
                          <th key={idx} className="py-2">
                            第 {idx + 1} 字
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-ink/10">
                        <td className="py-3 text-left font-kai text-lg">上联</td>
                        {coupletResult.upper.map((c, idx) => (
                          <td key={idx} className="py-3">
                            <span className="block text-xs text-ink-faint">{c.syllable}</span>
                            <span className="font-kai text-2xl">{c.char}</span>
                            <span className="block text-xs text-ink-soft">{c.pingZe}</span>
                          </td>
                        ))}
                      </tr>
                      <tr className="border-b border-ink/10">
                        <td className="py-3 text-left font-kai text-lg">下联</td>
                        {coupletResult.lower.map((c, idx) => (
                          <td key={idx} className="py-3">
                            <span className="block text-xs text-ink-faint">{c.syllable}</span>
                            <span className="font-kai text-2xl text-seal">{c.char}</span>
                            <span className="block text-xs text-ink-soft">{c.pingZe}</span>
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-3 text-left text-xs text-ink-faint">平仄相对</td>
                        {coupletResult.upper.map((u, idx) => {
                          const l = coupletResult.lower[idx];
                          const opposed =
                            l &&
                            ((u.pingZe === '平' && l.pingZe === '仄') ||
                              (u.pingZe === '仄' && l.pingZe === '平'));
                          return (
                            <td key={idx} className="py-3 text-xs">
                              {l ? (
                                <span className={opposed ? 'text-ink' : 'text-seal'}>
                                  {opposed ? '相对' : '同声'}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 经典名联分类谱系 */}
              <section className="space-y-4 border-t border-ink/20 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-kai text-2xl text-ink">
                    历代经典楹联谱系（点击即载入中堂与比勘表）
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', '蒙学成联', '书斋励学', '山水园林', '岁时春联'] as const).map(
                      (cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCoupletCategory(cat)}
                          className={`min-h-9 border px-3 py-1 text-xs ${
                            coupletCategory === cat
                              ? 'border-seal bg-seal text-paper-soft'
                              : 'border-ink/20 bg-paper-soft text-ink-soft hover:border-seal'
                          }`}
                        >
                          {cat === 'all' ? '全部门类' : cat}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {CLASSIC_COUPLETS.filter(
                    (c) => coupletCategory === 'all' || c.category === coupletCategory,
                  ).map((item) => (
                    <article
                      key={item.id}
                      className="flex flex-col justify-between border border-ink/20 bg-paper-soft p-4"
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-ink-faint">
                          <span className="text-seal">{item.category}</span>
                          <span>横批：{item.horizontalBatch}</span>
                        </div>
                        <p className="mt-2 font-kai text-xl text-ink">
                          {item.upper}；{item.lower}。
                        </p>
                        <p className="mt-1.5 text-xs leading-6 text-ink-soft">
                          {item.structureNote}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 pt-2.5 text-xs">
                        <span className="text-ink-faint">{item.source}</span>
                        <div className="flex items-center gap-3">
                          {item.href && (
                            <Link href={item.href} className="text-ink-soft underline">
                              读原篇
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setHorizontalBatch(item.horizontalBatch);
                              setUpperInput(item.upper);
                              setLowerInput(item.lower);
                              setActiveCoupletNote(item.structureNote);
                              setActiveCoupletSource(item.source);
                            }}
                            className="font-medium text-seal hover:underline"
                          >
                            载入中堂比勘 ↑
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
