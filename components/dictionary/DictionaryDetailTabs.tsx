import Link from 'next/link';
import type { CharWithRelated } from '@/lib/chars-types';
import { StrokeOrderCard } from './StrokeOrderCard';
import { DictionaryDetailAddToWorksheet } from './DictionaryDetailAddToWorksheet';
import { ReadAloudButton } from '@/components/ReadAloudButton';

export function DictionaryDetailTabs({ char }: { char: CharWithRelated }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-ink/30 mb-4">
        <span className="bg-ink text-paper px-3 py-2 rounded-t text-sm">字典</span>
        <Link href={`/etymology/${encodeURIComponent(char.char)}`} className="px-3 py-2 text-sm text-ink-soft hover:text-ink">字源 →</Link>
        <Link href={`/stories/${encodeURIComponent(char.char)}`} className="px-3 py-2 text-sm text-ink-soft hover:text-ink">故事 →</Link>
        <DictionaryDetailAddToWorksheet char={char.char} />
        <span className="ml-auto flex items-center gap-2 pb-1">
          <ReadAloudButton text={char.char} label="读字" size="sm" variant="seal" voice="male" />
          <ReadAloudButton text={char.pinyin} label="读音" size="sm" variant="paper" voice="female" />
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Field label="拼音" value={char.pinyin} />
        <Field label="部首" value={`${char.radical} · ${char.strokeCount} 画`} />
        <Field label="释义" value={char.meaningZh || '—'} multiline />
        <Field label="英文" value={char.meaningEn || '—'} />
        <Field label="Unicode" value={char.unicodeCodepoint} />
        <Field label="异体" value={char.variants.length > 0 ? char.variants.join('、') : '—'} />
        {char.pinyinAlt.length > 1 && <Field label="多音" value={char.pinyinAlt.join('、')} />}
        <Field label="级别" value={`通用规范 ${char.level} 级`} />
      </div>

      {(char.relatedByRadical.length > 0 || char.relatedByPinyin.length > 0) && (
        <div className="mt-6 text-sm">
          {char.relatedByRadical.length > 0 && (
            <div className="mb-2">
              <span className="text-ink-faint">同部首 ·</span>{' '}
              {char.relatedByRadical.map((c) => (
                <Link key={c.char} href={`/dictionary/${encodeURIComponent(c.char)}`} className="mr-2 hover:text-seal">{c.char}</Link>
              ))}
            </div>
          )}
          {char.relatedByPinyin.length > 0 && (
            <div>
              <span className="text-ink-faint">同拼音 ·</span>{' '}
              {char.relatedByPinyin.map((c) => (
                <Link key={c.char} href={`/dictionary/${encodeURIComponent(c.char)}`} className="mr-2 hover:text-seal">{c.char}</Link>
              ))}
            </div>
          )}
        </div>
      )}

      {char.char.length === 1 && (
        <div className="mt-6">
          <StrokeOrderCard char={char.char} />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? 'sm:col-span-2' : ''}>
      <span className="text-ink-faint">{label} ·</span>{' '}
      <span className={multiline ? 'whitespace-pre-line' : ''}>{value}</span>
    </div>
  );
}