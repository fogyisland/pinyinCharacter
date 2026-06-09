# 字 ↔ 拼音 工具

在线汉字与拼音互转工具。

## 功能（v1 / Plan A）

- 汉字 → 拼音：客户端实时转换，pinyin-pro
- 拼音 → 汉字：两种模式
  - 输入码点选（类似输入法）
  - 整句智能转换（Viterbi + 二元接续）
- 朗读：浏览器内置 TTS
- 儿童模式：默认开启，过滤拼音→字 方向的不适宜内容
- 简/繁切换（占位，Plan C 实现）

## 启动

```bash
pnpm install
pnpm dict:build       # 生成词典文件
pnpm dev              # http://localhost:3000
```

## 测试

```bash
pnpm test             # 一次性
pnpm test:watch       # 监听
```

## 技术栈

- Next.js 15 + TypeScript
- pinyin-pro（客户端字→拼音）
- 内存词典 + Viterbi（服务端拼音→字）
- Tailwind CSS

## 账号系统（v1 / Plan B）

- 注册 / 登录：用户名 + 密码 (≥ 8 位)
- 字↔拼音 转换自动入库历史
- 收藏：历史列表上点 ⭐
- 统计：profile 页看总字数 + 收藏字数
- 审计日志：注册、登录、登出、history 创建/删除入 audit_log 表
- safeMode / 简繁切换仍在客户端

## 环境变量

复制 `.env.example` 为 `.env` 并填入：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✓ | MySQL 连接串，例 `mysql://root:pw@localhost:3306/pinyin` |
| `JWT_SECRET` | ✓ | 32+ 字节随机串，例 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DATABASE_URL_TEST` |   | 集成测试用，缺省时 skip |
| `COOKIE_SECURE` |   | 生产环境设为 `true` 让 cookie 带 Secure 标志 |

## 路线图

- Plan B：用户注册、历史、收藏、统计
- Plan C：简繁真实实现、响应式优化、E2E 测试
