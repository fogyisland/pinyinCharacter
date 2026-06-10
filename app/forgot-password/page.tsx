import { ForgotForm } from './ForgotForm';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <h1 className="text-lg font-semibold">字 ↔ 拼音 工具</h1>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">忘记密码</h2>
          <p className="text-sm text-gray-600 mb-4">输入你的用户名,我们会发送一封重置链接到你的注册邮箱。</p>
          <ForgotForm />
          <p className="text-xs text-gray-500 mt-4">
            想起密码了? <a href="/?auth=login" className="text-blue-600 hover:underline">返回登录</a>
          </p>
        </div>
      </main>
    </div>
  );
}
