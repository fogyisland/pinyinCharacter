import { getAllConfig } from '@/lib/config';
import { SpeechConfigForm } from '@/components/admin/SpeechConfigForm';
import { PageHeader } from '@/components/admin/PageHeader';
import { StatCard } from '@/components/admin/StatCard';
import { SPEECH_DAILY_LIMIT_KEY } from '@/lib/azure-speech';
import { readSpeechUsage, type SpeechUsage } from '@/lib/speech-store';
import { formatDateTime } from '@/lib/format';
import { Mic, Users, Gauge } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * The speech-assessment settings page.
 *
 * The values are read here, on the server, and handed to the form island, so
 * opening the page needs no extra request — the same shape as /admin/tts.
 *
 * Only the region is readable: the key is passed as a boolean. A page that
 * can render a secret is a page that leaks it through a screenshot.
 *
 * The usage panel below answers the two questions that decide whether the
 * daily cap is right — "is anybody using this?" and "which words keep scoring
 * low?". Without it the cap was a number nobody could justify.
 */
export default async function AdminSpeechPage() {
  let region = '';
  let dailyLimit = '';
  let hasKey = false;
  let error: string | null = null;
  let usage: SpeechUsage = { todayCount: 0, todayUsers: 0, avgScore: null, recent: [] };

  try {
    const all = await getAllConfig();
    region = all['speech.region'] ?? '';
    dailyLimit = all[SPEECH_DAILY_LIMIT_KEY] ?? '';
    hasKey = Boolean(all['speech.key']);
  } catch (err) {
    console.error('[admin/speech] failed to read the speech config:', err);
    error = (err as Error).message || '配置读取失败';
  }

  // The usage read never throws (a missing table yields an empty panel), so
  // it is deliberately outside the try above: a config read failing must not
  // hide the usage figures, and vice versa.
  usage = await readSpeechUsage();

  return (
    <div>
      <PageHeader
        title="语音评测"
        description="Azure 发音评测的凭据。配置后字典页跟读面板才会出现「精评」，按音节给出准确度。"
      />

      {error && <p className="text-sm text-danger mb-4">配置读取失败：{error}</p>}

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="今日精评次数" value={usage.todayCount} icon={Mic} />
          <StatCard label="今日使用人数" value={usage.todayUsers} icon={Users} />
          <StatCard
            label="近 7 天平均分"
            value={usage.avgScore === null ? '—' : usage.avgScore}
            icon={Gauge}
          />
        </div>

        {/* The form brings its own panel — wrapping it again would stack a
            card inside a card. */}
        <SpeechConfigForm
          initialConfig={{ 'speech.region': region, 'speech.daily_limit': dailyLimit }}
          initialHasKey={hasKey}
        />
        <UsagePanel usage={usage} />
        <HowToPanel />
      </div>
    </div>
  );
}

/**
 * The most recent assessments.
 *
 * Reference, what was heard, the score, who and when. Nothing about the
 * recording — there never was one to read.
 */
function UsagePanel({ usage }: { usage: SpeechUsage }) {
  return (
    <section className="card-paper rounded-lg max-w-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 px-4 py-2.5">
        <h2 className="font-kai text-base text-ink">最近的精评</h2>
        <span className="text-xs text-ink-faint">最近 20 条 · 只记分数，不存录音</span>
      </div>
      {usage.recent.length === 0 ? (
        <p className="p-4 text-sm text-ink-faint">
          还没有人用过精评。配置好凭据后，学生在字词页点「精评」就会出现在这里。
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink-soft">
              <th className="px-4 py-1.5 font-normal">学生</th>
              <th className="px-2 py-1.5 font-normal">练的词</th>
              <th className="px-2 py-1.5 font-normal">听到的</th>
              <th className="px-2 py-1.5 text-right font-normal">分</th>
              <th className="px-4 py-1.5 text-right font-normal">时间</th>
            </tr>
          </thead>
          <tbody>
            {usage.recent.map((row) => (
              <tr key={row.id} className="border-b border-ink/5 last:border-b-0">
                <td className="px-4 py-1.5">
                  {row.username ?? <span className="text-ink-faint">#{row.userId}</span>}
                </td>
                <td className="px-2 py-1.5 font-kai">{row.reference}</td>
                <td className="px-2 py-1.5 text-ink-soft">
                  {/* 「听到的」 differs from the target exactly when the
                      learner said something else — which is the useful signal
                      when a whole class keeps failing one word. */}
                  {row.recognised === row.reference ? '—' : row.recognised}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {Number.isFinite(row.pronunciation) ? Math.round(row.pronunciation) : '—'}
                </td>
                <td className="px-4 py-1.5 text-right text-xs text-ink-faint">
                  {formatDateTime(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Where to find the two values, in the Azure portal.
 *
 * An operator staring at a form that asks for a "region" and a "key" needs the
 * four steps that produce them, not a link to a landing page. This is the
 * part of the page that saves a support message.
 */
function HowToPanel() {
  return (
    <section className="card-paper rounded-lg max-w-xl">
      <div className="border-b border-ink/10 px-4 py-2.5">
        <h2 className="font-kai text-base text-ink">怎么拿到区域和密钥</h2>
      </div>
      <div className="space-y-2 p-4 text-sm text-ink-soft">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            在 Azure 门户「创建资源」里搜索 <code>Speech</code>，创建一项
            <strong>语音服务（Speech service）</strong>资源，选择学生主要所在的区域
            （例如 <code>eastasia</code>）。
          </li>
          <li>
            资源创建完成后，打开它的「密钥和终结点 / Keys and Endpoint」页：<br />
            · <strong>密钥</strong> 是那两行长字符串之一，粘贴到上面的「密钥」；
            <br />· <strong>位置/区域</strong> 就是资源所在的区域代码，粘贴到上面的「区域」。
          </li>
          <li>
            定价层用 <strong>Free F0</strong> 就够试用：每月有免费额度，个人学习场景通常用不完。
            正式长期使用再按量付费。
          </li>
          <li>回到本页点保存。之后打开任意字词页，跟读面板会出现「精评」按钮。</li>
        </ol>
        <p className="text-xs text-ink-faint">
          录音只会在这个按钮被点击时上传，仅用于这一次打分，不落盘、不进日志。
          没有配置时，跟读功能仍然可用 —— 用的是浏览器自带识别，录音不出本机。
        </p>
        <p className="text-xs text-ink-faint">
          区域名只写代码（<code>eastasia</code>、<code>westus</code>、<code>southeastasia</code>、{' '}
          <code>japaneast</code>…），不要带 <code>https://</code> 或 <code>.stt.speech.microsoft.com</code>：
          保存时会校验，填错会得到提示。
        </p>
      </div>
    </section>
  );
}
