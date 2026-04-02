# /modify 指令与 Docker 环境注入设计

## 背景

当前 HappyClaw 已经支持：

- 工作区级运行绑定：
  - `provider`
  - `mode`
  - `workspace`（宿主机工作目录）
- 工作区级环境变量覆盖：
  - 通过工作区环境变量面板写入 `customEnv`

但仍有两个明显缺口：

1. 用户无法通过对话内指令快速修改当前工作区配置
2. Docker 容器启动时无法从宿主机环境里选择性注入一组系统环境变量

本设计目标是补齐一套最小但一致的能力：

- 新增 `/modify` 指令，修改当前绑定工作区的持久化配置
- 新增项目级 Docker 环境注入配置，只保存“要注入的宿主机环境变量名”
- 在设置页提供宿主机环境变量选择器，支持搜索与勾选

## 目标

- 支持通过 `/modify` 调整当前工作区：
  - `provider`
  - `mode`
  - `workspace`
  - 工作区级环境变量覆盖
- `/modify` 采用持久化修改，不做仅当前进程有效的临时 patch
- 支持项目级 Docker 环境注入
- 设置页支持读取当前宿主机环境变量列表，搜索后勾选要注入到 Docker 的变量
- 注入逻辑在容器启动阶段生效

## 非目标

- 不做“当前正在运行的 Agent 进程内热更新 env”
- 不做工作区级 Docker 默认注入策略
- 不把宿主机环境变量值持久化到配置文件
- 不扩展 `/modify` 去处理模型、thinking 等所有工作区参数（第一期只做用户点名的范围）

## 设计原则

### 1. /modify 只改持久化配置

`/modify` 的行为必须和现有工作区设置保持一致：

- 改动写入工作区元数据或工作区环境配置
- 若容器运行环境发生变化，则触发容器重启 / 重建

这样可以避免引入一套额外的“进程内临时状态”，降低行为分裂。

### 2. Docker 注入环境只保存变量名，不保存变量值

系统设置里只存一份白名单：

```ts
dockerInjectedHostEnvKeys: string[]
```

容器启动时再从当前宿主机 `process.env` 读取对应变量的值并注入到容器。

这样可以避免：

- 将宿主机 secrets 明文写入配置文件
- 配置值与当前宿主机环境脱节

### 3. 工作区级 env 与系统级注入分层

- `/modify --env` / 工作区环境变量面板：
  - 只影响当前工作区
  - 保存到 `data/env/{folder}.json`
- `dockerInjectedHostEnvKeys`：
  - 对所有容器工作区生效
  - 保存到系统设置

## /modify 指令设计

### 指令语法

```text
/modify --help
/modify [--provider claude|openai] [--mode container|host] [--workspace <目录>] [--env KEY=VALUE]... [--unset-env KEY]...
```

示例：

```text
/modify --provider openai
/modify --mode host --workspace /Users/bytedance/code/foo
/modify --env HTTP_PROXY=http://127.0.0.1:7890
/modify --env NO_PROXY=localhost,127.0.0.1
/modify --unset-env HTTP_PROXY
/modify --provider openai --env OPENAI_BASE_URL=https://example.com/v1
```

### 参数含义

- `--provider`
  - 修改当前工作区的 `llm_provider`
- `--mode`
  - 修改当前工作区的执行模式
- `--workspace`
  - 仅在 `host` 模式下有效
  - 表示宿主机工作目录
  - 必须是绝对路径
- `--env KEY=VALUE`
  - 写入当前工作区 `customEnv`
  - 可重复出现多次
- `--unset-env KEY`
  - 从当前工作区 `customEnv` 中移除指定键
  - 可重复出现多次

### 生效对象

`/modify` 始终作用于“当前聊天绑定的工作区主对话”：

- 如果 IM 群绑定的是工作区主对话，则直接修改该工作区
- 如果 IM 群绑定的是工作区下的 conversation agent，则仍修改该 agent 所属工作区

### 校验规则

