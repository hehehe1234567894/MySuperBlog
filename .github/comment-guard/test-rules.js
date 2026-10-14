#!/usr/bin/env node
/**
 * 规则引擎的本地测试：跑一批样例评论，打印「命中哪条 / 判成哪一档 / 会执行什么动作」。
 *
 * 用法：node .github/comment-guard/test-rules.js
 *
 * 样例里**故意放了 6 条正常但容易被误伤的评论**（标 EXPECT: none），
 * 用来暴露误报 —— 如果它们被判成 spam，说明规则太激进，要回去调阈值/上下文，而不是加白名单糊过去。
 */

const { evaluate, loadRules } = require('./engine');

const cfg = loadRules();

// EXPECT: none=应当放行 / any=应当命中（档位见 note）
const CASES = [
  /* ---------- 正常交流（不应命中） ---------- */
  { id: 'N1', expect: 'none', note: '普通感谢', author: 'some-dev', text: '写得很清楚，谢谢！' },
  { id: 'N2', expect: 'none', note: '技术提问', author: 'reader-a', text: '请问 systemd 那段里 Restart=on-failure 和 always 有啥区别？' },
  { id: 'N3', expect: 'none', note: '报告笔误', author: 'reader-b', text: '第二节的端口写错了吧，21116 是 TCP+UDP，你只写了 TCP。' },
  { id: 'N4', expect: 'none', note: '贴代码片段（无链接）', author: 'reader-c', text: '我这边是这样写的：docker run -d --net=host rustdesk/rustdesk-server hbbs -r 1.2.3.4:21117' },
  { id: 'N5', expect: 'none', note: '正常引用 GitHub 链接（1 条）', author: 'reader-d', text: '参考 https://github.com/rustdesk/rustdesk-server 这个仓库的说明，按你说的确实要加 -r。' },

  /* ---------- 正常但容易被误伤（重点观察） ---------- */
  { id: 'F1', expect: 'none', note: '⚠️ 正常问"能加个微信吗"——有"加微信"关键词', author: 'reader-e', text: '博主能加个微信吗？想请教一下单片机的问题' },
  { id: 'F2', expect: 'none', note: '⚠️ 正常问"链接能发一下吗"', author: 'reader-f', text: '文里那个工具下载链接能发一下吗，我找不到了' },
  { id: 'F3', expect: 'none', note: '⚠️ "这代码我复制了"——含"复制"', author: 'reader-g', text: '这代码我复制了，跑通了，感谢！' },
  { id: 'F4', expect: 'none', note: '⚠️ 正常提到手机号格式（在讲正则）', author: 'reader-h', text: '手机号正则一般写 1[3-9]\\d{9}，但要注意虚拟号段。' },
  { id: 'F5', expect: 'none', note: '⚠️ 正常的 emoji 感谢（少量 emoji）', author: 'reader-i', text: '太强了 👍👍🙏' },
  { id: 'F6', expect: 'none', note: '⚠️ 正常讨论 QQ 群号长度/端口等数字', author: 'reader-j', text: '这个端口 21115 到 21119 都要开吗？' },

  /* ---------- 广告 / 违规（应命中） ---------- */
  /* 这两条是**调档位时踩出来的真实误报**，特意固化下来防回归：
   * 光杆"能加微信吗"是正常搭话 → 只隐藏待审(minimize)，**不能删除**；
   * 但"加微信 + 价格优惠"是广告 → 必须 high(delete)。 */
  { id: 'T1', expect: 'any', note: '光杆"能加微信吗"：正常搭话 → 只应 minimize，不能 delete',
    author: 'reader-k', text: '能加微信吗', assertTier: 'medium' },
  { id: 'T2', expect: 'any', note: '"加微信 + 价格优惠"：光杆广告 → high(delete)',
    author: 'spam-x', text: '加微信详聊 价格优惠', assertTier: 'high' },
  { id: 'T3', expect: 'none', note: '⚠️ 带上下文的正常搭话（"能加个微信吗，想请教单片机"）→ 放行',
    author: 'reader-l', text: '博主能加个微信吗？想请教一下单片机的问题' },
  { id: 'T4', expect: 'none', note: '⚠️ 正常"小写 vx 是啥意思"（在问缩写）', author: 'reader-m', text: '文中说的 vx 是指微信吗？没看懂这个缩写' },

  { id: 'S1', expect: 'any', note: '典型广告', author: 'spam-1', text: '专业代刷各种数据，加微信 vx888 详聊，价格优惠' },
  { id: 'S2', expect: 'any', note: '赌博', author: 'spam-2', text: '澳门线上 真人荷官 首存送彩金 点击领取' },
  { id: 'S3', expect: 'any', note: '办证/贷款', author: 'spam-3', text: '办证 代开 发票 无抵押贷款 当天放款' },

  /* ---------- 绕过写法（分隔符 / 重复 / 全角） ---------- */
  { id: 'E1', expect: 'any', note: '「加 V」空格绕过', author: 'spam-4', text: '需要的话 加 V 详聊' },
  { id: 'E2', expect: 'any', note: '「加-V」符号绕过', author: 'spam-5', text: '加-V 咨询有优惠' },
  { id: 'E3', expect: 'any', note: '「v x」插空格', author: 'spam-6', text: 'v x 号：abc12345' },
  { id: 'E4', expect: 'any', note: '「薇 信」变体+空格', author: 'spam-7', text: '薇 信 同号 详聊' },
  { id: 'E5', expect: 'any', note: '重复字符 vxvvx', author: 'spam-8', text: 'vxvvx 加我' },
  { id: 'E6', expect: 'any', note: '全角字母数字', author: 'spam-9', text: '加ＶＸ：８８８' },

  /* ---------- 联系方式 ---------- */
  { id: 'C1', expect: 'any', note: '手机号（带分隔）', author: 'spam-10', text: '联系我 138 1234 5678' },
  { id: 'C2', expect: 'any', note: 'QQ 号', author: 'spam-11', text: 'QQ 123456789 加我' },
  { id: 'C3', expect: 'any', note: '微信 ID', author: 'spam-12', text: '微信号：amy_shop2024' },
  { id: 'C4', expect: 'any', note: 'Telegram', author: 'spam-13', text: '电报 t.me/spamseller 联系' },
  { id: 'C5', expect: 'any', note: '邮箱', author: 'spam-14', text: '发我邮箱 spammer@example.com' },
  { id: 'C6', expect: 'any', note: '裸号码 + 联系词（应命中 context 规则）', author: 'spam-15', text: '详情咨询 88776655' },

  /* ---------- 链接 ---------- */
  { id: 'L1', expect: 'any', note: '短链', author: 'spam-16', text: '优惠在这里 http://t.cn/A6xyz 自取' },
  { id: 'L2', expect: 'any', note: '多条链接', author: 'spam-17', text: 'http://a.com/1 http://b.com/2 http://c.com/3 http://d.com/4 全在这' },
  { id: 'L3', expect: 'any', note: '首条评论带链接（待审）', author: 'spam-18', text: '看我主页 http://x.com/abc', ctx: { isFirstComment: true } },

  /* ---------- 刷屏 / 灌水 ---------- */
  { id: 'D1', expect: 'any', note: '同字符重复', author: 'spam-19', text: 'dddddddddddddddddddd' },
  { id: 'D2', expect: 'any', note: '超长粘贴', author: 'spam-20', text: 'x'.repeat(4200) },
  { id: 'D3', expect: 'any', note: '纯 emoji 刷屏', author: 'spam-21', text: '🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉' },
  { id: 'D4', expect: 'any', note: '与最近评论高度相似（复制粘贴）', author: 'spam-22',
    text: '专业承接各类数据代刷服务价格优惠联系我', ctx: { recentComments: [{ author: 'other', body: '专业承接各类数据代刷服务价格优惠联系我' }] } },
  { id: 'D5', expect: 'any', note: '同一用户短时间高频', author: 'spam-23', text: '顶一下',
    ctx: { now: '2026-10-12T10:00:00Z', recentComments: Array.from({ length: 6 }, (_, i) => ({ author: 'spam-23', body: `顶${i}`, createdAt: '2026-10-12T09:5' + i + ':00Z' })) } },

  /* ---------- 零宽字符绕过 ---------- */
  { id: 'Z1', expect: 'any', note: '零宽空格拆关键词', author: 'spam-24', text: '加\u200b微\u200b信\u200b：\u200babc123，另有\u200b好\u200b货' },

  /* ---------- 白名单 ---------- */
  { id: 'W1', expect: 'none', note: '站主本人（白名单）即使写广告词也放行', author: 'hehehe1234567894', text: '有问题可以加微信找我，我的号是 boss_here' },
];

