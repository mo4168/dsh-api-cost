# API 花费（dsh-api-cost）

给 DeepSeek Harness 的本机 API 花费计。它不查余额、不依赖账号令牌，只做一件事：
**把本机会话日志里每一次模型调用真实的 `usage` 折成 token，再乘以你给的单价，得到「本机 API-key 花了多少钱」**。

适合在「一个大 API 下分发的子 API / 中转站 key」上使用：这类 key 往往没有可查询的余额或账单接口，
或者价格不等于官方牌价。插件把「倍率」和「逐模型单价」都交给用户自己填。

## 界面

会话输入框下方会多出一行：

```
¥  API 花费  今日 ¥0.28 · 1.24M tokens   ▸
```

点开后是账本：

- **概览**：今日 / 近 7 天 / 近 30 天 / 累计，以及按模型（provider/model）拆分的 token 与金额。
- **单价**：倍率，以及每个模型的「缓存命中 / 输入 / 输出」单价（人民币 / 百万 token）。
  - 内置价目是 DeepSeek 官方标准价（Flash：命中 0.04、未命中 2、输出 8，单位元/百万 token；Pro：0.3 / 9 / 27）。
  - 子 API 若按官方价打折，只改「倍率」即可；若价格完全不同，直接改单价。
  - 改价是**追溯生效**的：账本只存 token，金额每次按当前价目重算。

## 数据从哪里来

- 启动时用 `sessionQuery` 回放本机全部会话日志，只取 `assistant/message` 事件的 `usage`
  （`inputTokens` / `cacheReadTokens` / `outputTokens`），并按 `seq` 去重；fork 继承来的事件不计入。
- 运行中监听 `session/event`，每完成一步模型调用立即累计。
- 子智能体是独立会话，照常计入；跨天按本机时区切分。
- 口径：`tokens = input + cacheRead + output`，`reasoningTokens` 已包含在 `output` 内，不再重复计费。
  未配置单价的模型只统计 token（界面标「未定价」），不会静默按 0 元计价。

## 数据文件与接口

- 账本：`$DSH_HOME/.dsh-api-cost.json`（默认 `C:\Users\<你>\.dsh\.dsh-api-cost.json`）。
  只存按天/按模型的累计 token、已扫描会话的序号与你的价目，**不存任何 API key**。
- 只读接口：`GET /dsh-cost-meter/snapshot`
- 保存价目：`POST /dsh-cost-meter/prices`（JSON：`{ currency, multiplier, prices: { "<provider>/<model>": { input, cacheRead, output } | null } }`）
- 两个接口都只接受回环地址、同源请求，并复用 `connection.requestRejection` 的信任栅栏。

## 安装

这个包本身就是一个标准 DSH bundle（`package.json` 里的 `dsh.bundle.patch` + `dsh.client`）。
DSH 的「插件 → 添加插件」走 `pluginManager.installBundle(spec)`，接受的 spec 有四种：

| spec 形态 | 例子 | 安装结果 |
|---|---|---|
| registry 包名 | `dsh-api-cost` / `@you/dsh-api-cost` | 从 npm 源安装到 profile |
| git 地址 | `https://github.com/<你>/dsh-api-cost`、`github:<你>/dsh-api-cost#main` | 从仓库安装 |
| 本地绝对路径 | `D:\dsh-plugins\dsh-api-cost` | **link** 到该目录（目录不能删/移） |
| tarball | `D:\dsh-plugins\dsh-api-cost-1.0.0.tgz` | 复制进 profile（便携，可删原包） |

也可以在命令行装（`dsh plugin --profile <profile> add <spec>`），或用本会话里的 `plugin_manager`。
装好后刷新页面，输入框下方即出现入口。

### 迁移到另一台电脑

**最快：拷目录 + 本地路径安装**

1. 把整个 `dsh-api-cost` 目录复制到目标机，例如 `D:\dsh-plugins\dsh-api-cost`；
2. 目标机：插件 → 添加插件，粘贴 `D:\dsh-plugins\dsh-api-cost`，安装；
3. 刷新页面。

**推荐：用 tarball（不依赖原目录）**

把 `dsh-api-cost-1.0.0.tgz` 拷过去，在「添加插件」里粘贴它的绝对路径，或：

```powershell
dsh plugin --profile desktop add "D:\dsh-plugins\dsh-api-cost-1.0.0.tgz"
```

也支持 zip：解压后按「拷目录」的方式装。

**GitHub（可长期更新）**

```powershell
cd dsh-api-cost
git init -b main
git add .
git commit -m "dsh-api-cost 1.0.0"
git remote add origin https://github.com/mo4168/dsh-api-cost.git
git push -u origin main
```

目标机粘贴 `https://github.com/mo4168/dsh-api-cost`（或 `github:mo4168/dsh-api-cost#main`）。
私有仓库需要在目标机配好 git / pnpm 凭据。

**npm（只用包名）**

```powershell
cd dsh-api-cost
npm publish --access public
```

目标机粘贴 `dsh-api-cost` 即可，后续升级只要 `npm version patch && npm publish`。

**改用 scope（防抢注）时注意改两处**

把 `package.json` 的 `name` 改成 `@你的用户名/dsh-api-cost` 之后，`cordis.patch.yml` 里插入行的 `name`
也必须改成同一个名字——否则包装得上，但那一行解析不到模块，插件永远不会激活：

```json
"name": "@你的用户名/dsh-api-cost"
```

```yaml
- insert:
    - id: api-cost-meter
      name: '@你的用户名/dsh-api-cost'
```

发布前自检已经内置：`npm publish` 会跑 `scripts/check-bundle-name.mjs`，两处不一致会直接报错退出。
安装时粘贴的是**带 scope 的完整包名** `@你的用户名/dsh-api-cost`，只写 `dsh-api-cost` 会去找无 scope
的同名包（那是另一个包，通常不存在）。

### 账本不随插件走

每台机器各记各的：`$DSH_HOME/.dsh-api-cost.json`。想把历史带过去，就把这个文件复制到目标机同一路径
（会**覆盖**目标机已有账本，先备份）。

### 版本要求

`package.json` 声明了 `engines.dsh: ">=0.1.5"`；目标机 DSH 太旧会被安装器直接拒绝，而不是装上后崩。

### 出现在「插件市场」里（可选）

市场只是索引，不是安装入口：DSH 0.2.1+ 的「插件 → 发现」读取 format-1 index JSON，条目里给出
npm 包或 git commit 作为 source。官方目录是 `awesome-dsh-plugin` 仓库，向它提一个 PR 就能被市场收录；
也可以自建 `index.json`，在「设置 → 插件 → 发现 → 索引源」里添加自己的源。没有发布到任何市场时，
用上面的「本地路径 / tarball / GitHub / 包名」四种方式安装即可。

## 已知边界

- 只统计本机 DSH 会话产生的用量；同一 key 在别的机器/别的工具上的消耗不在此列。
- 失败的请求若上游没有返回 usage，就不计入（通常也未必计费）。
- 金额是**估算**：以 DSH 记录到的 usage × 你填的单价为准，不是中转站的对账单。
