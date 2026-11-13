/* ==========================================================================
 * swarm.js — 群集光标「建造」动画（Hugo 主题 swarm）
 *
 * 纯前端、零依赖、无后端。
 *
 * 设计要点（与旧版的区别）：
 *   1. 真实 DOM 元素按进度被揭示（描边 + clip-path），不是在 canvas 上画假框框；
 *   2. 每个光标都有事做：领到任务的去建造，其余在视口内大范围巡游；
 *   3. 滚动驱动 —— 元素进入视口才建，不强制自动下滑（不晕）；
 *   4. 平滑收尾：canvas 淡出、真实页面完整可见，HUD 保留「重播」方便反复预览；
 *   5. 看门狗 + abort 兜底：任何异常都不会让页面停在空白状态。
 *
 * 调试：地址加 ?debug 会在 title 显示内部状态；?skip 直接跳过动画。
 * ========================================================================== */
(() => {
  'use strict';

  /* ---------------------------------------------------------------- 配置 */
  const CFG = {
    agentsDesktop: 20,
    agentsMobile: 10,
    mobileWidth: 720,
    maxBuilders: 9,          // 同时建造的光标上限
    preload: 40,             // 只建真正进入视口的 —— 滚到哪建到哪
    travelSec: 0.75,         // 光标飞到目标的时长（秒）
    clickSec: 0.28,          // 到位后先「咔哒」一下，再开始打字（秒）
    buildSec: {              // 非打字元素的揭示时长（秒）
      title: 2.00,
      text: 1.60,
      box: 1.30,
      card: 1.80,
      article: 1.60         // 长文正文（逐字时长按字数算，此项仅作兜底）
    },
    /* 打字元素按字数算时长，避免长标题「唰」一下就打完 */
    typeSecPerChar: 0.055,   // 每个字的间隔（秒）
    typeMinSec: 1.20,        // 短文本至少打这么久
    typeMaxSec: 8.00,        // 长文本（含摘要）最多打这么久
    finishDelaySec: 1.80,    // 全部元素建完后多久收尾
    watchdogSec: 90,         // 可用性兜底：停留过久时补全内容，避免下方永久空白
    accent: '#0D99FF',
    colors: [
      '#F24E1E', '#A259FF', '#1ABCFE', '#0ACF83', '#FF7262', '#FFC700',
      '#9747FF', '#E8467C', '#14AE5C', '#0D99FF', '#FF8A00', '#00B5CE'
    ],
    names: [
      'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Ken', 'Barbara', 'Dennis',
      'Radia', 'Guido', 'Frances', 'Bjarne', 'Hedy', 'Tim', 'Katherine',
      'Edsger', 'Joan', 'Donald', 'Sophie', 'Niklaus', 'Anita', 'Brian',
      'Mary', 'Rob'
    ],
    arrowPath: 'M5.5 3.2 L5.5 19.6 L9.6 15.6 L12.2 21.4 L15.4 19.9 L12.8 14.2 L18.2 13.9 Z'
  };

  /* ------------------------------------------------------------ 小工具 */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const isMobile = () => window.innerWidth < CFG.mobileWidth;
  const scrollTop = () => window.scrollY || document.documentElement.scrollTop || 0;

  /* ------------------------------------------------------------ DOM 引用 */
  const stage = $('swarmStage');
  const canvas = $('swarmCanvas');
  const hudAgents = $('hudAgents');
  const hudLayers = $('hudLayers');
  const btnSkip = $('hudSkip');
  const btnReplay = $('hudReplay');
  const hudHint = $('hudHint');
  if (!stage || !canvas) return;

  const ctx = canvas.getContext('2d');
  /* URL 开关统一用 URLSearchParams：?utm=fastlane / ?ref=skipped 不该误触发 */
  const qs = new URLSearchParams(location.search);
  const hasFlag = (k) => qs.has(k);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !hasFlag('forceanim');
  const debug = hasFlag('debug');
  /* 左下角控制条是调试/演示用的：正式站默认隐藏，仅 ?debug 时开放 */
  const hud = $('swarmHud');
  if (hud) hud.hidden = !debug;

  /* 节奏：默认已放慢。?speed=0.6 表示 0.6 倍速（更慢）、?speed=2 更快，
     可直接在预览地址上试，不必改代码。?fast 是给自动化用的 1/12 快进。 */
  const speedArg = parseFloat((location.search.match(/[?&]speed=([\d.]+)/) || [])[1]);
  const speedScale = (Number.isFinite(speedArg) && speedArg > 0) ? 1 / speedArg : 1;
  const fastMode = hasFlag('fast');
  const timeScale = speedScale * (fastMode ? 1 / 12 : 1);
  CFG.travelSec *= timeScale;
  /* fast 下点击只减半，保留一个可验证的「点击 → 打字」停顿 */
  CFG.clickSec *= fastMode ? 0.5 : speedScale;
  for (const k of Object.keys(CFG.buildSec)) CFG.buildSec[k] *= timeScale;
  CFG.finishDelaySec *= timeScale;
  CFG.typeSecPerChar *= timeScale;
  CFG.typeMinSec *= timeScale;
  CFG.typeMaxSec *= timeScale;

  /* ------------------------------------------------------------ 世界状态 */
  let W = 0, H = 0, DPR = 1;
  let targets = [];        // 需要被建造的真实元素
  let cursors = [];        // 所有光标
  let ripples = [];        // 点击涟漪
  let phase = 'idle';      // idle | running | finishing | done
  let builtCount = 0;
  let elapsed = 0;         // 运行秒数
  let idleSec = 0;         // 视野内无待建任务的持续时间
  let lastFrame = 0;
  let rafId = 0;
  let clickCount = 0;       // 点击发生次数（供自动化验证「先点击后打字」）
  let finishTimer = 0;      // 收尾延时，重播/跳过时必须清掉
  let bootWall = 0;         // 启动时刻（真实墙钟），兜底不受 dt 钳制影响

  /* ------------------------------------------------------------ 画布尺寸 */
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* ------------------------------------------------ 采集建造目标（文档坐标） */
  /* 记住打字元素的原始文本，重播时才能恢复（否则清空后采集不到字符） */
  const typeCache = new WeakMap();

  /* 从缓存恢复文字。重播 / resize 前必须先做：inline-block 元素文字清空后
     宽度变 0，若先量几何再恢复，会被 filter 永久排除（QA #1）。 */
  function restoreTypeText(el) {
    const cached = typeCache.get(el);
    if (cached) for (const it of cached) it.node.nodeValue = it.full;
  }

  function measure() {
    const sy = scrollTop();
    const nodes = [...document.querySelectorAll('[data-build]')];
    for (const el of nodes) restoreTypeText(el);
    targets = nodes
      .map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          index: i,
          type: el.dataset.build || 'box',
          x: r.left + window.scrollX,
          y: r.top + sy,
          w: r.width,
          h: r.height,
          progress: 0,
          done: false,
          builder: null
        };
      })
      .filter((t) => t.w > 2 && t.h > 2);

    /* 所有 data-build 元素都逐字构建；长文正文进页面即自动开打，不等滚动 */
    for (const t of targets) {
      prepareTypewriter(t);
      if (t.type === 'article') t.autoStart = true;
    }
  }

  /* 为打字元素采集文本节点、插入闪烁光标，并锁定原始高度防布局塌陷 */
  function prepareTypewriter(t) {
    const el = t.el;
    restoreTypeText(el);
    el.querySelectorAll('.swarm-caret').forEach((n) => n.remove());

    /* 收集元素内所有「有可见内容」的文本节点；纯缩进空白节点被 trim 过滤，
       既不混进打字计数，也不破坏原有排版 */
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.trim().length) nodes.push({ node: n, full: n.nodeValue });
    }
    if (!nodes.length) return;

    const caret = document.createElement('span');
    caret.className = 'swarm-caret';
    caret.setAttribute('aria-hidden', 'true');
    el.appendChild(caret);

    typeCache.set(el, nodes);
    t.typeNodes = nodes;
    t.textLen = nodes.reduce((sum, it) => sum + it.full.length, 0);
    t.caret = caret;
    t.isTypewriter = true;
    /* 所有打字元素都锁原始宽高：inline-block / 按钮文字清空后会塌成 0，
       既会让下次 measure 把它过滤掉，也会让画框错位（QA #1）。 */
    el.style.minHeight = t.h + 'px';
    el.style.minWidth = t.w + 'px';
  }

  /* ------------------------------------------------ 把进度写回真实元素 */
  function setProgress(t, p) {
    t.progress = clamp(p, 0, 1);
    const el = t.el;

    /* 打字机：按进度逐字填充真实文本节点，元素本身不再整体擦除 */
    if (t.isTypewriter) {
      const visible = Math.round(t.progress * t.textLen);
      let used = 0;
      for (const it of t.typeNodes) {
        const take = clamp(visible - used, 0, it.full.length);
        const next = it.full.slice(0, take);
        if (it.node.nodeValue !== next) it.node.nodeValue = next;
        used += it.full.length;
      }
      /* 卡片是块级容器：框快速淡入，标题逐字敲；纯文本元素直接显示 */
      el.style.opacity = (t.type === 'card' || t.type === 'box')
        ? clamp(t.progress * 5, 0.06, 1).toFixed(3)
        : '1';
      el.style.clipPath = 'none';
      el.style.transform = 'none';
      const done = t.progress >= 1;
      if (t.caret) t.caret.style.display = (!done && t.progress > 0) ? 'inline-block' : 'none';
      if (done) {
        t.doneAt = elapsed;
        el.classList.add('is-built');
        /* 完成后释放锁死的内联尺寸，别挡住响应式布局（QA #7） */
        el.style.removeProperty('min-height');
        el.style.removeProperty('min-width');
      } else el.classList.remove('is-built');
      placeCaret(t);
      measureTypewriterCaret(t);
      return;
    }

    if (t.progress >= 1) {
      t.doneAt = elapsed;
      el.style.opacity = '1';
      el.style.clipPath = 'none';
      el.style.transform = 'none';
      el.style.removeProperty('min-height');
      el.style.removeProperty('min-width');
      el.classList.add('is-built');
    } else {
      el.style.opacity = (0.06 + 0.94 * t.progress).toFixed(3);
      el.style.clipPath = `inset(0 ${((1 - t.progress) * 100).toFixed(1)}% 0 0)`;
      el.style.transform = `translateY(${((1 - t.progress) * 6).toFixed(1)}px)`;
    }
  }

  /* 量出「已打出的文字末尾」的文档坐标，让建造光标停在字后面 */
  function measureTypewriterCaret(t) {
    let node = null, offset = 0;
    for (let i = t.typeNodes.length - 1; i >= 0; i--) {
      const it = t.typeNodes[i];
      if (it.node.nodeValue.length > 0) { node = it.node; offset = it.node.nodeValue.length; break; }
    }
    if (!node) { t.caretX = t.x; t.caretY = t.y + t.h / 2; return; }
    try {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      t.caretX = rect.left + window.scrollX;
      t.caretY = rect.top + scrollTop() + rect.height / 2;
    } catch (_) {
      t.caretX = t.x;
      t.caretY = t.y + t.h / 2;
    }
  }

  /* 把闪烁光标移到「当前正打到的文本节点」后面，像真实编辑器光标 */
  function placeCaret(t) {
    const caret = t.caret;
    if (!caret) return;
    let host = t.el, ref = null;
    for (let i = t.typeNodes.length - 1; i >= 0; i--) {
      const n = t.typeNodes[i].node;
      if (n.nodeValue.length > 0) {
        if (n.nextSibling === caret) return;   // 已在正确位置
        host = n.parentNode;
        ref = n.nextSibling;
        break;
      }
    }
    if (caret.parentNode !== host || caret.nextSibling !== ref) {
      try { host.insertBefore(caret, ref); } catch (_) { /* 忽略极端 DOM 情况 */ }
    }
  }

  function resetTargets() {
    for (const t of targets) {
      t.progress = 0;
      t.done = false;
      t.builder = null;
      t.el.classList.remove('is-built');
      setProgress(t, 0);
    }
    builtCount = 0;
  }

  function completeAll() {
    /* 兜底：连被尺寸过滤掉的 [data-build] 元素也要恢复文字、可见。
       只遍历 targets 会让漏网元素永久空白、HUD 还谎报完成（QA #1）。 */
    for (const el of document.querySelectorAll('[data-build]')) {
      restoreTypeText(el);
      el.style.opacity = '1';
      el.style.clipPath = 'none';
      el.style.transform = 'none';
      el.style.removeProperty('min-height');
      el.style.removeProperty('min-width');
      el.classList.add('is-built');
    }
    for (const t of targets) {
      if (!t.done) { setProgress(t, 1); t.done = true; t.builder = null; }
    }
    builtCount = targets.length;
    updateHud();
  }

  /* ------------------------------------------------ 沿矩形边框走一圈 */
  function borderPoint(t, p, sy) {
    /* 只有长文正文让光标跟着文字走（框有几千像素高，绕一圈不现实）；
       其余元素一律沿矩形边框走一圈 —— 这就是「画方框」的建造光标 */
    if (t.type === 'article') {
      return {
        x: t.caretX != null ? t.caretX : t.x + t.w * p,
        y: (t.caretY != null ? t.caretY : t.y + t.h * 0.6) - sy
      };
    }
    const x = t.x, y = t.y - sy, w = t.w, h = t.h;
    const perimeter = 2 * (w + h);
    let d = p * perimeter;
    if (d < w) return { x: x + d, y };
    d -= w;
    if (d < h) return { x: x + w, y: y + d };
    d -= h;
    if (d < w) return { x: x + w - d, y: y + h };
    d -= w;
    return { x, y: y + h - d };
  }

  /* 部分矩形描边（0..1 进度） */
  function partialRect(c, x, y, w, h, p) {
    const perimeter = 2 * (w + h);
    let remain = p * perimeter;
    c.beginPath();
    c.moveTo(x, y);
    const edges = [
      [x, y, x + w, y],
      [x + w, y, x + w, y + h],
      [x + w, y + h, x, y + h],
      [x, y + h, x, y]
    ];
    for (const [ax, ay, bx, by] of edges) {
      if (remain <= 0) break;
      const len = Math.hypot(bx - ax, by - ay);
      const f = Math.min(1, remain / len);
      c.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
      remain -= len;
    }
  }

  function roundedRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  /* ------------------------------------------------------------ 光标 */
  class Cursor {
    constructor(i) {
      this.i = i;
      this.color = CFG.colors[i % CFG.colors.length];
      this.name = CFG.names[i % CFG.names.length];
      const kind = i % 6;
      this.shape = kind === 3 ? 'ibeam' : kind === 4 ? 'cross' : kind === 5 ? 'pen' : 'arrow';
      this.x = i % 2 === 0 ? -50 : W + 50;
      this.y = rand(H * 0.1, H * 0.9);
      this.orbit = rand(0, Math.PI * 2);
      this.spin = rand(0.6, 1.3);
      this.state = 'roam';   // roam | travel | build
      this.task = null;
      this.trail = [];
      this.press = 0;
      this.travelT = 0;
      this.clickT = 0;
      this.buildT = 0;
      this.sx = this.x; this.sy = this.y;
      this.tx = this.x; this.ty = this.y;
      this.gather = null;
    }

    pushTrail() {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 10) this.trail.shift();
    }

    assign(t) {
      this.task = t;
      this.state = 'travel';
      this.travelT = 0;
      this.press = 0;
    }

    /* 待命光标围着「视野内最近的未建元素」缓行，而不是满屏乱飘 */
    roam(dt, gathering) {
      /* canvas 是 fixed，光标坐标一律用视口坐标；sy 只用于换算元素 top（QA #2） */
      const sy = scrollTop();
      this.orbit += dt * (0.28 + this.spin * 0.16);
      if (gathering && this.gather) {
        const k = 1 - Math.exp(-dt * 2.2);
        this.x += (this.gather.x - this.x) * k;
        this.y += (this.gather.y - this.y) * k;
        this.pushTrail();
        return;
      }
      let ax = W * 0.5, ay = H * 0.6;
      let best = Infinity;
      for (const t of targets) {
        if (t.done) continue;
        const top = t.y - sy;
        if (top < -200 || top > H + 300) continue;
        const cx = t.x + t.w / 2;
        const cy = clamp(top + t.h / 2, 40, H - 40);
        const d = Math.hypot(cx - this.x, cy - this.y);
        if (d < best) { best = d; ax = cx; ay = cy; }
      }
      const gx = ax + Math.sin(this.orbit * 1.5 + this.i * 0.8) * 110;
      const gy = ay + Math.cos(this.orbit * 1.2 + this.i * 1.1) * 80;
      const k = 1 - Math.exp(-dt * 1.3);
      this.x += (gx - this.x) * k;
      this.y += (gy - this.y) * k;
      this.pushTrail();
    }

    update(dt, gathering) {
      if (gathering) { this.roam(dt, true); return; }

      if (this.state === 'travel' && this.task) {
        this.travelT = Math.min(this.travelT + dt / CFG.travelSec, 1);
        /* 目标按实时滚动位置计算：滚动时光标跟着元素走，不会飞偏 */
        const tx = this.task.x - 8;
        const ty = this.task.y - scrollTop() - 8;
        const k = 1 - Math.exp(-dt * 14);
        let nx = this.x + (tx - this.x) * k;
        let ny = this.y + (ty - this.y) * k;
        /* 限速 1500px/s：目标在屏幕另一端时，强缓动第一帧就会跳半屏
           （实测最大 496px/帧），看起来像瞬移。限速后是看得见的飞行轨迹。 */
        const maxStep = 1500 * dt;
        const dx = nx - this.x, dy = ny - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxStep) {
          nx = this.x + (dx / dist) * maxStep;
          ny = this.y + (dy / dist) * maxStep;
        }
        this.x = nx;
        this.y = ny;
        if (this.travelT >= 1) {
          /* 只在小距离内吸附；还差得远就继续飞 —— 否则快进/低帧率下会瞬移半屏 */
          if (Math.hypot(tx - this.x, ty - this.y) > 48) {
            this.pushTrail();
            return;
          }
          this.x = tx;
          this.y = ty;
          /* 先「点击」：按下 + 涟漪；此阶段文字保持空白，还没有打字 */
          this.state = 'click';
          this.clickT = 0;
          this.press = 1;
          clickCount++;
          ripples.push({ x: this.x, y: this.y, sy: scrollTop(), r: 2, a: 0.9, color: this.color });
        }
        this.pushTrail();
        return;
      }

      /* 点击阶段：光标按住不动，涟漪扩散；文字仍是空的 */
      if (this.state === 'click' && this.task) {
        this.clickT = Math.min(this.clickT + dt / CFG.clickSec, 1);
        this.pushTrail();
        if (this.clickT >= 1) {
          this.press = 0;        // 抬起，紧接着才开始敲字
          this.state = 'build';
          this.buildT = 0;
        }
        return;
      }

      if (this.state === 'build' && this.task) {
        const t = this.task;
        /* 打字元素按字数定时长（每字固定间隔），其余元素用固定时长 */
        const dur = (t.isTypewriter
          ? clamp(t.textLen * CFG.typeSecPerChar, CFG.typeMinSec, CFG.typeMaxSec)
          : (CFG.buildSec[t.type] || 0.9)) * (isMobile() ? 0.72 : 1);
        this.buildT = Math.min(this.buildT + dt / dur, 1);
        /* 打字用匀速推进，像真的在敲键盘；其余元素仍用缓出 */
        const p = t.isTypewriter ? this.buildT : easeOut(this.buildT);
        const pos = borderPoint(t, p, scrollTop());
        this.x = pos.x;
        this.y = pos.y;
        setProgress(t, p);
        this.pushTrail();
        if (this.buildT >= 1) {
          setProgress(t, 1);
          t.done = true;
          t.builder = null;
          builtCount++;
          this.state = 'roam';
          this.task = null;
          this.press = 0;
          updateHud();
        }
        return;
      }

      this.roam(dt, false);
    }

    drawCursor(c) {
      const scale = isMobile() ? 0.78 : 1;
      c.save();
      c.translate(this.x, this.y);
      c.scale(scale, scale);
      if (this.press > 0) c.scale(0.86, 0.86);
      c.lineJoin = 'round';
      c.lineCap = 'round';

      if (this.shape === 'ibeam') {
        const p = new Path2D('M3 1 H5.5 Q7.5 1 7.5 3.5 Q7.5 1 9.5 1 H12 M7.5 3.5 V17.5 M3 20 H5.5 Q7.5 20 7.5 17.5 Q7.5 20 9.5 20 H12');
        c.lineWidth = 3.6; c.strokeStyle = '#fff'; c.stroke(p);
        c.lineWidth = 1.5; c.strokeStyle = this.color; c.stroke(p);
      } else if (this.shape === 'cross') {
        const p = new Path2D('M7.5 1 V19 M1 10 H19');
        c.lineWidth = 3.6; c.strokeStyle = '#fff'; c.stroke(p);
        c.lineWidth = 1.5; c.strokeStyle = this.color; c.stroke(p);
      } else if (this.shape === 'pen') {
        const body = new Path2D('M1 1 L8.5 3.3 L12.4 5.6 L7 11 L3.3 8.5 Z');
        const tip = new Path2D('M12.4 5.6 L14.6 7.8 L9.2 13.2 L7 11 Z');
        c.fillStyle = this.color; c.strokeStyle = '#fff'; c.lineWidth = 1.4;
        c.fill(body); c.stroke(body); c.fill(tip); c.stroke(tip);
      } else {
        const p = new Path2D(CFG.arrowPath);
        c.fillStyle = this.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
        c.shadowColor = this.color; c.shadowBlur = 10;
        c.fill(p); c.shadowBlur = 0; c.stroke(p);
      }
      c.restore();

      /* 名字标签只在领到任务时显示，避免满屏标签显得杂乱 */
      if (!isMobile() && (this.state === 'travel' || this.state === 'click' || this.state === 'build')) {
        c.save();
        c.font = '600 10px ui-sans-serif, -apple-system, "PingFang SC", system-ui, sans-serif';
        const tw = c.measureText(this.name).width;
        const bw = tw + 10, bh = 16, bx = this.x + 14, by = this.y + 12;
        c.globalAlpha = 0.82;
        c.fillStyle = this.color;
        roundedRectPath(c, bx, by, bw, bh, 4); c.fill();
        c.globalAlpha = 1;
        c.fillStyle = '#fff';
        c.fillText(this.name, bx + 5, by + 11.5);
        c.restore();
      }
    }

    draw(c) {
      /* 拖尾 */
      if (this.trail.length > 2) {
        c.save();
        for (let i = 1; i < this.trail.length; i++) {
          c.globalAlpha = (i / this.trail.length) * 0.22;
          c.strokeStyle = this.color;
          c.lineWidth = 1.3;
          c.beginPath();
          c.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
          c.lineTo(this.trail[i].x, this.trail[i].y);
          c.stroke();
        }
        c.restore();
      }
      this.drawCursor(c);
    }
  }

  /* ------------------------------------------------------------ HUD */
  function updateHud() {
    if (hudAgents) hudAgents.textContent = String(cursors.length);
    if (hudLayers) hudLayers.textContent = `${builtCount}/${targets.length}`;
  }

  /* ------------------------------------------------------------ 任务分配 */
  function assignTasks() {
    const sy = scrollTop();
    let active = cursors.filter((c) => c.state !== 'roam').length;
    if (active >= CFG.maxBuilders) return;
    for (const t of targets) {
      if (t.done || t.builder) continue;
      const top = t.y - sy;
      /* autoStart（长文正文）不受滚动限制：进页面就从头打到尾 */
      if (!t.autoStart && (top + t.h < -CFG.preload || top > H + CFG.preload)) continue;
      const c = cursors.find((x) => x.state === 'roam');
      if (!c) break;
      c.assign(t);
      t.builder = c;
      active++;
      if (active >= CFG.maxBuilders) break;
    }
  }

  /* ------------------------------------------------------------ 绘制蓝图 */
  function drawBlueprints(sy) {
    for (const t of targets) {
      if (t.progress <= 0) continue;
      const x = t.x, y = t.y - sy, w = t.w, h = t.h;
      if (y + h < -60 || y > H + 60) continue;
      const p = t.progress;
      const done = p >= 1;
      /* 长文正文：不画几千像素高的大框，只让一条短扫描线跟着当前打到的行 */
      if (t.type === 'article') {
        if (!done && t.caretY != null) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.strokeStyle = CFG.accent;
          ctx.lineWidth = 1.5;
          const ly = t.caretY - sy + 12;
          ctx.beginPath();
          ctx.moveTo(x, ly);
          ctx.lineTo(x + w * 0.35, ly);
          ctx.stroke();
          ctx.restore();
        }
        continue;
      }
      /* 建完的框短暂保留后消失，只留真实元素，不再留一圈灰线 */
      if (done && elapsed - (t.doneAt || 0) > 0.6) continue;

      ctx.save();
      /* 打字元素仍然画完整方框（光标绕框走），但不填蓝色底板，免得盖住正在敲出来的字 */
      if (!t.isTypewriter) {
        /* 建造中的底板：轻微高亮，让"正在被造"看得出来 */
        ctx.globalAlpha = done ? 0 : 0.10 * (1 - p) + 0.03;
        ctx.fillStyle = CFG.accent;
        roundedRectPath(ctx, x, y, w, h, 10);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      /* 描边：未完成时亮蓝带发光，完成后淡灰稳定线 */
      ctx.strokeStyle = done ? 'rgba(148,163,184,.28)' : CFG.accent;
      ctx.lineWidth = done ? 1 : 2.2;
      if (!done) { ctx.shadowColor = CFG.accent; ctx.shadowBlur = 8; }
      partialRect(ctx, x, y, w, h, done ? 1 : p);
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* 四角选择标记 + 尺寸标注 */
      if (!done && !isMobile()) {
        const a = 9;
        ctx.strokeStyle = CFG.accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - 3, y + a); ctx.lineTo(x - 3, y - 3); ctx.lineTo(x + a, y - 3);
        ctx.moveTo(x + w - a, y - 3); ctx.lineTo(x + w + 3, y - 3); ctx.lineTo(x + w + 3, y + a);
        ctx.moveTo(x - 3, y + h - a); ctx.lineTo(x - 3, y + h + 3); ctx.lineTo(x + a, y + h + 3);
        ctx.moveTo(x + w - a, y + h + 3); ctx.lineTo(x + w + 3, y + h + 3); ctx.lineTo(x + w + 3, y + h - a);
        ctx.stroke();

        const label = `${Math.round(w)} × ${Math.round(h)}`;
        ctx.font = '600 10px ui-monospace, SFMono-Regular, monospace';
        const lw = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(13,153,255,.14)';
        roundedRectPath(ctx, x - 1, y - 20, lw, 16, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(13,153,255,.45)'; ctx.lineWidth = 1;
        roundedRectPath(ctx, x - 1, y - 20, lw, 16, 3); ctx.stroke();
        ctx.fillStyle = CFG.accent;
        ctx.textBaseline = 'top';
        ctx.fillText(label, x + 5, y - 16.5);
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------ 帧循环 */
  let frameTimer = 0;
  let lastStepAt = 0;

  function step(now) {
    lastStepAt = now;
    if (!lastFrame) lastFrame = now;
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (dt > 0) {
      try {
        render(dt);
      } catch (err) {
        console.error('[swarm]', err);
        if (debug) document.title = 'ERR: ' + err.message;
        abort();
        return;
      }
    }
    schedule();
  }

  /* 用 rAF 驱动；rAF 被暂停时（后台标签页 / 部分无头浏览器）用定时器兜底推进 */
  function schedule() {
    cancelAnimationFrame(rafId);
    clearTimeout(frameTimer);
    rafId = requestAnimationFrame(step);
    frameTimer = setTimeout(() => {
      if (performance.now() - lastStepAt > 100) {
        cancelAnimationFrame(rafId);
        step(performance.now());
      }
    }, 120);
  }

  function stopLoop() {
    cancelAnimationFrame(rafId);
    clearTimeout(frameTimer);
    clearTimeout(finishTimer);
    finishTimer = 0;
    rafId = 0;
    frameTimer = 0;
  }

  function render(dt) {
    const sy = scrollTop();
    elapsed += dt;
    ctx.clearRect(0, 0, W, H);

    const gathering = phase === 'finishing';
    if (phase === 'running') assignTasks();

    drawBlueprints(sy);

    /* 涟漪（记录创建时的滚动位置，跟着页面走） */
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += dt * 90;
      rp.a -= dt * 1.4;
      if (rp.a <= 0) { ripples.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, rp.a);
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y + rp.sy - sy, rp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const c of cursors) {
      c.update(dt, gathering);
      c.draw(ctx);
    }

    /* 只有「全部元素都建完」才自然收尾；否则一直待命，滚动会继续触发建造 */
    if (phase === 'running') {
      const syNow = scrollTop();
      const busy = cursors.some((c) => c.state !== 'roam');
      const allDone = builtCount >= targets.length;
      const pendingInView = targets.some((t) => !t.done
        && t.y - syNow < H + CFG.preload
        && t.y + t.h - syNow > -CFG.preload);
      if (allDone && !busy) {
        idleSec += dt;
        if (idleSec >= CFG.finishDelaySec) finish();
      } else {
        idleSec = 0;
      }
      /* 视野内没活了但下面还有内容 → 提示继续滚动 */
      if (hudHint) hudHint.style.display = (!allDone && !pendingInView && !busy) ? 'inline' : 'none';
      /* 兜底用真实墙钟：headless/后台标签页 dt 被钳到 50ms，elapsed 只有
         真实时间的零头，按它判断会几十分钟都不触发（QA #4）。 */
      if ((performance.now() - bootWall) / 1000 >= CFG.watchdogSec && !allDone) skip();
    }

    if (debug) {
      document.title = `ph=${phase} built=${builtCount}/${targets.length} ag=${cursors.length} t=${elapsed.toFixed(1)}`;
    }
  }

  /* ------------------------------------------------------------ 收尾 / 重播 / 兜底 */
  /* 自然完成：所有元素都已由滚动建造完毕，绝不提前补建 */
  function finish() {
    if (phase === 'finishing' || phase === 'done') return;
    phase = 'finishing';
    if (hudHint) hudHint.style.display = 'none';
    document.body.classList.add('swarm-done');

    for (const c of cursors) {
      c.gather = { x: W * 0.5 + rand(-70, 70), y: H * 0.46 + rand(-50, 50) };
      c.state = 'roam';
      c.task = null;
    }
    stage.classList.add('is-fading');
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      /* 重播/跳过会在收尾 700ms 内改掉 phase，旧 timer 不能覆盖它（QA #3） */
      if (phase !== 'finishing') return;
      document.body.classList.remove('swarm-running');
      phase = 'done';
      stopLoop();
      updateHud();
    }, 700);
  }

  /* 用户主动跳过 / 可用性兜底：补全全部元素再收尾 */
  function skip() {
    if (phase === 'done') return;
    completeAll();
    finish();
  }

  /* 出错兜底：立刻恢复页面，绝不留白 */
  function abort() {
    stopLoop();
    completeAll();
    document.body.classList.remove('swarm-running');
    document.body.classList.add('swarm-done');
    stage.classList.add('is-fading');
    phase = 'done';
  }

  function replay() {
    stopLoop();
    clearTimeout(finishTimer);
    phase = 'idle';
    elapsed = 0;
    bootWall = performance.now();
    idleSec = 0;
    clickCount = 0;
    lastFrame = 0;
    ripples = [];
    stage.classList.remove('is-fading');
    document.body.classList.remove('swarm-done', 'swarm-running');
    resize();
    measure();
    resetTargets();
    const n = isMobile() ? CFG.agentsMobile : CFG.agentsDesktop;
    cursors = Array.from({ length: n }, (_, i) => new Cursor(i));
    document.body.classList.add('swarm-running');
    updateHud();
    phase = 'running';
    lastFrame = 0;
    lastStepAt = performance.now();
    schedule();
  }

  /* ------------------------------------------------------------ 启动 */
  function boot() {
    resize();
    measure();
    bootWall = performance.now();

    /* 无动画偏好、URL 指定跳过、或没有可建造元素 → 直接完成 */
    if (reducedMotion || hasFlag('skip') || targets.length === 0) {
      completeAll();
      document.body.classList.add('swarm-done');
      stage.classList.add('is-fading');
      phase = 'done';
      updateHud();
      return;
    }

    document.body.classList.add('swarm-running');
    const n = isMobile() ? CFG.agentsMobile : CFG.agentsDesktop;
    cursors = Array.from({ length: n }, (_, i) => new Cursor(i));
    resetTargets();
    updateHud();
    phase = 'running';
    lastFrame = 0;
    lastStepAt = performance.now();
    schedule();
  }

  /* resize 只刷新几何，不重建 targets —— 重建会丢进度/文字/HUD（QA #5）。
     尺寸为 0（文字正被清空）时保留旧值，避免把 w=0 写进 target。 */
  function remeasureGeometry() {
    const sy = scrollTop();
    for (const t of targets) {
      const r = t.el.getBoundingClientRect();
      t.x = r.left + window.scrollX;
      t.y = r.top + sy;
      if (r.width > 2) t.w = r.width;
      if (r.height > 2) t.h = r.height;
    }
  }

  window.addEventListener('resize', () => {
    resize();
    if (phase === 'running') remeasureGeometry();
  }, { passive: true });

  btnSkip?.addEventListener('click', () => skip());
  btnReplay?.addEventListener('click', () => replay());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (phase === 'running' || phase === 'finishing')) skip();
  });

  /* 暴露给自动化验证 */
  window.__swarm = {
    get phase() { return phase; },
    get built() { return builtCount; },
    get total() { return targets.length; },
    get agents() { return cursors.length; },
    get remaining() { return targets.filter((t) => !t.done).length; },
    get clicks() { return clickCount; },
    get pace() {
      return {
        travelSec: CFG.travelSec, clickSec: CFG.clickSec,
        typeSecPerChar: CFG.typeSecPerChar, typeMinSec: CFG.typeMinSec,
        typeMaxSec: CFG.typeMaxSec, boxSec: CFG.buildSec.box
      };
    },
    /* 仅供自动化验证：把某目标置为指定进度，返回当前可见文字 */
    probe(i, p) {
      const t = targets[i];
      if (!t) return null;
      setProgress(t, clamp(p, 0, 1));
      return { type: t.type, isTypewriter: !!t.isTypewriter, text: t.el.textContent };
    },
    /* 仅供自动化验证：光标在进度 p 时应落在哪（验证「绕框画方框」） */
    framePoint(i, p) {
      const t = targets[i];
      return t ? borderPoint(t, clamp(p, 0, 1), scrollTop()) : null;
    },
    replay, finish, skip
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
