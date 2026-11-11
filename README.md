# 会话状态看板 · dsh-session-hud

[English](#english) | 中文

一个 DeepSeek Harness 插件：在 **Web UI 右上角**浮出一个状态看板，显示当前有几个会话在跑、几个在等你、共完成了几轮；会话完成会提醒，**打开那个会话提醒就消失**。

```
┌─ ● 1 进行中   ✓ 2 已完成 ─┐        ← 胶囊（可拖动、可点击）
└──────────────────────────┘
   ↓ 点开
┌ 会话状态 ────────── 打开会话即视为已读 ┐
│ 进行中 · 1                              │
│   ● ai 5c77              执行工具       │
│ 已完成 · 2                              │
│   ✓ salesplan 75a1       15:21          │
│   ✓ shipping-plan bb6e   15:19          │
│ 累计完成 · 76                           │
└─────────────────────────────────────────┘
```

## 功能

| 能力 | 说明 |
|---|---|
| 进行中 / 等待确认 | 会话 agent 是否在跑、是否在等你回答或审批 |
| 已完成提醒 | 后台会话结束一轮就提醒；**你正看着的会话结束时不打扰** |
| 打开即已读 | 在左侧点开某条会话，它的提醒立刻消失，无需「全部已读」 |
| 常驻胶囊 | 空闲时显示「空闲」，不会整块消失；只有提醒是可消失的 |
| 可拖动 | 按住胶囊或面板标题拖动，位置写进浏览器本地存储 |
| 点外面收起 | 点面板外任意位置或按 `Esc` 收起 |
| 累计完成 | 每结束一轮 +1，**跨 harness 重启累加**（持久化在 `$DSH_HOME/state/dsh-session-hud.json`） |
| 会话消歧 | 自动补 4 位会话号，同工作目录下的多个会话也能区分 |
| 主题跟随 | 只用 `--dsw-alias-*` 主题 token，浅色/深色自动适配 |

## 安装

插件以 **bundle** 形式发布（`dsh.bundle.patch` + `dsh.client`），支持两种安装方式。

**1）插件市场 / 插件管理器**（若索引已收录）：在 设置 → 插件 中搜索 `dsh-session-hud` 安装。

**2）直接从 GitHub 装到当前 profile**：

```bash
dsh plugin --profile <profile> add github:summervvorm/dsh-session-hud
```

或在本仓库用 DSH 的插件管理器安装（它会写 profile 的 `package.json` 与 bundle 列表）：

```text
plugin_manager: install_bundle, target = <本仓库绝对路径>
```

安装后 `cordis.patch.yml` 会插入一行 `dsh-session-hud`，Web UI 加载其客户端半个插件。

## 运行时要求

- DeepSeek Harness `>=0.2.1-rc.5`（`engines.dsh`），Node `>=22`
- Web UI（`platform: web`）且组合中存在 `webServer` 服务
- 不需要任何配置（插件没有 `Config`）

## 数据与控制

Host 半边折叠 `session/event`（`turn/start`、`tool/call`、`tool/result`、`approval/*`、`turn/end`）与 `session/disposed`，客户端半边订阅一次性快照流。

所有端点都只接受本机同源请求（`127.0.0.1` / `localhost`）：

| 端点 | 用途 |
|---|---|
| `GET /plugins/dsh-session-hud/events` | SSE 快照流（插件自身的唯一数据通道） |
| `GET /plugins/dsh-session-hud/state` | 一次性 JSON 快照，便于排障：`counts`、`sessions`、`completions`、`watchers` |
| `POST /plugins/dsh-session-hud/active` | 页面上报当前会话 / 诊断信息 |

浏览器侧状态（已读、位置）保存在 `localStorage`：
`dsh-session-hud:position:v1`、`dsh-session-hud:dismissed:v1`。
已读按「会话 + 完成序号」记录，所以同一个会话再次完成会重新提醒。

## 架构

```text
session/event ──▶ Host: createTracker（每会话状态机 + 完成计数，持久化）
                        │
                        ▼
                  hub.publish ──▶ SSE /events ──▶ Client: shell.overlay 面板
                        ▲
                        └── session 槽位探针（conversation.composer.dock）──▶ 打开即已读
```

- Host 注册在非 scoped 的 root 事件总线上（Loader entry 可能位于 scoped 组合内），并保证任何异常都不会向上冒泡污染共享事件总线。
- Client 注册在 `shell.overlay`（frame-wide 浮层），只用主题 token 着色；渲染容器定宽，展开/收起不会移动胶囊。
- 会话号来自 `session/composer.dock` 这个 session-scoped 槽位的 `sessionId` prop —— 它反映的正是「当前可见会话」。

## 兼容性

- 只用公开 API：`session/event`、`session/disposed`、`webServer.register`、`slots.inject/register`、`locale.register/bind`、`localStorage`。
- 没有任何 Harness Client 包的模块依赖（不 `require` `@deepseek-ai/dsh-client-ui-*`），升版不会因为内部包改名而崩溃。
- 显示资源齐全：`locale/{zh,en}.json`（含 `meta.detail`）+ 原创 `icon.svg`。

## 开发

```
index.js         Host 半边：事件折叠、快照、SSE 与本地端点
client.js        Client 半边：`window.__ModuleLoader__` 工厂 + React 面板
cordis.patch.yml bundle 插入行
locale/*.json    显示元数据（title / description / detail）
icon.svg         插件图标
docs/market-entry.json  插件市场索引条目（提交用）
```

没有构建步骤：`client.js` 就是浏览器直接执行的 bundle，`index.js` 是原生 ESM。

---

# English

**dsh-session-hud** is a DeepSeek Harness plugin that floats a session-status panel in the top-right corner of the Web UI: how many sessions are running, how many wait for you, and how many turns have finished.

- **Completion alerts clear when you look.** Opening a session in the sidebar marks its alert read immediately — there is no "mark all read".
- **Only background sessions alert.** A session you are already watching never pops a notification at you.
- **Resident pill, dismissible alerts.** Idle shows `空闲`/`idle`; only the alerts disappear after being read.
- **Draggable, remembered, dismissible.** Drag by the pill or the panel title; click outside or press `Escape` to collapse.
- **Cumulative count survives restarts** (`$DSH_HOME/state/dsh-session-hud.json`).
- **Theme-native.** Only `--dsw-alias-*` tokens; light and dark both work.

Install with `dsh plugin --profile <profile> add github:summervvorm/dsh-session-hud`, or install this directory through the plugin manager. Requires DeepSeek Harness `>=0.2.1-rc.5`, Node `>=22`, the Web UI and a `webServer` service. No configuration.

Endpoints (local same-origin only): `GET /plugins/dsh-session-hud/events` (SSE), `GET /plugins/dsh-session-hud/state` (one-shot snapshot), `POST /plugins/dsh-session-hud/active`.

## License

MIT © 2026 summervvorm
