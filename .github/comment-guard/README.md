# comment-guard —— 评论自动审核

给博客的 giscus 评论做**服务端**审核：广告/拉联系方式/刷屏/零宽字符绕过 → 自动打标、隐藏或删除，
并且**默认只看不动**（DRY_RUN），先跑几天看误报率再启用。

## 为什么要放在 GitHub 侧

本站评论是 **giscus**（GitHub Discussions），渲染在 `giscus.app` 的 **跨域 iframe** 里 ——
前端注入/过滤**做不到**。但评论数据本来就存在本仓库的 Discussions 里，所以在 **Actions**
里审是最干净、且不用改任何前端/主题的落点。

> 老站（Halo）的评论**不动**：境内备案没写社交功能，不新增社交功能。

## 目录

| 文件 | 作用 |
|---|---|
| `.github/workflows/comment-guard.yml` | 触发（`discussion` / `discussion_comment`）+ 权限 + 调用脚本 |
| `.github/comment-guard/rules.js` | **规则集**（改规则只改这个文件） |
| `.github/comment-guard/engine.js` | 规则引擎（归一化 + 各检查器 + 打分定档），无依赖 |
| `.github/comment-guard/runner.js` | 接事件 → 取上下文 → 跑引擎 → 执行动作 → 留痕 |
| `.github/comment-guard/test-rules.js` | 40 条样例的规则回归测试（含"正常但易误伤"的用例） |
| `.github/comment-guard/test-runner-offline.js` | 运行器**离线**端到端干跑（不联网、不动线上） |

## 怎么启用（三步）

1. **合并这个 PR**（只合并就生效，但此时还是 DRY_RUN=1，只记录不动作）。
2. 观察几天：进 **Actions → comment-guard** 看每次运行的日志，或看 **Job Summary**。
   日志会写清「命中哪条规则 / 判成哪一档 / DRY_RUN 下本来要做什么」。
3. 确认误报可接受后，去 **Settings → Secrets and variables → Actions → Variables**
   新建变量 `COMMENT_GUARD_DRY_RUN = 0` → 从此真正执行。

## 动作分级

| 档位 | 分数 | 动作 | 说明 |
|---|---|---|---|
| `low` | ≥1 | **打标签** `comment-guard:low` | 只留痕，不动评论本身 |
| `medium` | ≥20 | **隐藏** `minimizeComment(classifier=SPAM)` | 折叠待审，**可恢复**，不删 |
| `high` | ≥50 | **删除** `deleteDiscussionComment` | 不可恢复 |

- 分数 = 命中规则的权重**累加**。设计成累加而不是"命中即判"，是因为单条特征太容易误伤
  （比如只有个邮箱），**多条同时命中**才更像刷子。
- 命中标了 `tier: high` 的规则时，会无条件升到 high（可在 `rules.js` 的 `thresholds.escalateOnHighTierRule` 关掉）。
- **任何命中都留痕**：Actions 日志 + Job Summary；high 档额外汇总到一个固定标题的 Issue
  （`评论自动审核记录（comment-guard）`），GitHub 会给主人发邮件。
- **不在讨论里公开回复**（避免打草惊蛇 / 误伤场面）——这是刻意的。

## 规则清单（分组 / 权重 / 理由 / 误报风险）

| 组 | 权重 | 档位 | 抓什么 | 理由 | 误报风险 |
|---|---|---|---|---|---|
| `explicit` | 50 | high | 广告、赌博、办证/贷款/代开发票、色情引流，以及"高置信广告语境"（`价格优惠`/`欢迎咨询`/`长期有效`…） | 正常技术讨论里不会出现 | **低** |
| `evasion` | 25 | medium | 字符插空格/符号、重复字符、全角：`加 V`、`加-V`、`薇 信`、`vxvvx`、`ＶＸ` | 刷子最常用的规避手法 | **低-中**（见下） |
| `contact` | 20 | low | 手机号（含 `138 1234 5678` 分隔写法）、QQ、微信 ID、邮箱、Telegram/WhatsApp/Line；裸号码**需共现联系词** | 留联系方式本身不等于广告 | **中**（最容易误伤，单独定档） |
| `links` | 30 | medium | 链接 ≥4 条、短链（`t.cn`/`bit.ly`…）、网盘/图床域名、**首条评论带链接** | 技术博客里贴链接是正常的，所以只对"量"和"可疑域名"下手 | **中** |
| `flood` | 35 | medium | 同字符重复 ≥8、纯 emoji 刷屏、超长粘贴（>4000）、全大写长串、**与最近 20 条高度相似**、**同一用户 10 分钟内 >5 条** | 正常评论不长这样 | **低-中** |
| `misc` | 40 | medium | 零宽/双向控制等**不可见字符** ≥3 个 | 这是**明确的绕过手法**（拆关键词让正则失配） | **极低** |

**白名单**：`hehehe1234567894`（站主）直接跳过，不记录不打标。

