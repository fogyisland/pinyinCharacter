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

## 路线图

- Plan B：用户注册、历史、收藏、统计
- Plan C：简繁真实实现、响应式优化、E2E 测试
