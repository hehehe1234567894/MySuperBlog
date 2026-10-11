#!/usr/bin/env node
/**
 * comment-guard 运行器：接 GitHub 事件 → 跑规则 → 按档位动作 → 留痕
 * ===========================================================================
 * 设计要点（都是踩过或想清楚才这么写的）：
 *
 * 1. **DRY_RUN 默认 1**：只打印"我本来要做什么"，不调任何 mutation。
 *    先跑几天看日志，确认误报率可接受，再把仓库变量 `COMMENT_GUARD_DRY_RUN` 设成 0。
 *
 * 2. **动作幂等 + 降噪**：只有 medium/high 才动 GitHub；low 只打 label 和日志。
 *    high 不"先 minimize 再 delete"，直接 delete（少一次无效 API 调用）。
 *
 * 3. **要读上下文才能判的两条**（复制粘贴、同一用户短时间高频）需要最近评论：
 *    用 GraphQL 拉该 discussion 最近 20 条 —— 事件载荷里没有这些。
 *    拉不到（权限/网络）就**降级为只跑正文规则**，不让整条流程失败。
 *
 * 4. **不在讨论里公开回复**（主人要求）：避免打草惊蛇 / 误伤场面。
 *    留痕走 Actions 日志 + Job Summary；high 档额外汇总到一个 Issue（GitHub 会邮件通知）。
 *
 * 5. 支持本地干跑：`node runner.js --event <payload.json> [--dry-run=1]`
 *    payload 就是 GitHub 事件 JSON，所以不用真发事件也能端到端验证。
 */

const fs = require('fs');
const path = require('path');
const { evaluate, loadRules } = require('./engine');

const API = 'https://api.github.com';

/* ------------------------------------------------------------------ 基础 */

function env(name, dflt = '') {
  return process.env[name] !== undefined && process.env[name] !== '' ? process.env[name] : dflt;
}

const DRY_RUN = env('COMMENT_GUARD_DRY_RUN', '1') !== '0';
const TOKEN = env('GITHUB_TOKEN');
const REPO = env('GITHUB_REPOSITORY');                 // owner/name
const [OWNER, NAME] = REPO.split('/');

async function gql(query, variables) {
  const r = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'comment-guard' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error('GraphQL: ' + JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

async function rest(method, p, body) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'comment-guard',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = { raw: text.slice(0, 200) }; }
  return { status: r.status, body: j };
}

/* ------------------------------------------------------------------ 取上下文 */

/** 从事件载荷里抽出我们关心的字段 */
function parseEvent(eventName, payload) {
  const c = payload.comment || (payload.discussion && payload.discussion.comment) || null;
  const d = payload.discussion || {};
  return {
    eventName,
    action: payload.action || '',
    // discussion_comment 事件的评论在 payload.comment；discussion 事件的正文在 payload.discussion.body
    kind: c ? 'comment' : 'discussion',
    id: c ? c.node_id : d.node_id,
    body: c ? (c.body || '') : (d.body || ''),
    author: (c ? c.user?.login : d.author?.login) || (c ? c.user?.login : '') || '',
    discussionNumber: d.number,
    discussionTitle: d.title || '',
    url: c ? c.html_url : d.html_url,
    createdAt: c ? c.created_at : d.created_at,
  };
}

/** 拉该 discussion 的最近评论，供"复制粘贴 / 短时间高频"两条规则用 */
let fetchRecentImpl = null;   // 测试注入点（见 test-runner-offline.js）
async function fetchRecent(discussionNumber, limit = 20) {
  if (fetchRecentImpl) return fetchRecentImpl(discussionNumber, limit);
  if (!discussionNumber) return { recent: [], ok: false };
  try {
    const data = await gql(
      `query($owner:String!,$name:String!,$num:Int!,$limit:Int!){
         repository(owner:$owner,name:$name){
           discussion(number:$num){
             comments(last:$limit){ totalCount nodes{ body author{login} createdAt } }
           }
         }
       }`,
      { owner: OWNER, name: NAME, num: discussionNumber, limit }
    );
    const nodes = data.repository.discussion.comments.nodes || [];
    return {
      ok: true,
      total: data.repository.discussion.comments.totalCount,
      recent: nodes.map((n) => ({ body: n.body, author: n.author?.login, createdAt: n.createdAt })),
    };
  } catch (e) {
    return { recent: [], ok: false, error: String(e.message).slice(0, 200) };
  }
}

