// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * 后台的「语音评测」表单。
 *
 * 这个表单只有两个字段，但有一条规则决定了它的全部行为：**密钥永远不回显**。
 *
 * 后台读不到已存的密钥（接口只回一个布尔），所以输入框一开始是空的。于是
 * 「留空」必须意味着「不改」—— 否则管理员每次点保存都会把密钥擦掉，功能
 * 静默失效。这一组用例钉住的正是这条规则，以及区域名的校验。
 */

const { updateSpeechConfigRequestMock, verifySpeechConfigRequestMock } = vi.hoisted(() => ({
  updateSpeechConfigRequestMock: vi.fn(),
  verifySpeechConfigRequestMock: vi.fn(),
}));

vi.mock('@/lib/api-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-admin')>('@/lib/api-admin');
  return {
    ...actual,
    updateSpeechConfigRequest: updateSpeechConfigRequestMock,
    verifySpeechConfigRequest: verifySpeechConfigRequestMock,
  };
});

import { SpeechConfigForm } from '@/components/admin/SpeechConfigForm';

beforeEach(() => {
  updateSpeechConfigRequestMock.mockReset();
  verifySpeechConfigRequestMock.mockReset();
  updateSpeechConfigRequestMock.mockResolvedValue({
    ok: true,
    data: { config: { 'speech.region': 'eastasia' }, hasKey: true },
  });
  verifySpeechConfigRequestMock.mockResolvedValue({
    ok: true,
    data: { ok: true, reason: null, message: '' },
  });
});

afterEach(() => {
  cleanup();
});

describe('SpeechConfigForm', () => {
  it('starts with the key field empty even when a key is stored', () => {
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    const key = screen.getByLabelText(/密钥/) as HTMLInputElement;
    // A form that can display a secret is a form that leaks it through a
    // screenshot — the stored value is never rendered.
    expect(key.value).toBe('');
    expect(key.type).toBe('password');
  });

  it('tells the operator a stored key will be kept', () => {
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    expect(screen.getByText(/已配置，留空不改/)).toBeTruthy();
  });

  it('warns when no key is configured yet', () => {
    render(<SpeechConfigForm initialConfig={{}} initialHasKey={false} />);
    expect(screen.getByText(/尚未配置/)).toBeTruthy();
  });

  it('sends only the region when the key field is left blank', async () => {
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(updateSpeechConfigRequestMock).toHaveBeenCalled());
    // The blank secret is NOT in the body: the server reads its absence as
    // "unchanged". Sending '' would be read the same way, but not sending it
    // makes the intent explicit.
    expect(updateSpeechConfigRequestMock.mock.calls[0][0]).toEqual({
      'speech.region': 'eastasia',
    });
  });

  it('sends the new key when one is typed, trimmed', async () => {
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    fireEvent.change(screen.getByLabelText(/密钥/), { target: { value: '  new-key  ' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(updateSpeechConfigRequestMock).toHaveBeenCalled());
    // A pasted key often carries a trailing newline; untrimmed it is a 401
    // nobody can explain.
    expect(updateSpeechConfigRequestMock.mock.calls[0][0]).toEqual({
      'speech.region': 'eastasia',
      'speech.key': 'new-key',
    });
  });

  it('clears the key field after a successful save', async () => {
    render(<SpeechConfigForm initialConfig={{}} initialHasKey={false} />);
    fireEvent.change(screen.getByLabelText(/密钥/), { target: { value: 'fresh-key' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(screen.getByText('配置已保存')).toBeTruthy());
    // The key is now stored; leaving it on screen would keep a secret in the
    // DOM for the rest of the session.
    expect((screen.getByLabelText(/密钥/) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/已配置，留空不改/)).toBeTruthy();
  });

  it('shows the server message when the region is refused', async () => {
    updateSpeechConfigRequestMock.mockResolvedValue({
      ok: false,
      error: { code: 'bad_region', message: 'region 只有小写字母（例如 eastasia）' },
    });
    render(<SpeechConfigForm initialConfig={{}} initialHasKey={false} />);
    fireEvent.change(screen.getByLabelText(/区域/), { target: { value: 'https://x' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    // The server owns the rule; the form must show its sentence verbatim
    // rather than invent a second, differently worded one.
    await waitFor(() => expect(screen.getByText(/只有小写字母/)).toBeTruthy());
  });

  it('reports a thrown request as an error instead of hanging on 保存中…', async () => {
    updateSpeechConfigRequestMock.mockRejectedValue(new Error('network down'));
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /保存/ })).toBeTruthy();
  });

  it('offers 测试连接 only when a key is stored', () => {
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey={false} />);
    // With no saved key there is nothing to test, and a disabled button
    // explains less than an explanatory line.
    expect(screen.queryByRole('button', { name: /测试连接/ })).toBeTruthy();
    expect(screen.getByText('保存后才能测试')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /测试连接/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('tests the saved pair and reports success', async () => {
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(verifySpeechConfigRequestMock).toHaveBeenCalled());
    // The test sends no values: it can only check what the server stored.
    expect(verifySpeechConfigRequestMock.mock.calls[0]).toEqual([]);
    await waitFor(() => expect(screen.getByText(/凭据可用/)).toBeTruthy());
  });

  it('shows Azure’s verdict when the credentials are refused', async () => {
    verifySpeechConfigRequestMock.mockResolvedValue({
      ok: true,
      data: {
        ok: false,
        reason: 'auth',
        message: 'Azure 拒绝了这组凭据：region（eastasia）与 key 至少要改一个。',
      },
    });
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    // The route answers 200 for a failed test, so the form must read
    // data.ok, not the HTTP result.
    await waitFor(() => expect(screen.getByText(/至少要改一个/)).toBeTruthy());
  });

  it('clears the previous verdict before a new test', async () => {
    verifySpeechConfigRequestMock.mockResolvedValueOnce({
      ok: true,
      data: { ok: false, reason: 'auth', message: '旧结论' },
    });
    render(<SpeechConfigForm initialConfig={{ 'speech.region': 'eastasia' }} initialHasKey />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.getByText('旧结论')).toBeTruthy());
    // A second click with a slow answer must not leave the old sentence on
    // screen — it belongs to the old pair.
    verifySpeechConfigRequestMock.mockReturnValueOnce(new Promise(() => undefined));
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(screen.queryByText('旧结论')).toBeNull());
  });
});
