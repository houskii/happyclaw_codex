# HappyClaw 测试用例说明

> 基于 vitest 框架，按"故事编号"组织，作为重构安全网——重构前后行为应保持不变。

## 快速运行

```bash
cd happyclaw
npx vitest              # 监听模式
npx vitest run          # 单次执行
npx vitest run units/   # 只跑 units 目录
```

## 测试文件一览

### 渠道 & 路由

| 文件 | 故事 | 用例 | 说明 |
|------|------|------|------|
| `channel-prefixes.test.ts` | D1 | 3 | `CHANNEL_PREFIXES` 常量和 `getChannelFromJid()` 路由，未识别前缀回退到 `web` |
| `units/jid-routing.test.ts` | D1 | 14 | 钉钉/QQ JID 解析（`parseDingTalkChatId` / `parseQQChatId`），覆盖新旧版格式 |

### 消息处理

| 文件 | 故事 | 用例 | 说明 |
|------|------|------|------|
| `units/markdown.test.ts` | D7,A4 | 13 | `markdownToPlainText()` 纯函数，剥离代码块、链接、粗体、标题等 6 种格式 |
| `units/text-chunk.test.ts` | A4 | 8 | `splitTextChunks()` 长消息分片，按段落→换行→空格→硬切优先级拆分 |
| `units/im-dedup.test.ts` | A10 | 8 | `MsgDedupCache` LRU+TTL 去重缓存，验证容量驱逐、TTL 过期、`markSeen` 刷新 |
| `units/im-command-utils.test.ts` | A9 | 17 | `formatContextMessages` / `formatWorkspaceList` / `resolveLocationInfo` / `formatSystemStatus` 四个格式化函数 |

### 隔离 & 安全

| 文件 | 故事 | 用例 | 说明 |
|------|------|------|------|
| `units/user-isolation.test.ts` | D2 | 13 | 用户数据隔离：文件夹隔离、Owner 解析、normalizeHomeJid 路由、Admin vs Member |
| `units/log-sanitize.test.ts` | D7 | 18 | `redactSensitive()` 脱敏 token/password/apiKey 等 9 类字段，`summarizeToolInput()` 截断，`sanitizeFilename()` 清理 |
| `units/group-chat.test.ts` | B1-B6 | 12 | 群聊场景：require_mention 模式、默认模式、回复路由、群间无串扰、生命周期 |

### IPC & 进程管理

| 文件 | 故事 | 用例 | 说明 |
|------|------|------|------|
| `units/ipc-atomic.test.ts` | D3 | 6 | `writeIpcFile()` 原子写入（temp+rename），并发安全，无临时文件残留 |
| `units/oom-idle.test.ts` | D4,D5 | 14 | OOM 退出码检测（code 137）、连续 OOM 计数器（按 folder 隔离）、空闲超时 30min |

### 集成测试

| 文件 | 故事 | 用例 | 说明 |
|------|------|------|------|
| `units/dm-integration.test.ts` | A1-A10 | 15 | 端到端 DM 数据流：文本/图片/文件消息存取、钉钉自动配对、IPC 文件通信、IM 通道生命周期 |

## 统计

- **总用例数**: 141
- **正常路径**: 114 (81%)
- **边界/异常路径**: 27 (19%)

### 异常场景覆盖

| 场景 | 文件 | 典型用例 |
|------|------|---------|
| 容量驱逐 | im-dedup | LRU 满时驱逐最旧条目 |
| TTL 过期 | im-dedup | `vi.useFakeTimers` 模拟时间流逝 |
| 并发写入 | ipc-atomic | 100 次并发写入产生唯一文件名 |
| 临时文件残留 | ipc-atomic | 写入后无 `.tmp` 残留 |
| OOM 误匹配 | oom-idle | `code 1370` 不应匹配 |
| 跨用户串扰 | user-isolation | 用户 B 无法解析用户 A 的群组 owner |
| 日志泄露 | log-sanitize | API key 在 summary 中不泄露 |
| 深度嵌套截断 | log-sanitize | 深度 >3 截断为 `[truncated]` |

## 辅助工具

```
helpers/
├── im-utils.ts       # 生产代码纯函数副本，避免导入有副作用的模块
├── mock-im.ts        # Mock IM 通道，记录 sendMessage/sendFile/sendImage 调用
├── mock-db.ts        # 内存数据库，无 SQLite 依赖
├── mock-ipc.ts       # 基于临时目录的 IPC 文件系统模拟
└── test-context.ts   # 组合以上三个 mock 的统一测试上下文工厂
```

### mock-im 关键 API

- `simulateMessage(text, opts)` — 模拟收到消息
- `state.sentMessages` — 断言已发送消息
- `state.connected` — 连接状态

### mock-db 关键 API

- `storeMessageDirect()` / `getMessagesForChat()` — 消息存取
- `registerGroup()` / `getJidsByFolder()` — 群组注册和查询
- `clear()` — 重置所有数据

### mock-ipc 关键 API

- `writeAgentMessage(data)` — 模拟 Agent 写入消息文件
- `writeInputMessage(text)` — 模拟主进程注入消息
- `readAllMessages()` — 读取全部消息文件

### test-context 关键 API

- `registerGroup(opts)` — 快捷注册聊天群组
- `simulateIncomingMessage(text, opts)` — 快捷模拟收到 IM 消息
- 默认使用 `dingtalk` 渠道
