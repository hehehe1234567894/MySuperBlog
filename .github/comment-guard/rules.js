/**
 * 评论审核规则集（改规则只改这个文件，不用改代码）
 * ===========================================================================
 * 背景：本站评论是 giscus（GitHub Discussions），渲染在 giscus.app 的 iframe 里。
 * 跨域 iframe 前端注入/过滤做不到，所以审核必须落在 **GitHub 侧** —— 也就是这个仓库的
 * Discussions 上，用 Actions 在服务端跑。数据本来就在这儿，改这里最干净。
 *
 * 设计原则（避免"太弱智的关键词命中"）：
 *   1. 先做**归一化**（全角转半角、大小写、去不可见字符、去掉夹在字里行间的分隔符），
 *      再匹配 —— 否则「加 V」「加-V」「加 V」「薇 信」这类绕过写法一个都抓不到。
 *   2. 规则**按类别分组、每组独立开关 + 独立权重**，命中越多分越高，避免一条关键词就开枪。
 *   3. **谐音不管**（主人明确要求）：我们只做"写法变体"和"字符插入"，不做同音字替换。
 *      比如「威信」会被抓（形近/常见变体），但「威芯」这种谐音**不在规则里**。
 *   4. 分级动作：低=打标、中=隐藏、高=删除。**默认 DRY_RUN**，先看几天日志。
 *
 * 三个调参旋钮在文件末尾的 `thresholds`，误报多了就调它，别去删规则。
 */