/* ------------------------------------------------------------------ 动作 */

async function ensureLabel(name, color) {
  if (DRY_RUN) return { dry: true };
  const got = await rest('GET', `/repos/${REPO}/labels/${encodeURIComponent(name)}`);
  if (got.status === 200) return { exists: true };
  return rest('POST', `/repos/${REPO}/labels`, { name, color, description: 'comment-guard 自动打标' });
}

/** 打标真正需要的两步：先拿 label 的 node id，再 addLabelsToLabelable */
async function addLabel(subjectId, labelName, color) {
  await ensureLabel(labelName, color);
  if (DRY_RUN) return { dry: true, would: `addLabelsToLabelable(id=${subjectId}, label=${labelName})` };
  try {
    const q = await gql(
      `query($owner:String!,$name:String!,$label:String!){
         repository(owner:$owner,name:$name){ label(name:$label){ id } }
       }`, { owner: OWNER, name: NAME, label: labelName });
    const labelId = q.repository.label?.id;
    if (!labelId) return { error: 'label not found after create' };
    await gql(
      `mutation($id:ID!,$labels:[ID!]!){
         addLabelsToLabelable(input:{labelableId:$id, labelIds:$labels}){ clientMutationId }
       }`, { id: subjectId, labels: [labelId] });
    return { ok: true };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

async function minimize(subjectId) {
  if (DRY_RUN) return { dry: true, would: `minimizeComment(id=${subjectId}, classifier=SPAM)` };
  try {
    await gql(
      `mutation($id:ID!,$c:ReportedContentClassifiers!){
         minimizeComment(input:{subjectId:$id, classifier:$c}){ minimizedComment{ isMinimized } }
       }`, { id: subjectId, c: cfg.actions.minimizeClassifier || 'SPAM' });
    return { ok: true };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

async function del(subjectId) {
  if (DRY_RUN) return { dry: true, would: `deleteDiscussionComment(id=${subjectId})` };
  try {
    await gql(`mutation($id:ID!){ deleteDiscussionComment(input:{id:$id}){ clientMutationId } }`, { id: subjectId });
    return { ok: true };
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

/** high 档留痕：汇总到一个固定标题的 Issue（避免刷屏式建 issue） */
async function recordToIssue(line) {
  const title = cfg.actions.summaryIssueTitle;
  if (DRY_RUN) return { dry: true, would: `comment on issue "${title}"` };
  try {
    const found = await rest('GET', `/repos/${REPO}/issues?state=open&per_page=100`);
    const issue = Array.isArray(found.body)
      ? found.body.find((i) => i.title === title && !i.pull_request) : null;
    if (issue) return rest('POST', `/repos/${REPO}/issues/${issue.number}/comments`, { body: line });
    return rest('POST', `/repos/${REPO}/issues`, {
      title, body: 'comment-guard 自动审核记录（只记 high 档）。\n\n' + line,
      labels: [cfg.actions.labels.high],
    });
  } catch (e) { return { error: String(e.message).slice(0, 200) }; }
}

/* ------------------------------------------------------------------ 主流程 */

const cfg = loadRules();

function summaryLine(ev, res, actResult) {
  const hits = res.matched.map((m) => `${m.group}:${m.detail.word || m.detail.pattern || m.detail.kind || ''}`).join(', ');
  return [
    `- **${res.tier}** / \`${res.action}\` / 分 ${res.score}`,
    `  - 讨论：${ev.discussionTitle || '(未知)'} #${ev.discussionNumber || '?'}`,
    `  - 作者：@${ev.author}`,
    `  - 命中：${hits}`,
    `  - 执行：${actResult?.dry ? 'DRY_RUN（未执行） ' + actResult.would : JSON.stringify(actResult).slice(0, 160)}`,
    ev.url ? `  - 链接：${ev.url}` : '',
  ].filter(Boolean).join('\n');
}

async function run({ eventName, payload, dryOverride }) {
  const ev = parseEvent(eventName, payload);
  const log = (...a) => console.log(...a);

  log(`[comment-guard] 事件=${ev.eventName} action=${ev.action} 类型=${ev.kind} 作者=@${ev.author} DRY_RUN=${dryOverride ?? DRY_RUN ? '1' : '0'}`);

  if (!ev.body || !ev.author) { log('[skip] 没有正文或作者（删除事件/空评论）'); return { skipped: true }; }
  if (ev.action && !['created', 'edited'].includes(ev.action)) { log(`[skip] action=${ev.action} 不处理`); return { skipped: true }; }

  const recent = await fetchRecent(ev.discussionNumber);
  if (!recent.ok) log(`[warn] 拉不到最近评论（${recent.error || '未知'}）→ 复制粘贴/高频两条规则降级跳过`);

  // 是不是该 discussion 的第一条评论（"首条带链接先隐藏"用）
  const isFirstComment = ev.kind === 'comment' && recent.ok && (recent.total || 0) <= 1;

  const ctx = {
    author: ev.author,
    recentComments: recent.recent || [],
    isFirstComment,
    now: ev.createdAt || new Date().toISOString(),
  };

  const res = evaluate(ev.body, ctx, cfg);
  log(`[result] 判定=${res.skipped ? '跳过' : res.action} 档位=${res.tier || '-'} 分数=${res.score}`);
  if (res.skipped) log(`        原因：${res.reason}`);
  if (res.matched.length) {
    for (const m of res.matched) log(`        命中 ${m.group}: ${m.detail.word || m.detail.pattern || m.detail.kind || JSON.stringify(m.detail)}`);
    log(`        正文摘要：${require('./engine').mask(ev.body, 30)}`);
  }

  const actions = { label: null, minimize: null, delete: null };
  if (res.action === 'label') actions.label = await addLabel(ev.id, cfg.actions.labels.low, 'fbca04');
  if (res.action === 'minimize') actions.minimize = await minimize(ev.id);
  if (res.action === 'delete') actions.delete = await del(ev.id);

  // 留痕
  const summary = summaryLine(ev, res, actions.delete || actions.minimize || actions.label);
  try {
    const sf = env('GITHUB_STEP_SUMMARY');
    if (sf) fs.appendFileSync(sf, `\n### comment-guard\n${summary}\n`);
  } catch (e) {}
  if (res.action === 'delete') {
    const rec = await recordToIssue(summary);
    log(`[trace] 汇总到 Issue：${JSON.stringify(rec).slice(0, 200)}`);
  }

  // 给工作流用的结论（非 0 退出会让人误以为失败，所以永远 0；是否拦截看 action 字段）
  const out = { skipped: res.skipped, tier: res.tier, action: res.action, score: res.score, dryRun: !!DRY_RUN };
  log('[done] ' + JSON.stringify(out));
  return out;
}

/* ------------------------------------------------------------------ CLI */

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k, d = null) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : d;
  };
  const eventPath = getArg('--event');
  const eventName = getArg('--event-name', env('GITHUB_EVENT_NAME', 'discussion_comment'));
  const payload = eventPath ? JSON.parse(fs.readFileSync(eventPath, 'utf8'))
                            : JSON.parse(env('GITHUB_EVENT_PAYLOAD_JSON', '{}'));
  const dryOverride = getArg('--dry-run', null);
  await run({ eventName, payload, dryOverride: dryOverride === null ? undefined : dryOverride !== '0' });
}

if (require.main === module) {
  main().catch((e) => { console.error('[fatal]', e); process.exit(1); });
}

module.exports = {
  run, parseEvent, evaluate,
  // 仅供离线测试注入：替换"拉最近评论"这一步，避免测试时碰线上数据
  __setFetchRecentForTest(fn) { fetchRecentImpl = fn; },
};
