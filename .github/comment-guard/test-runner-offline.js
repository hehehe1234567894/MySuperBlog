#!/usr/bin/env node
/**
 * 运行器端到端干跑（**完全离线**，不联网、不动任何真实数据）
 * ===========================================================================
 * 做法：给 runner 注入一个假的 fetchRecent，喂真实形状的事件载荷，看它会怎么判、要执行什么。
 * 为什么这么做：真跑一次就要碰线上 Discussions（主人明确说别乱动），
 * 而 runner 里"解析事件 → 拉上下文 → 跑规则 → 决定动作"这段逻辑完全可以用假上下文覆盖。
 *
 * 用法：node .github/comment-guard/test-runner-offline.js
 */

process.env.COMMENT_GUARD_DRY_RUN = '1';
process.env.GITHUB_TOKEN = 'dry-run-no-token';
process.env.GITHUB_REPOSITORY = 'hehehe1234567894/MySuperBlog';

const runner = require('./runner');

// runner 内部用 fetchRecent 拉最近评论；这里注入假数据（同 discussion 的既有评论）
function fakeRecent(commentsByDiscussion) {
  return async (num) => ({ ok: true, total: (commentsByDiscussion[num] || []).length, recent: commentsByDiscussion[num] || [] });
}

/* 事件载荷：形状与 GitHub 真实 payload 一致（discussion_comment.created） */
function payload({ body, author, num = 5, title = 'posts/c-hello-world/', isComment = true, id = 'DC_dryrun_1' }) {
  if (!isComment) {
    return { action: 'created', discussion: { number: num, title, node_id: id, body, author: { login: author }, html_url: `https://github.com/x/y/discussions/${num}`, created_at: '2026-10-12T10:00:00Z' } };
  }
  return {
    action: 'created',
    discussion: { number: num, title, html_url: `https://github.com/x/y/discussions/${num}` },
    comment: { node_id: id, body, user: { login: author }, html_url: `https://github.com/x/y/discussions/${num}#c`, created_at: '2026-10-12T10:00:00Z' },
  };
}

const CASES = [
  { id: 'R1', note: '普通技术提问 → 应放行', p: payload({ body: '请问端口 21116 需要同时开 TCP 和 UDP 吗？', author: 'reader-a' }), expect: { action: 'none', tier: null } },
  { id: 'R2', note: '典型广告 → 应 delete（dry-run 只打印）', p: payload({ body: '专业代刷数据 加微信 vx888 价格优惠', author: 'spammer' }), expect: { action: 'delete', tier: 'high' } },
  { id: 'R3', note: '首条评论带链接 → 应 minimize（待审）', p: payload({ body: '看我主页 http://t.cn/A6x 有惊喜', author: 'spammer2' }), recent: {}, expect: { action: 'minimize', tier: 'medium' } },
  { id: 'R4', note: '复制粘贴：与既有评论一模一样 → 应命中 copyPaste',
    p: payload({ body: '承接各类软件开发 价格优惠 欢迎咨询 长期有效', author: 'spammer3' }),
    recent: { 5: [{ author: 'other', body: '承接各类软件开发 价格优惠 欢迎咨询 长期有效', createdAt: '2026-10-12T09:00:00Z' }] },
    expect: { action: 'delete', tier: 'high' } },
  { id: 'R5', note: '站主本人（白名单）→ 应跳过', p: payload({ body: '有问题可以加微信找我，号码 boss_here', author: 'hehehe1234567894' }), expect: { skipped: true } },
  { id: 'R6', note: '零宽字符拆关键词 → 应 high', p: payload({ body: '加\u200b微\u200b信\u200b：\u200babc999，另有\u200b好\u200b货', author: 'spammer4' }), expect: { action: 'delete', tier: 'high' } },
  // 目标是"新讨论的正文"而不是评论：规则同样判 delete，但**必须降级成 minimize** ——
  // 删整个讨论会连带删掉底下所有评论，本不该为了抓一条广告付出这个代价。
  { id: 'R7', note: '新讨论正文是广告 → 规则判 high 但只允许 minimize（不删整条讨论）',
    p: payload({ body: '专业代刷数据 加微信 vx888 价格优惠', author: 'spammer5', isComment: false, id: 'D_dryrun_1' }),
    evName: 'discussion', expect: { action: 'minimize', tier: 'high', verdict: 'delete' } },
];

(async () => {
  console.log('\n===== 运行器离线干跑（DRY_RUN=1，不联网）=====\n');
  let pass = 0;
  const fails = [];
  for (const c of CASES) {
    console.log('─'.repeat(88));
    console.log(`# ${c.id} ${c.note}`);
    runner.__setFetchRecentForTest(fakeRecent(c.recent || {}));
    const r = await runner.run({ eventName: c.evName || 'discussion_comment', payload: c.p });
    console.log(`  ⇒ 结论：${r.skipped ? '跳过' : r.action} / ${r.tier || '-'} / 分 ${r.score} / dryRun=${r.dryRun}`);

    const bad = [];
    for (const [k, want] of Object.entries(c.expect)) {
      const got = k === 'tier' ? (r.tier || null) : r[k];
      if (got !== want) bad.push(`${k} 期望 ${JSON.stringify(want)} 实际 ${JSON.stringify(got)}`);
    }
    if (bad.length) { fails.push(`${c.id}: ${bad.join('；')}`); console.log(`  ❌ ${bad.join('；')}`); }
    else { pass++; console.log('  ✅ 符合预期'); }
  }
  console.log('\n' + '─'.repeat(88));
  console.log(`样例 ${CASES.length} 条 ｜ 通过 ${pass} 条 ｜ 失败 ${fails.length} 条`);
  if (fails.length) { fails.forEach((f) => console.log('  ❌ ' + f)); process.exit(1); }
  console.log('✅ 全部符合预期（全部 DRY_RUN，没有任何 mutation 被调用）\n');
})();