module.exports = {
  /* ---------------- 白名单：这些人直接跳过 ---------------- */
  whitelist: {
    // 站主本人（GitHub 用户名）。白名单用户的所有评论一律跳过，不记录、不打标。
    users: ['hehehe1234567894'],
    // 白名单关键词：命中就认为"这是站主自己在讲规则/教程"，直接放行。
    // 例：站主在文章里解释「怎么加微信」是正常内容。**只对白名单用户的评论生效**，
    // 免得给刷子留后门（普通用户写这些词不会因此被放过）。
    phrasesForWhitelistedUsersOnly: ['微信号', '加微信', '联系方式', 'vx', 'v信'],
  },

  /* ---------------- 规则分组 ---------------- */
  groups: {
    /* 1. 显式关键词：广告 / 赌博 / 办证 / 贷款 / 代刷 / 拉群
     * 理由：这类词几乎没有正常讨论场景。
     * 误报风险：低。唯一要注意的是「代刷」可能出现在"别代刷"这种劝阻语境里（罕见，先不管）。 */
    explicit: {
      enabled: true,
      weight: 50,
      tier: 'high',
      patterns: {
        // 注意：「加微信」这类**光杆留联系方式**的写法**不在这里**，被移到 evasion 组（medium）。
        // 原因：中文里"能加个微信吗"是完全正常的搭话，判 high=删除 会误伤（实测过，见 README 的调参记录）。
        // 这里只放"广告语境明确"的词 —— 它们不会出现在正常技术交流里。
        ads: ['微商', '代理加盟', '一手货源', '厂家直销', '免费领取', '点击领取', '扫码进群',
              '扫码加', '资源分享群', '兼职日结', '在家兼职',
              // 以下这组是"高置信广告语境"：正常技术讨论里不会出现，但广告里几乎必有。
              // 加它们是为了让"加微信 + 价格优惠"这类**光杆拉客**也能升到 high（否则只会被隐藏）。
              '价格优惠', '优惠价', '特价', '低价出', '限时优惠', '长期有效', '稳定可靠',
              '包过', '包教包会', '详情咨询', '欢迎咨询', '需要的加', '有需要的联系'],
        gambling: ['博彩', '菠菜', '棋牌', '彩票', '真人荷官', '上线送', '首存', '返水', '洗码', '六合彩'],
        illegal: ['办证', '代考', '代写论文', '刷单', '代刷', '发票', '开票', '贷款', '下款', '网贷',
                  '无抵押', '套现', '洗钱', '外挂', '破解版', '枪版'],
        sextraffic: ['约炮', '上门服务', '楼凤', '福利姬', '裸聊'],
      },
    },

    /* 2. 绕过写法：字符间插空格/符号、重复字符、数字字母混写
     * 理由：`加 V`、`加-V`、`v x`、`vxvvx`、`vx: 888` 是刷子在评论区最常用的规避手法。
     * 做法：归一化时删掉"夹在字里行间"的分隔符与重复字符，再匹配紧凑串。
     * 误报风险：低-中。删分隔符可能把 "a-v-b" 这类正常写法也变紧凑，所以只对**已知模式**匹配。 */
    evasion: {
      enabled: true,
      weight: 25,
      tier: 'medium',
      // 归一化后再匹配的紧凑模式（见 engine.normalizeCompact）
      // 这一组里混了两类东西，都是 medium（隐藏待审，不直接删）：
      //   a) 绕过写法本身：vx / v信 / 薇信 / 威信 / 扣扣 / 电报
      //   b) 光杆拉联系方式："加微信""加v""加我""私我""联系我" —— 正常搭话也可能这么写，
      //      所以宁可先隐藏、让人工看一眼，也不直接删。
      compactPatterns: ['加v', '加vx', '加v信', '加微信', 'v信', '薇信', '威信', 'weixin', 'wechat',
                        '私我', '加我', '联系我', 'telegram', '电报'],
      /* 上下文规则：这些词**单独出现不算证据** —— 中文里"vx 是啥意思""扣扣是什么"是正常提问。
       * 必须同时出现「凭证」才算（号码 / 带数字字母的 ID / 继续联系的措辞）。
       * 这是为了压误报，代价是"只写 vx 不写号"的广告会漏 —— 但那本来也拦不住，且会进人工视野。 */
      contextualPatterns: [
        { pattern: 'vx', credential: true },
        { pattern: '扣扣', credential: true },
        { pattern: '看主页', credential: false },
      ],
    },

    /* 3. 联系方式模式
     * 理由：正常人也会留邮箱/追问联系方式，所以**单独一类、单独定档**，
     *       不要和"广告"混在一起 —— 这是我们最容易误伤正常用户的地方。
     * 误报风险：中。所以：
     *   - 手机号/QQ号：QQ 号有长度歧义（5-11 位数字）→ 只在"附近出现联系类词"时才判；
     *   - 邮箱：基本可信，但如果是站主自己的域名邮箱也算正常，故 tier=low。
     * 谐音不管：`威信` 在 evasion 里（形近变体），「威芯」这类谐音不判。 */
    contact: {
      enabled: true,
      weight: 20,
      tier: 'low',
      patterns: {
        phone: '1[3-9]\\d{9}',                    // 大陆手机号
        phoneSpaced: '1[3-9]\\d[\\s\\-·.]{1,3}\\d{4}[\\s\\-·.]{1,3}\\d{4}', // 1 3x xxxx xxxx
        email: '[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}',
        qq: '(?:qq|扣扣|企鹅)\\D{0,6}\\d{5,11}',
        wechatId: '(?:vx|v信|薇信|威信|微信|weixin|wechat|wx)\\D{0,4}[A-Za-z0-9_\\-]{4,20}',
        telegram: '(?:t\\.me/|telegram|电报)\\S{0,40}',
        whatsapp: '(?:whatsapp|line|kakao)\\W{0,4}[+\\d][\\d\\s\\-]{6,}',
      },
      // 裸数字串（可能是 QQ 号）单独处理：必须**同时**出现联系类词才判，降低误伤
      bareNumberNeedsContext: {
        numberRegex: '\\d{5,11}',
        contextWords: ['联系', '加', '扣', '私', '详聊', '咨询', '号码'],
      },
    },

    /* 4. 链接策略
     * 理由：技术博客里贴链接是**正常行为**（GitHub、文档、StackOverflow），
     *       所以不能"见链接就杀"。分三档：数量阈值 / 短链域名 / 首条评论带链接。
     * 误报风险：中。默认阈值给得宽（≥4 条链接才算刷），短链黑名单只放**确定性高的**。 */
    links: {
      enabled: true,
      weight: 30,
      tier: 'medium',
      maxLinks: 4,                    // 超过这个数量 → 命中
      shortenerDomains: ['t.cn', 'url.cn', 'dwz.cn', 'bit.ly', 'tinyurl.com', 'is.gd',
                         'surl.cn', 'sourl.cn', 'w.url.cn', 'suo.im', 'mrw.so'],
      // 网盘 / 图床 / 内容农场（刷子喜欢用这些藏二维码或引流）
      shadyDomains: ['pan.baidu.com/s/', 'lanzou', 'ctfile.com', 'quark.cn/s/',
                     'kdocs.cn', 'docs.qq.com', 'mp.weixin.qq.com/s/'],
      // 首条评论带链接 → 先隐藏待审（很多刷子第一条就是广告）
      firstCommentWithLink: { enabled: true, tier: 'medium' },
    },

    /* 5. 刷屏 / 灌水
     * 理由：正常评论不会出现"同一个字重复几十次""4000 字粘贴""和最近评论一模一样"。
     * 误报风险：低-中。阈值都给得保守。
     * 注意：作者短时间高频需要维护状态（本引擎读不到历史事件流），所以只在**读得到时**判，
     *       实际生效版本用 GraphQL 拉该 discussion 的最近评论来算"同一用户短时间高频"。 */
    flood: {
      enabled: true,
      weight: 35,
      tier: 'medium',
      repeatThreshold: 8,             // 同一字符连续重复 ≥N 次
      minMeaningfulLength: 3,         // 更短且无意义（纯符号/纯空白）→ 判
      maxLength: 4000,                // 超长粘贴
      emojiRatio: 0.8,                // emoji 占比
      emojiMinCount: 8,               // 且 emoji 数量 ≥N（避免"谢谢🙏🙏"被误判）
      uppercaseRunLength: 12,         // 全大写长串
      similarity: {                   // 与最近 M 条评论高度相似（复制粘贴广告）
        enabled: true,
        recentCount: 20,              // 取同 discussion 最近 20 条
        threshold: 0.85,              // 3-gram Jaccard 相似度
        minLength: 20,                // 太短的评论不参与（"谢谢"人人一样）
      },
      sameUserBurst: {                // 同一用户短时间高频
        enabled: true,
        windowMinutes: 10,
        maxInWindow: 5,
      },
    },

    /* 6. 其他
     * 理由：不可见字符是**明确的绕过手法**（零宽空格拆关键词让正则失配），见到就该处理。
     * 误报风险：不可见字符极低（几乎只有故意的人才会用）；纯 emoji 已在上面的 flood 里。 */
    misc: {
      enabled: true,
      weight: 40,
      tier: 'medium',
      // 零宽 / 双向控制 / 私用区等不可见字符
      invisibleChars: '[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\u00AD]',
      // 单个评论里不可见字符超过这个数就直接判（1-2 个可能只是复制粘贴带的）
      invisibleThreshold: 3,
    },
  },

  /* ---------------- 动作分级 ----------------
   * 分数由命中的规则权重累加。分数越高档位越高。
   * 为什么用"累加分数"而不是"命中即判"：单条特征容易误伤（比如只有邮箱），
   * 多条同时命中才是真刷子（邮箱 + 联系方式词 + 链接）。
   */
  tiers: [
    { name: 'low',  minScore: 1,  action: 'label' },     // 打标签 + 记录
    { name: 'medium', minScore: 20, action: 'minimize' },// 隐藏（minimize，可恢复）
    { name: 'high', minScore: 50, action: 'delete' },    // 删除
  ],

  /* ---------------- 调参旋钮 ---------------- */
  thresholds: {
    // 命中高权重规则（tier=high）时，是否无条件升到最高档
    escalateOnHighTierRule: true,
    // 分数低于这个数就不记录（减少噪音）
    minScoreToReport: 1,
  },

  /* ---------------- 动作对应的 GitHub 侧配置 ---------------- */
  actions: {
    // 打标用（仓库里可能还没有这些 label，工作流会先创建）
    labels: {
      low: 'comment-guard:low',
      medium: 'comment-guard:medium',
      high: 'comment-guard:high',
    },
    // minimize 用的分类（GitHub 固定枚举）：SPAM 最贴切
    minimizeClassifier: 'SPAM',
    // 汇总用的 Issue（严重命中时会更新同一个 Issue，避免刷屏式建 issue）
    summaryIssueTitle: '评论自动审核记录（comment-guard）',
  },
};
