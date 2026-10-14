#!/usr/bin/env node
/**
 * comment-guard 规则引擎
 * ===========================================================================
 * 职责：吃一条评论（作者 + 正文 + 上下文），吐出「命中哪些规则 / 分数 / 建议动作」。
 * 纯函数、无依赖（只用 Node 标准库），所以可以在 Actions 里直接跑，也能本地测。
 *
 * 归一化策略（这是防绕过的核心，也是误报的主要来源，改之前先想清楚）：
 *   原文            → 直接用于展示
 *   normSep         → 全角转半角、去不可见字符、转小写（保留分隔符）——用于邮箱/链接等"本就有结构"的模式
 *   normCompact     → 在 normSep 基础上去掉所有非字母数字汉字的字符，并把连续重复字符合并
 *                     ——用于「加 V」「加-V」「薇 信」「vxvvx」这类插入分隔符/重复的绕过写法
 *
 * 为什么用 normCompact 而不是"按标点切 token"：切 token 会把「加 V」切成两个 token，
 * 反而匹配不到「加v」。去掉分隔符则能匹配，而误伤风险由**关键词表本身足够具体**来控制
 * （比如 `加v` 这种紧凑串不会在正常中文里出现）。
 *
 * 谐音不在范围内（主人明确要求）：只处理书写变体与字符插入，不做同音字替换。
 */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ 归一化 */

const FULLWIDTH = /[\uFF01-\uFF5E]/g;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD]/g;

function toHalfWidth(s) {
  return s.replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
          .replace(/\u3000/g, ' ');
}

function stripInvisible(s) {
  return s.replace(INVISIBLE, '');
}

/** 归一化：保留结构（分隔符留着），供邮箱/URL 这类模式使用 */
function normSep(s) {
  return stripInvisible(toHalfWidth(String(s || ''))).toLowerCase();
}

/**
 * 紧凑归一化：去掉所有非「字母数字汉字」的字符，并合并连续重复字符。
 *   "加 V"      -> "加v"
 *   "加-V"      -> "加v"
 *   "薇 信"     -> "薇信"
 *   "vxvvx"     -> "vxvx"
 *   "vx: 8 8 8" -> "vx888"
 */
function normCompact(s) {
  return normSep(s).replace(/[^0-9a-z\u4e00-\u9fff]+/g, '').replace(/(.)\1+/g, '$1');
}

/** 纯数字/字母紧凑串（去掉重复字符）：用于"数字字母混写"的号码识别 */
function digitsCompact(s) {
  return normSep(s).replace(/\D+/g, '');
}

/* ------------------------------------------------------------------ 工具 */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 取一段「安全」上下文用于日志（避免把整条广告原样写进日志） */
function mask(s, keep = 12) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= keep * 2 ? t : `${t.slice(0, keep)}…${t.slice(-keep)}`;
}

/** 按「字素簇」数字符个数（emoji、组合字符算 1 个），用于 emoji 占比这类判断 */
function countGraphemes(s) {
  const t = String(s || '').replace(/\s+/g, '');
  if (!t) return 0;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      let n = 0;
      const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
      for (const _ of seg.segment(t)) n++;
      return n;
    }
  } catch (e) { /* 环境不支持就退回码点计数 */ }
  return Array.from(t).length;
}