- 未提供任何有效修改项时，返回帮助
- `--workspace` 仅支持 `host` 模式；如果同时传了 `--mode container`，直接报错
- 切到 `host` 模式时，沿用现有权限约束，仅管理员可用
- `--workspace` 必须为绝对路径
- `--env` 的 key 必须满足现有 env key 校验规则
- `--unset-env` 删除不存在的 key 不视为错误

### 执行结果

- 工作区元数据修改成功后，返回摘要
- 只改工作区级 env 时，重启当前工作区容器
- 改 `provider / mode / workspace` 时，也应触发当前工作区重启，以保证后续运行一致

## Docker 环境注入设计

### 系统设置字段

在 `SystemSettings` 中新增：

```ts
dockerInjectedHostEnvKeys: string[]
```

语义：

- 仅对 Docker 模式工作区生效
- 保存的是宿主机环境变量名
- 容器启动时读取当前进程 `process.env` 中对应 key 的值进行注入

### 容器注入顺序

容器最终环境按以下顺序叠加：

1. 全局 provider 配置
2. 工作区级 provider 覆盖
3. 系统级 `dockerInjectedHostEnvKeys`
4. 工作区级 `customEnv`

规则：

- 后者覆盖前者
- 若 `dockerInjectedHostEnvKeys` 中某个 key 在宿主机不存在，则跳过
- 危险 env key 继续使用现有黑名单阻断

### 适用范围

- 仅 Docker 模式工作区
- Memory Agent 容器可复用同一策略
- Host 模式不做额外注入，因为宿主机进程本身已经继承宿主环境

## 设置页设计

### 入口位置

在 `设置 → 系统参数` 中新增一个独立的“Docker 环境注入”区域。

### 页面能力

- 读取当前宿主机环境变量列表
- 搜索变量名
- 勾选 / 取消勾选要注入的变量
- 保存后写入 `dockerInjectedHostEnvKeys`

### 展示形式

建议每项展示：

- 环境变量名
- 一个简短的值预览（可选，建议截断或只展示前后缀）

### 权限

- 沿用 `manage_system_config`
- 宿主机环境变量读取接口也需要系统配置权限

## 后端设计

### 配置模型

扩展以下位置：

- `src/runtime-config.ts`
- `src/schemas.ts`
- `src/routes/config.ts`

### 新增接口

建议新增：

```text
GET /api/config/host-env
```

返回当前宿主机环境变量列表，例如：

```ts
type HostEnvItem = {
  key: string;
  valuePreview: string | null;
};
```

说明：

- 只返回当前 Node 进程可见的宿主机环境
- 可对明显敏感值做预览截断
- 保存时只存 key，不存 preview

### /modify 实现

建议在 `src/index.ts` 内部直接复用现有逻辑：

- 工作区元数据更新走现有 group patch 语义
- 工作区 env 更新走 `getContainerEnvConfig` / `saveContainerEnvConfig`
- 修改完成后调用 `queue.restartGroup(jid)`

## 前端设计

### 系统设置类型

扩展：

- `web/src/components/settings/types.ts`

新增：

```ts
dockerInjectedHostEnvKeys: string[];

type HostEnvItem = {
  key: string;
  valuePreview: string | null;
};
```

### 系统设置页面

扩展：

- `web/src/components/settings/SystemSettingsSection.tsx`

新增状态：

- 宿主机环境列表
- 搜索关键词
- 已选 key 列表

保存时：

- 将 `dockerInjectedHostEnvKeys` 一并提交到 `/api/config/system`

## 实现顺序

1. 写入系统设置字段 `dockerInjectedHostEnvKeys`
2. 在容器启动阶段接入系统级注入逻辑
3. 新增宿主机环境列表接口
4. 设置页增加 Docker 环境注入 UI
5. `/modify` 指令解析与执行

## 验证要点

- `bun run build`
- `bun run build:web`
- `bun run build:all`
- `/modify --help` 输出正确
- `/modify --provider openai` 能切换当前工作区 provider
- `/modify --mode host --workspace /abs/path` 能切换到宿主模式并保存目录
- `/modify --env KEY=VALUE` 能写入工作区 env 并触发容器重启
- 系统设置中勾选宿主环境变量后，新容器可见对应变量
