# 宿主来源接入统一设计

## 背景

当前 HappyClaw 对宿主环境的接入存在明显偏向：

- Skills 同步只识别 `~/.claude/skills`
- MCP Servers 的宿主同步逻辑与 Skills 分离
- 前端页面没有一套统一的“宿主来源”配置模型

这会导致两个问题：

- 非 Claude 运行环境下的本地资产无法稳定接入
- Skills 和 MCP 都在接“宿主内容”，但产品心智与配置入口是割裂的

本设计目标是引入一套项目级生效的“宿主来源清单”，统一驱动 Skills 和 MCP Servers 的宿主接入。

## 目标

- 为整个项目新增统一的宿主来源配置模型
- 默认支持两个 provider 绑定来源：
  - Anthropic → `~/.claude`
  - OpenAI → `~/.codex`
- 支持用户添加任意自定义来源路径，例如 `~/.agent`
- 每个来源独立控制：
  - 是否启用该来源
  - 是否接入 Skills
  - 是否接入 MCP Servers
- Skills 页面与 MCP Servers 页面共享同一份来源模型与状态展示
- 同步失败不阻断其他来源

## 非目标

- 不做工作区级宿主来源覆盖
- 不做来源拖拽排序
- 不改容器/宿主机运行时对最终 Skills/MCP 产物的消费方式
- 不引入 provider 与自定义来源的复杂优先级策略 UI

## 核心方案

采用清单驱动式设计。项目维护一份“宿主来源清单”，同步器按清单逐项扫描来源，并将扫描结果分别汇总到现有的用户级 Skills 与 MCP 配置落点。

### 来源分类

来源分为两类：

1. `provider-default`
- 系统内置来源
- 绑定固定 provider
- 第一阶段固定两项：
  - `anthropic` → `~/.claude`
  - `openai` → `~/.codex`

2. `custom`
- 用户添加的任意路径
- 不绑定 provider
- 典型示例：`~/.agent`

### 来源配置模型

```ts
type HostIntegrationSource = {
  id: string;
  kind: 'provider-default' | 'custom';
  provider?: 'anthropic' | 'openai';
  label: string;
  path: string;
  enabled: boolean;
  skillsEnabled: boolean;
  mcpEnabled: boolean;
};
```

默认内置来源：

```ts
[
  {
    id: 'anthropic-default',
    kind: 'provider-default',
    provider: 'anthropic',
    label: 'Anthropic',
    path: '~/.claude',
    enabled: true,
    skillsEnabled: true,
    mcpEnabled: true,
  },
  {
    id: 'openai-default',
    kind: 'provider-default',
    provider: 'openai',
    label: 'OpenAI',
    path: '~/.codex',
    enabled: true,
    skillsEnabled: true,
    mcpEnabled: true,
  },
]
```

## 路径解释规则

来源保存的是根目录，不直接保存 `skills` 或 MCP 文件路径。

同步器负责派生子路径：

- Skills 来源目录：`<source.path>/skills`
- MCP 来源文件：第一阶段复用当前宿主 MCP 配置文件约定；扫描器内部统一解析

路径展开规则：

- 支持 `~` 展开到当前运行用户的 home
- 保存时保留用户输入
- 执行同步时再做绝对路径解析

## 同步行为

### 总体原则

- 按来源清单顺序逐项扫描
- 后一个来源覆盖前一个来源的同名项
- 单个来源失败不会中断整体同步

### Skills 同步

- 仅处理 `enabled && skillsEnabled` 的来源
- 扫描 `<path>/skills`
- 将结果同步到现有用户级目录 `data/skills/{userId}`
- 继续复用已有的用户级 Skills 消费链路

### MCP 同步

- 仅处理 `enabled && mcpEnabled` 的来源
- 扫描宿主 MCP 配置文件
- 将结果合并到现有用户级 MCP Servers 配置落点
- 继续复用已有的 MCP 消费链路

## 状态模型

每个来源都需要有状态反馈：

```ts
type HostIntegrationSourceStatus =
  | 'ok'
  | 'missing'
  | 'unreadable'
  | 'invalid';
```

状态定义：