/** 3-gram Jaccard 相似度（用于"复制粘贴"检测；比编辑距离便宜且够用） */
function similarity(a, b) {
  const grams = (s) => {
    const t = normCompact(s);
    const set = new Set();
    for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
    return set;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/* ------------------------------------------------------------------ 各检查器 */

function checkExplicit(text, cfg) {
  const hits = [];
  const compact = normCompact(text);
  for (const [category, words] of Object.entries(cfg.patterns || {})) {
    for (const w of words) {
      const target = normCompact(w);
      if (target && compact.includes(target)) {
        hits.push({ category, word: w });
      }
    }
  }
  return hits;
}

function checkEvasion(text, cfg) {
  const hits = [];
  const compact = normCompact(text);
  for (const p of cfg.compactPatterns || []) {
    const target = normCompact(p);
    if (target && compact.includes(target)) hits.push({ pattern: p });
  }
  // 上下文规则：关键词单独出现**不算**证据，必须伴随"凭证"（号码或带数字的 ID）
  for (const cp of cfg.contextualPatterns || []) {
    const target = normCompact(cp.pattern);
    if (!target) continue;
    const idx = compact.indexOf(target);
    if (idx < 0) continue;
    if (cp.credential) {
      // 关键词后面跟一段"像账号"的串：含数字、或长度 ≥5 的字母数字混合
      const after = compact.slice(idx + target.length, idx + target.length + 24);
      const looksLikeId = /\d{4,}/.test(after) || /[a-z]{2,}\d|\d[a-z]{2,}/.test(after);
      if (!looksLikeId) continue;
    }
    hits.push({ pattern: cp.pattern, contextual: true });
  }
  return hits;
}

function checkContact(text, cfg) {
  const hits = [];
  const sep = normSep(text);
  for (const [name, re] of Object.entries(cfg.patterns || {})) {
    try {
      if (new RegExp(re, 'i').test(sep)) hits.push({ kind: name });
    } catch (e) { /* 规则写错不该让整条评论崩掉 */ }
  }
  // 裸号码：必须有联系类词共现，避免把正常的数字（版本号/端口）误判成 QQ 号
  const bare = cfg.bareNumberNeedsContext;
  if (bare) {
    try {
      const numOk = new RegExp(bare.numberRegex).test(sep);
      const ctxOk = (bare.contextWords || []).some((w) => sep.includes(normSep(w)));
      if (numOk && ctxOk) hits.push({ kind: 'bareNumberWithContext' });
    } catch (e) {}
  }
  return hits;
}

function checkLinks(text, cfg, ctx) {
  const hits = [];
  const sep = normSep(text);
  const urls = sep.match(/https?:\/\/[^\s<>()"']+/g) || [];
  const bareUrls = sep.match(/(?:^|\s)(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|top|xyz|vip|cc)(?:\/[^\s]*)?/g) || [];
  const all = urls.concat(bareUrls.map((s) => s.trim()));
  if (all.length >= (cfg.maxLinks || 4)) hits.push({ kind: 'tooManyLinks', count: all.length });
  const dom = all.map((u) => u.replace(/^https?:\/\//, ''));
  const shorteners = (cfg.shortenerDomains || []).filter((d) => dom.some((u) => u.startsWith(d) || u.includes(`//${d}`) || u.includes(`.${d}`)));
  if (shorteners.length) hits.push({ kind: 'shortenerDomain', domains: shorteners });
  const shady = (cfg.shadyDomains || []).filter((d) => sep.includes(d));
  if (shady.length) hits.push({ kind: 'shadyDomain', domains: shady });
  if (cfg.firstCommentWithLink && cfg.firstCommentWithLink.enabled && ctx.isFirstComment && all.length > 0) {
    hits.push({ kind: 'firstCommentWithLink' });
  }
  return hits;
}

function checkFlood(text, cfg, ctx) {
  const hits = [];
  const raw = String(text || '');
  // 同一字符连续重复
  const m = raw.match(/(.)\1{2,}/g) || [];
  const worst = m.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (worst.length >= (cfg.repeatThreshold || 8)) hits.push({ kind: 'repeatChars', sample: worst.slice(0, 12), len: worst.length });

  const compact = normCompact(raw);
  if (compact.length > 0 && compact.length < (cfg.minMeaningfulLength || 3)) hits.push({ kind: 'tooShort', len: compact.length });
  if (raw.length > (cfg.maxLength || 4000)) hits.push({ kind: 'tooLong', len: raw.length });

  // emoji 占比
  // 注意：不能拿 emoji 个数 ÷ 字符串长度 —— emoji 在 JS 里占 2 个 UTF-16 码元，
  // 直接除会得到 0.5 这种假比值（第一版就踩了这个，导致纯 emoji 刷屏漏判）。
  // 用 Intl.Segmenter 按「字素簇」数，才是人眼看到的"几个字符"。
  const emojis = raw.match(/\p{Extended_Pictographic}/gu) || [];
  const graphemes = countGraphemes(raw);
  if (emojis.length >= (cfg.emojiMinCount || 8) &&
      graphemes > 0 && emojis.length / graphemes >= (cfg.emojiRatio || 0.8)) {
    hits.push({ kind: 'emojiFlood', count: emojis.length });
  }
  // 全大写长串
  const up = raw.match(/[A-Z]{6,}/g) || [];
  if ((up.join('').length) >= (cfg.uppercaseRunLength || 12)) hits.push({ kind: 'uppercaseRun', len: up.join('').length });

  // 与最近评论高度相似（复制粘贴）
  const sim = cfg.similarity;
  if (sim && sim.enabled && compact.length >= (sim.minLength || 20)) {
    const recent = (ctx.recentComments || []).slice(0, sim.recentCount || 20);
    for (const r of recent) {
      if (!r.body || r.author === ctx.author) continue;   // 不跟自己比
      const s = similarity(raw, r.body);
      if (s >= (sim.threshold || 0.85)) { hits.push({ kind: 'copyPaste', score: Number(s.toFixed(3)), against: mask(r.body, 16) }); break; }
    }
  }
  // 同一用户短时间高频
  const burst = cfg.sameUserBurst;
  if (burst && burst.enabled) {
    const mine = (ctx.recentComments || []).filter((r) => r.author === ctx.author && r.createdAt);
    const win = (burst.windowMinutes || 10) * 60 * 1000;
    const now = ctx.now ? new Date(ctx.now).getTime() : Date.now();
    const inWin = mine.filter((r) => now - new Date(r.createdAt).getTime() <= win);
    if (inWin.length + 1 > (burst.maxInWindow || 5)) hits.push({ kind: 'sameUserBurst', count: inWin.length + 1 });
  }
  return hits;
}

function checkMisc(text, cfg, ctx) {
  const hits = [];
  const inv = String(text || '').match(new RegExp(cfg.invisibleChars, 'g')) || [];
  if (inv.length >= (cfg.invisibleThreshold || 3)) hits.push({ kind: 'invisibleChars', count: inv.length });
  return hits;
}

/* ------------------------------------------------------------------ 主流程 */

const CHECKERS = {
  explicit: checkExplicit,
  evasion: checkEvasion,
  contact: checkContact,
  links: checkLinks,
  flood: checkFlood,
  misc: checkMisc,
};

function tierRank(name, tiers) {
  const order = tiers.map((t) => t.name);
  return order.indexOf(name);
}

function evaluate(text, ctx, cfg) {
  ctx = ctx || {};
  const author = String(ctx.author || '').replace(/^@/, '');
  const result = {
    author,
    score: 0,
    matched: [],        // [{group, detail}]
    tier: null,
    action: 'none',
    skipped: false,
    reason: '',
  };

  // 白名单：站主本人直接跳过（不记录、不打标）
  if ((cfg.whitelist?.users || []).includes(author)) {
    result.skipped = true;
    result.reason = `白名单用户 @${author}`;
    return result;
  }
  // 白名单短语只在白名单用户评论里生效（注释里说明为什么这样做）
  if ((cfg.whitelist?.phrasesForWhitelistedUsersOnly || []).length) {
    const compact = normCompact(text);
    const hasAll = (cfg.whitelist.phrasesForWhitelistedUsersOnly || [])
      .some((p) => compact.includes(normCompact(p)));
    if (hasAll && (cfg.whitelist?.users || []).includes(author)) {
      result.skipped = true;
      result.reason = '白名单短语';
      return result;
    }
  }

  let bestTier = -1;
  for (const [group, gc] of Object.entries(cfg.groups || {})) {
    if (!gc || gc.enabled === false) continue;
    const checker = CHECKERS[group];
    if (!checker) continue;
    let hits = [];
    try { hits = checker(text, gc, ctx) || []; } catch (e) { hits = []; }
    if (!hits.length) continue;

    result.score += gc.weight || 0;
    for (const h of hits) result.matched.push({ group, detail: h, weight: gc.weight || 0, tier: gc.tier });
    const r = tierRank(gc.tier, cfg.tiers);
    if (r > bestTier) bestTier = r;
  }

  // 分数定档
  let byScore = -1;
  for (let i = 0; i < cfg.tiers.length; i++) {
    if (result.score >= cfg.tiers[i].minScore) byScore = i;
  }
  let finalTier = Math.max(byScore, cfg.thresholds?.escalateOnHighTierRule ? bestTier : -1);
  if (finalTier < 0) finalTier = -1;

  if (finalTier >= 0 && result.score >= (cfg.thresholds?.minScoreToReport ?? 1)) {
    const t = cfg.tiers[finalTier];
    result.tier = t.name;
    result.action = t.action;
  }
  return result;
}

/* ------------------------------------------------------------------ CLI */

function loadRules(p) {
  return require(p || path.join(__dirname, 'rules.js'));
}

function main() {
  const argv = process.argv.slice(2);
  const cfgPath = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  const cfg = loadRules(cfgPath);
  // 从 stdin 读 { text, author, ctx } 或 { cases: [...] }
  let input = '';
  try { input = fs.readFileSync(0, 'utf8'); } catch (e) { input = ''; }
  const data = JSON.parse(input || '{}');
  const cases = data.cases || [data];
  const out = cases.map((c) => ({ input: c, result: evaluate(c.text, c.ctx || { author: c.author }, cfg) }));
  process.stdout.write(JSON.stringify(out.length === 1 ? out[0] : out, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { evaluate, normSep, normCompact, similarity, loadRules, mask };
