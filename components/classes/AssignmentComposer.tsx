'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createAssignmentRequest,
  type CreateAssignmentBody,
} from '@/lib/api-classes';

/**
 * 派作业的表单：字帖（一串字）或听写（一串「词 + 拼音」）。
 *
 * 为什么两种形状放在同一张表单里：老师每周做的其实是同一个动作 ——
 * 「这周练这些」和「这周听写这些」。分成两个入口会让老师在两个页面之间
 * 来回切。用一对单选按钮切换即可。
 */
export interface AssignmentComposerProps {
  classId: number;
  onDone: () => void;
  onCancel: () => void;
}

export function AssignmentComposer({ classId, onDone, onCancel }: AssignmentComposerProps) {
  const router = useRouter();
  const [kind, setKind] = useState<'worksheet' | 'dictation'>('worksheet');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 把老师粘贴的内容拆成字帖的字或听写的词条。
   *
   * 字帖：只留汉字，标点、空格、逗号统统丢掉 —— 一个字一个格子，
   * 标点进格子会让学生不知道该写什么。
   * 听写：一行一条，逗号或空格分隔；拼音留空，由服务器按需注音。
   */
  function buildBody(): CreateAssignmentBody | null {
    if (kind === 'worksheet') {
      const chars = Array.from(content).filter((char) => /^[㐀-鿿]$/.test(char));
      if (chars.length === 0) return null;
      return {
        title,
        kind: 'worksheet',
        worksheetId: 0,
        chars,
        dueAt: dueAt || null,
      };
    }
    const items = content
      .split(/[,，;\n]+/)
      .map((word) => word.trim())
      .filter((word) => word !== '')
      .map((word) => ({ word, pinyin: '' }));
    if (items.length === 0) return null;
    return { title, kind: 'dictation', items, dueAt: dueAt || null };
  }

  async function handleSubmit(): Promise<void> {
    const body = buildBody();
    if (!body) {
      setError(
        kind === 'worksheet'
          ? '这份字帖还没有字 —— 请粘贴要练的汉字。'
          : '这份听写还没有词条 —— 请粘贴要听写的词。',
      );
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createAssignmentRequest(classId, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="card-paper space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="assignment-kind"
            checked={kind === 'worksheet'}
            onChange={() => setKind('worksheet')}
          />
          字帖
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="assignment-kind"
            checked={kind === 'dictation'}
            onChange={() => setKind('dictation')}
          />
          听写
        </label>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
          截止日期
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded border border-ink/20 bg-paper px-2 py-1"
          />
        </label>
      </div>

      <label className="block text-xs text-ink-soft">
        标题
        <input
          aria-label="作业标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'worksheet' ? '第 3 课生字' : '第 3 课听写'}
          className="mt-1 w-full rounded border border-ink/20 bg-paper px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block text-xs text-ink-soft">
        {kind === 'worksheet' ? '要练的字（标点会自动去掉）' : '要听写的词（逗号或换行分隔）'}
        <textarea
          aria-label="作业内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder={
            kind === 'worksheet'
              ? '学 生 老 师'
              : '学生，老师，学校，学习'
          }
          className="mt-1 w-full rounded border border-ink/20 bg-paper p-2 text-sm"
        />
      </label>

      {error ? (
        <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={busy || title.trim() === ''}
          className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80 disabled:bg-ink/20"
        >
          {busy ? '发布中…' : '发布'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-ink/20 px-3 py-1.5 text-sm text-ink-soft"
        >
          取消
        </button>
      </div>
    </div>
  );
}