### 归一化：为什么能抓"绕过写法"
```
原文              normSep                        normCompact（去分隔符+合并重复）
加 V         →   "加 v"                    →   "加v"
加-V         →   "加-v"                    →   "加v"
薇 信        →   "薇 信"                   →   "薇信"
vxvvx        →   "vxvvx"                   →   "vxvx"
ＶＸ：８８８  →   "vx:888"                  →   "vx888"
加\u200b微\u200b信 → 去不可见字符后 "加微信"  →   "加微信"
```
**谐音不管**（主人明确要求）：只处理**书写变体**（薇信/威信）与**字符插入**，不做同音字替换
（「威芯」这类不判）。

## 误报：实测调过一轮，把两个坑记下来

写规则时用 `test-rules.js` 跑了 40 条样例（含 10 条**正常但故意写得像垃圾**的评论），
抓到两个真实误报并改了档位 —— **不是靠加白名单糊过去的**：

1. **「能加微信吗」被判删除** ❌ → 改法：把 `加微信` 这类**光杆留联系方式**从 `explicit`(high)
   挪到 `evasion`(medium)。现在它只会被**隐藏待审**，人工看一眼就能恢复。
   代价：纯"加微信详聊"这种没有其它词的光杆广告也只到 medium —— 所以又补了一组
   **高置信广告语境词**（`价格优惠`/`欢迎咨询`/`长期有效`…），让"加微信 + 价格优惠"回到 high。
2. **「vx 是啥意思」被判隐藏** ❌ → 改法：`vx`/`扣扣` 单独出现**不再算证据**，
   必须伴随"像账号的串"（连续 4 位以上数字，或字母数字混排）才命中（见 `contextualPatterns`）。
   代价：只写 `vx` 不写号的广告会漏 —— 但那种本来也拦不住，且会进人工视野。

这两条已经固化成测试用例 `T1`–`T4`（带 `assertTier` 档位断言），改动规则时会自动回归。

### 已知的取舍（不打算再调）
- **"加微信"出现在正常中文里时，`normCompact` 不一定命中**：比如「能加个微信吗」去掉分隔符后是
  `能加个微信吗`，而关键词是 `加微信` —— **子串匹配失败**。所以它有时会放行、有时会隐藏。
  这是"宁放勿杀"的刻意选择：漏一条顶多被人看到，错杀一条会劝退正常读者。
- **不判谐音**（按主人要求）。
- **同一用户高频**依赖 GraphQL 拉该 discussion 最近 20 条；拉不到时会**降级跳过这条规则**
  （不会因为 API 抖动把正常评论判成刷屏）。

## 怎么改规则

只改 `.github/comment-guard/rules.js`：

```js
// 加一个广告词（放进对应分组）
ads: ['微商', '你的新词', ...],
// 调阈值
flood: { repeatThreshold: 8, ... },
// 临时关掉某一组
misc: { enabled: false, ... },
// 加白名单用户
whitelist: { users: ['hehehe1234567894', '你的朋友'], ... },
```

**改完必须本地跑一遍回归**（在仓库根目录）：
```bash
node .github/comment-guard/test-rules.js            # 40 条样例，必须"无误报、无漏报、档位全对"
node .github/comment-guard/test-runner-offline.js   # 端到端干跑，确认动作符合预期
```
两个脚本都以退出码表示结果（0=全过），所以也能直接放进 CI。

## 怎么看误报

1. **Actions → comment-guard** 每次运行的日志：`[result] 判定=… 档位=… 分数=…` + 命中明细 + 正文摘要（已截断）。
2. **Job Summary**（每次运行页面底部）有一份同样的摘要。
3. high 档的会进 `评论自动审核记录（comment-guard）` 这个 Issue，GitHub 邮件通知 —— 定向盯这个最省事。
4. DRY_RUN 期间日志里写的是 `would: …`，说明**没有真的动过**评论。

## 怎么临时关掉 / 回滚

| 想做什么 | 怎么做 |
|---|---|
| **立刻停手（不清日志）** | Actions 里 **Disable workflow**（或把 `COMMENT_GUARD_DRY_RUN` 设回 `1`） |
| 只停动作、保留日志 | 变量 `COMMENT_GUARD_DRY_RUN = 1` |
| 放行某个用户 | `rules.js` 的 `whitelist.users` 加用户名 |
| 整条规则不生效 | 对应分组 `enabled: false` |
| **完全回滚** | 删掉 `.github/workflows/comment-guard.yml`（引擎/规则文件留着不影响），或 revert 合并 |
| 恢复被误隐藏的评论 | 在 GitHub 讨论里手动 Unminimize（minimize 是可逆的，**删除不可逆** —— 所以删除只给 high） |

## 权限与安全

- 工作流权限：`contents: read`、`discussions: write`、`issues: write`。
- 用默认的 `GITHUB_TOKEN`，不引入任何第三方 action、不引入 npm 依赖（只用 Node 标准库）。
- 只读事件载荷 + 只调用上面列出的四个 mutation；**不修改 Discussions 分类设置、不动已有讨论**。