/* ------------------------------------------------------------------ 跑 */

const rows = [];
for (const c of CASES) {
  const r = evaluate(c.text, Object.assign({ author: c.author }, c.ctx || {}), cfg);
  rows.push({ c, r });
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const hitDesc = (r) => r.matched.length
  ? r.matched.map((m) => `${m.group}:${m.detail.word || m.detail.pattern || m.detail.kind || ''}`).join(', ')
  : '—';

console.log('\n===== 规则引擎测试结果 =====\n');
console.log(pad('ID', 5) + pad('期望', 6) + pad('判定', 8) + pad('动作', 10) + pad('分', 5) + '命中规则');
console.log('-'.repeat(100));
for (const { c, r } of rows) {
  const judge = r.skipped ? '跳过' : (r.action === 'none' ? '放行' : r.tier);
  console.log(pad(c.id, 5) + pad(c.expect, 6) + pad(judge, 8) + pad(r.action, 10) + pad(r.score, 5) + hitDesc(r));
  console.log(pad('', 5) + '  ' + c.note);
}

/* ------------------------------------------------------------------ 汇总 */

const fp = rows.filter(({ c, r }) => c.expect === 'none' && r.action !== 'none' && !r.skipped);
const fn = rows.filter(({ c, r }) => c.expect === 'any' && (r.action === 'none' || r.skipped));
// 档位断言：有些案例"命中不对"比"漏报"更严重（比如正常搭话被判删除）
const wrongTier = rows.filter(({ c, r }) => c.assertTier && r.tier !== c.assertTier);

console.log('\n===== 汇总 =====');
const correct = rows.length - fp.length - fn.length - wrongTier.length;
console.log(`  样例 ${rows.length} 条 ｜ 判定正确 ${correct} 条 ｜ 误报 ${fp.length} 条 ｜ 漏报 ${fn.length} 条 ｜ 档位不符 ${wrongTier.length} 条`);
if (fp.length) {
  console.log('\n  【误报】正常评论被拦截（需要调规则，不要用白名单糊）：');
  for (const { c, r } of fp) console.log(`    - ${c.id} ${c.note}\n      判成 ${r.tier}/${r.action}，命中 ${hitDesc(r)}`);
}
if (fn.length) {
  console.log('\n  【漏报】该拦没拦：');
  for (const { c, r } of fn) console.log(`    - ${c.id} ${c.note}（判定 ${r.action}）`);
}
if (wrongTier.length) {
  console.log('\n  【档位不符】');
  for (const { c, r } of wrongTier) console.log(`    - ${c.id} ${c.note}\n      期望 ${c.assertTier}，实际 ${r.tier}/${r.action}，命中 ${hitDesc(r)}`);
}
if (!fp.length && !fn.length && !wrongTier.length) console.log('\n  ✅ 无误报、无漏报、档位全部符合预期');

process.exit(fp.length || fn.length || wrongTier.length ? 1 : 0);