- `ok`：路径存在且成功扫描
- `missing`：路径或目标子路径不存在
- `unreadable`：权限不足或 IO 失败
- `invalid`：配置格式不合法

页面还应展示：

- 最近同步时间
- 最近错误摘要
- Skills/MCP 各自发现的条目数

## 前端设计

### Skills 页面

新增“宿主来源管理”区域：

- 展示所有来源
- 支持新增自定义来源
- 支持删除自定义来源
- 支持切换：
  - 来源总开关
  - Skills 接入
  - MCP 接入
- 支持手动触发同步
- 展示每个来源的同步状态

### MCP Servers 页面

不再维护另一套独立来源配置。

MCP 页面复用同一份宿主来源配置，但在页面中强调 MCP 相关状态，例如：

- 该来源是否启用 MCP 接入
- 最近同步结果
- MCP 发现条目数

### Provider 默认来源的约束

- 允许修改启用状态
- 允许修改 `skillsEnabled` / `mcpEnabled`
- 不允许修改 provider 绑定关系
- 第一阶段不开放修改默认路径，避免把 provider 绑定来源做成普通自定义项

### 自定义来源的约束

- 允许新增、编辑路径、删除
- 不绑定 provider
- 和默认来源一样支持独立开关 Skills/MCP 接入

## 后端设计

### 配置持久化

将宿主来源清单纳入系统设置持久化。

建议新增系统设置字段：

- `hostIntegrationSources`

第一阶段启动时若未配置，则自动回填默认的 `~/.claude` 和 `~/.codex` 两项。

### 共享扫描器

新增共享模块，负责：

- 规范化来源路径
- 解析来源状态
- 扫描 Skills
- 扫描 MCP
- 返回统一结果结构

Skills 与 MCP Routes 都调用这层共享扫描器，避免重复实现。

### API 调整

需要补的接口能力：

- 获取来源清单
- 更新来源清单
- 手动触发宿主来源同步
- 查询来源级同步状态

如果现有 `/api/skills/sync-host` 与 MCP 的 `/sync-host` 已存在，则应逐步收口到统一来源同步语义，避免继续保留“只认 `~/.claude`”的旧接口行为。

## 错误处理

- 来源保存允许路径暂时不存在
- 同步时若路径缺失，仅标记该来源 `missing`
- 不阻断其他来源
- 页面提供明确错误文本与重试入口

## 关联设计

- 冲突仲裁设计：`docs/superpowers/specs/2026-04-02-host-integration-conflict-design.md`

## 测试策略

### 后端

- 默认来源回填测试
- 路径展开与规范化测试
- 来源状态测试：`ok/missing/unreadable/invalid`
- 多来源覆盖测试
- Skills/MCP 独立开关测试

### 前端

- 来源列表增删改测试
- 默认来源展示测试
- Skills/MCP 独立开关交互测试
- 同步状态展示测试

### 冒烟

- 仅启用 `~/.claude`
- 仅启用 `~/.codex`
- 添加 `~/.agent`
- Skills only
- MCP only
- 混合来源覆盖

## 分阶段执行

### Phase 1

- 系统设置新增 `hostIntegrationSources`
- 默认来源回填
- 抽共享扫描器
- Skills 页面接入来源管理与手动同步

### Phase 2

- MCP 页面复用来源管理模型
- MCP 同步改走统一来源清单
- 来源状态与错误展示收口

### Phase 3

- 收口旧的 `sync-host` 概念与文案
- 统一帮助文本与运维说明

## 风险

- Skills 与 MCP 现有“宿主同步”逻辑路径不同，收口时容易出现语义不一致
- 默认 provider 来源与自定义来源覆盖时，若没有清晰文案，用户可能误判最终生效项
- 若允许默认路径被用户任意修改，会削弱 provider 绑定来源的可解释性，因此第一阶段不开放

## 推荐实施结论

按本设计推进：

- 用一份项目级宿主来源清单统一管理宿主接入
- 保持 `~/.claude` / `~/.codex` 作为 provider 默认来源
- 将 `~/.agent` 视为普通自定义来源
- 用来源级独立开关分别控制 Skills 和 MCP 接入
- 复用现有用户级消费链路，仅重构来源发现与同步层
