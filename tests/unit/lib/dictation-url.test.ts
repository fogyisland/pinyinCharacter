// @vitest-environment node
import { describe, it, expect } from 'vitest';

/**
 * 班级作业 → 听写工具的链接。
 *
 * ## 为什么不是把词表塞进 URL
 *
 * 第一版把 60 个词（含拼音）编码进 `?items=`。实测 **5480 个字符**：
 * 每个汉字在 URL 里要写成 9 个字符的 `%E5%AD%A6`。代理在 2 KB 左右开始
 * 拒绝或截断，而一份作业可以有 200 条 —— 「老师派了 30 个词，学生只看到
 * 12 个」会成为常态，且没有任何提示。
 *
 * 改成两个编号后链接只有几十个字符，永远完整，而且词表只有一份真相：
 * 班级库里那一份。权限由已有的 `/api/classes/[id]` 判断，非本班成员拿不到，
 * 所以链接本身不泄露内容。
 *
 * ## 解析为什么不抛
 *
 * 这两个值来自学生可以手改的地址栏。抛错会在渲染表单之前把页面搞崩；
 * 正确行为是当成「没有链接」—— 也就是这个功能存在之前的状态：空表单。
 */

import { buildAssignmentDictationHref, parseAssignmentLink } from '@/lib/dictation-url';

describe('parseAssignmentLink', () => {
  it('reads both ids', () => {
    expect(parseAssignmentLink({ classId: '7', assignmentId: '12' })).toEqual({
      classId: 7,
      assignmentId: 12,
    });
  });

  it('needs BOTH ids', () => {
    // One id alone resolves nothing; treating it as a link would open the
    // runner on an assignment that cannot be looked up.
    expect(parseAssignmentLink({ classId: '7' })).toBeNull();
    expect(parseAssignmentLink({ assignmentId: '12' })).toBeNull();
    expect(parseAssignmentLink({})).toBeNull();
    expect(parseAssignmentLink(null)).toBeNull();
  });

  it('rejects anything that is not a positive integer', () => {
    expect(parseAssignmentLink({ classId: '0', assignmentId: '12' })).toBeNull();
    expect(parseAssignmentLink({ classId: '-3', assignmentId: '12' })).toBeNull();
    expect(parseAssignmentLink({ classId: '7.5', assignmentId: '12' })).toBeNull();
    expect(parseAssignmentLink({ classId: 'abc', assignmentId: '12' })).toBeNull();
    // A SQL-shaped value must not survive as a "number".
    expect(parseAssignmentLink({ classId: '7 OR 1=1', assignmentId: '12' })).toBeNull();
  });

  it('does not throw on a hand-edited address bar', () => {
    expect(() => parseAssignmentLink({ classId: '%00', assignmentId: '' })).not.toThrow();
  });
});

describe('buildAssignmentDictationHref', () => {
  it('builds a link that parses back', () => {
    const href = buildAssignmentDictationHref(7, 12);
    expect(href).toBe('/dictation?classId=7&assignmentId=12');
    const query = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(
      parseAssignmentLink({
        classId: query.get('classId') ?? undefined,
        assignmentId: query.get('assignmentId') ?? undefined,
      }),
    ).toEqual({ classId: 7, assignmentId: 12 });
  });

  it('stays short regardless of how many words the assignment holds', () => {
    // Two ids are ~34 characters; the 200-word assignment costs nothing in
    // the URL. This is the whole reason the words are NOT in the link.
    expect(buildAssignmentDictationHref(1234, 98765).length).toBeLessThan(60);
  });
});
