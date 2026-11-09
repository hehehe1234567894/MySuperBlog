(() => {
  "use strict";
  const l = document.getElementById("swarmStage"),
    r = document.getElementById("swarmCanvas"),
    L = document.getElementById("hudAgents"),
    m = document.getElementById("hudLayers"),
    z = document.getElementById("hudSkip");
  if (!l || !r) return;
  const e = r.getContext("2d"),
    y = !location.search.includes("forceanim") && matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.__SWARM_DEBUG = location.search.includes("debug");
  const _ = ["Ada", "Linus", "Grace", "Alan", "Margaret", "Ken", "Barbara", "Dennis", "Radia", "Guido", "Frances", "Bjarne", "Hedy", "Tim", "Katherine", "Edsger", "Joan", "Donald", "Sophie", "Niklaus", "Anita", "Brian", "Mary", "Rob"],
    w = ["#F24E1E", "#A259FF", "#1ABCFE", "#0ACF83", "#FF7262", "#FFC700", "#9747FF", "#E8467C", "#14AE5C", "#0D99FF", "#FF8A00", "#00B5CE"],
    u = "#0D99FF",
    C = 22,
    O = 8,
    k = 720,
    i = () => innerWidth < k,
    E = "M5.5 3.2 L5.5 19.6 L9.6 15.6 L12.2 21.4 L15.4 19.9 L12.8 14.2 L18.2 13.9 Z",
    o = (e, t) => e + Math.random() * (t - e),
    c = (e, t, n) => Math.max(t, Math.min(n, e)),
    v = e => e < .5 ? 4 * e * e * e : 1 - (-2 * e + 2) ** 3 / 2,
    N = e => 1 - (1 - e) ** 3,
    j = (e, t, n) => e + (t - e) * n;
  let s = 0,
    n = 0,
    d = 1;

  function g() {
    d = Math.min(devicePixelRatio || 1, 2), s = innerWidth, n = Math.max(innerHeight, 600), r.width = Math.floor(s * d), r.height = Math.floor(n * d), r.style.width = s + "px", r.style.height = n + "px", e.setTransform(d, 0, 0, d, 0, 0)
  }
  g(), addEventListener("resize", () => {
    g(), p()
  });

  function M(t, n, s, o) {
    const a = o || 1;
    switch (e.save(), e.scale(a, a), e.lineJoin = "round", t) {
      case "ibeam": {
        const s = "M3 1 H5.5 Q7.5 1 7.5 3.5 Q7.5 1 9.5 1 H12 M7.5 3.5 V17.5 M3 20 H5.5 Q7.5 20 7.5 17.5 Q7.5 20 9.5 20 H12";
        e.strokeStyle = "#fff", e.lineWidth = 3.6, e.lineCap = "round", e.beginPath(), e.moveTo(3, 1), e.stroke();
        const t = new Path2D(s);
        e.lineWidth = 3.6, e.strokeStyle = "#fff", e.stroke(t), e.lineWidth = 1.5, e.strokeStyle = n, e.stroke(t);
        break
      }
      case "cross": {
        const t = new Path2D("M7.5 1 V19 M1 10 H19");
        e.lineCap = "round", e.lineWidth = 3.6, e.strokeStyle = "#fff", e.stroke(t), e.lineWidth = 1.5, e.strokeStyle = n, e.stroke(t);
        break
      }
      case "pen": {
        const t = new Path2D("M12.4 5.6 L14.6 7.8 L9.2 13.2 L7 11 Z"),
          s = new Path2D("M1 1 L8.5 3.3 L12.4 5.6 L7 11 L3.3 8.5 Z");
        e.fillStyle = n, e.strokeStyle = "#fff", e.lineWidth = 1.4, e.fill(s), e.stroke(s), e.fill(t), e.stroke(t);
        break
      }
      default: {
        const t = new Path2D(E);
        e.fillStyle = n, e.strokeStyle = "#fff", e.lineWidth = 1.5, e.shadowColor = n, e.shadowBlur = 10, e.fill(t), e.shadowBlur = 0, e.stroke(t);
        break
      }
    }
    if (e.restore(), s && !i()) {
      e.save(), e.font = "600 10px ui-sans-serif, -apple-system, 'PingFang SC', system-ui, sans-serif";
      const a = e.measureText(s).width,
        t = 5,
        r = a + t * 2,
        c = 16,
        o = 14,
        i = 12;
      e.globalAlpha = .28, e.fillStyle = n, h(e, o, i, r, c, 4), e.fill(), e.globalAlpha = 1, e.fillStyle = n, e.fillText(s, o + t, i + 11.5), e.restore()
    }
  }

  function h(e, t, n, s, o, i) {
    e.beginPath(), e.moveTo(t + i, n), e.arcTo(t + s, n, t + s, n + o, i), e.arcTo(t + s, n + o, t, n + o, i), e.arcTo(t, n + o, t, n, i), e.arcTo(t, n, t + s, n, i), e.closePath()
  }
  let a = [];

  function p() {
    const e = [...document.querySelectorAll("[data-build]")];
    a = e.map((e, t) => {
      const s = e.getBoundingClientRect(),
        n = getComputedStyle(e),
        o = e.dataset.build;
      return {
        el: e,
        i: t,
        type: o,
        x: s.left + scrollX,
        y: s.top + scrollY,
        w: s.width,
        h: s.height,
        radius: parseFloat(n.borderRadius) || 0,
        text: (e.textContent || "").replace(/\s+/g, " ").trim(),
        font: `${n.fontWeight} ${parseFloat(n.fontSize)}px ${n.fontFamily}`,
        color: n.color,
        done: !1
      }
    }).filter(e => e.w > 2 && e.h > 2)
  }
  class A {
    constructor(e) {
      this.i = e, this.color = w[e % w.length], this.name = _[e % _.length], this.shapes = ["arrow", "arrow", "arrow", "ibeam", "cross", "pen"], this.shape = this.shapes[e % this.shapes.length];
      const t = e % 2 === 0;
      this.x = t ? -60 : s + 60, this.y = o(n * .1, n * .9), this.vx = 0, this.vy = 0, this.orbit = o(0, 240), this.spin = o(.6, 1.4), this.curl = o(-1, 1), this.speed = o(3.2, 6.4), this.force = o(.5, 1.1), this.task = null, this.hoverEl = null, this.press = 0, this.trail = []
    }
    takeTask() {
      if (t.waitCount <= 0) return !1;
      if (t.activeBuilders >= c(4 + Math.floor(t.vel / 700), 4, 9)) return !1;
      const l = window.scrollY || 0,
        a = l - 40,
        h = l + n,
        m = this.y;
      let r = null,
        d = 1 / 0,
        u = -1;
      for (let n = 0; n < t.taskQueue.length; n++) {
        const s = t.taskQueue[n];
        if (s.b.y > t.frontier) continue;
        const e = s.b.y,
          o = e >= a && e <= h ? 0 : e < a ? 1 : 2,
          i = o * 1e6 + (o === 1 ? a - e : e) * .6 + Math.abs(e - m) * .4 - (s.type === "outline" ? 5e5 : 0);
        i < d && (d = i, r = s, u = n)
      }
      if (!r) return !1;
      t.taskQueue.splice(u, 1), t.waitCount--;
      const s = r,
        e = s.b;
      return this.task = {
        type: s.type,
        b: e,
        phase: "travel",
        t: 0,
        dur: o(.3, .52) * (i() ? .7 : 1) / Math.max(1, t.tempo * .5),
        sx: this.x,
        sy: this.y,
        tx: 0,
        ty: 0
      }, s.type === "outline" ? (this.task.tx = e.x - 6, this.task.ty = e.y - 6, this.shape = "cross") : s.type === "type" ? (this.task.tx = e.x + 3, this.task.ty = e.y + e.h * .55, this.shape = "ibeam") : (this.task.tx = e.x + e.w * .5, this.task.ty = e.y + e.h * .55, this.shape = "pen"), e.claimed = !0, t.activeBuilders++, !0
    }
    idleDrift(e, t) {
      /* 用「屏幕坐标」漂移：滚动时光标不会被元素带出视口 —— 这是之前"乱"的主因 */
      this.homeScreen || (this.homeScreen = {
        x: o(s * .08, s * .92),
        y: o(n * .18, n * .82)
      });
      const i = t.time,
        r = i * (.28 + this.spin * .18) + this.orbit,
        c = 34 + 22 * Math.sin(i * .62 + this.orbit * .5),
        sy = window.scrollY || 0,
        d = this.homeScreen.x + Math.cos(r) * c,
        u = sy + this.homeScreen.y + Math.sin(r) * c,
        l = .05 * e;
      this.x += (d - this.x) * l, this.y += (u - this.y) * l, this.vx *= .9, this.vy *= .9
    }
    update(e, t) {
      if (t.phase === "gather") {
        this.gather && (this.x += (this.gather.x - this.x) * .1 * e, this.y += (this.gather.y - this.y) * .1 * e, this.pushTrail());
        return
      }
      if (this.task) {
        this.runTask(e, t), this.pushTrail();
        return
      }
      if (t.phase === "build" && !t.rushing) {
        if (this.takeTask()) return;
        this.idleDrift(e, t), this.pushTrail();
        return
      }
      this.flock(e, t), this.pushTrail()
    }
    runTask(e, t) {
      const n = this.task,
        s = n.b;
      /* 元素被滚出视口太远 → 放弃，退回队列 */
      const syNow = window.scrollY || 0;
      if (s.y + s.h < syNow - 380 || s.y > syNow + window.innerHeight + 380) {
        return this.abandonTask(t);
      }
      if (n.phase === "travel") {
        n.t = Math.min(n.t + e / (n.dur * 60), 1);
        const t = v(n.t);
        if (this.x = j(n.sx, n.tx, t), this.y = j(n.sy, n.ty, t), n.t >= 1) {
          if (n.phase = "act", n.t = 0, n.len = 0, n.type === "outline") {
            const e = i() ? .8 : 1.55;
            n.dur = c((.85 + (s.w + s.h) / 800) * e, .8, 3.6)
          } else if (n.type === "type") {
            const e = i() ? .8 : 1.55;
            n.dur = c(s.text.length * .03 * e, .7, 4)
          } else n.dur = i() ? 1 : 1.5;
          this.press = 1, ripples.push({
            x: this.x,
            y: this.y,
            r: 1.5,
            a: .5,
            c: this.color
          })
        }
        return
      }
      if (n.phase === "act") {
        if (n.t = Math.min(n.t + e / (n.dur * 60), 1), n.len = n.type === "type" ? v(n.t) : N(n.t), n.type === "outline") {
          const e = S(s, n.len);
          this.x = e.x, this.y = e.y, s.outline = n.len
        } else n.type === "type" ? (this.x = s.x + 3 + s.w * n.len, this.y = s.y + s.h * .55, s.typed = n.len) : (this.x = s.x + 12 + (s.w - 24) * n.len, this.y = s.y + s.h * .62 + Math.sin(n.len * 9) * 2.5, s.filled = n.len);
        n.t >= 1 && this.finishTask(t);
        return
      }
    }
    finishTask(e) {
      const n = this.task,
        t = n.b;
      n.type === "outline" ? t.outline = 1 : n.type === "type" ? t.typed = 1 : t.filled = 1;
      const s = t.type === "title" || t.type === "text" ? [t.outline, t.typed] : [t.outline, t.filled];
      s.every(Boolean) && !t.done && (t.done = !0, t.reveal = 1, e.built++, m.textContent = e.built), this.task = null, this.press = 0, e.activeBuilders = Math.max(0, e.activeBuilders - 1), this.shape = "arrow"
    }
    /* 元素被滚出视口 → 放弃这条任务，退回队列，避免在屏幕外偷偷画 */
    abandonTask(e) {
      /* 元素被滚过去了：直接算建完，不退回队列 —— 否则永远轮不到它，计数归不了零 */
      const t = this.task,
        n = t.b;
      n.outline = 1, n.typed = 1, n.filled = 1, n.done = !0, n.reveal = 1,
        n.done && e.built++, m.textContent = e.built,
        e.activeBuilders = Math.max(0, e.activeBuilders - 1),
        this.task = null, this.press = 0, this.shape = "arrow"
    }
    flock(e, t) {
      const i = t.flockTarget(),
        b = t.time,
        v = this.x - i.x,
        g = this.y - i.y,
        a = Math.hypot(v, g) || .01,
        u = v / a,
        l = g / a,
        M = Math.atan2(g, v),
        S = 150 * (1 + .18 * Math.sin(b * .55)),
        A = (this.orbit - 120) * .5,
        C = S * (1 + .3 * Math.sin(3 * M + b * .7)) + A,
        k = Math.tanh(Math.cos(b * .11) * 3),
        x = 300 * (.7 + this.spin * .2) * k,
        O = c((C - a) * 4, -2200, 1200),
        w = Math.min(1, Math.max(0, (a - C) / 600));
      let s = -l * x + u * O - l * this.curl * 400 * w,
        n = u * x + l * O + u * this.curl * 400 * w;
      const E = t.agents;
      let y = 0,
        _ = 0,
        o = 0;
      for (const e of E) {
        if (e === this) continue;
        const n = Math.hypot(e.x - this.x, e.y - this.y);
        if (n > 90) continue;
        const t = 1 - n / 90;
        y += e.vx * t, _ += e.vy * t, o += t
      }
      o > 0 && (s = s * .7 + y / o * .3, n = n * .7 + _ / o * .3);
      const j = Math.max(0, Math.hypot(this.x - i.x, this.y - i.y) - 180),
        p = this.speed * (1.3 + Math.min(3.2, j / 90)),
        f = Math.hypot(s, n);
      f > p && (s *= p / f, n *= p / f);
      let m = (s - this.vx) * 6,
        h = (n - this.vy) * 6;
      const r = this.force * (1.4 + Math.min(5, j / 50)),
        d = Math.hypot(m, h);
      d > r && (m *= r / d, h *= r / d), this.vx += m * e * .12, this.vy += h * e * .12, this.x += this.vx * e * .36, this.y += this.vy * e * .36
    }
    pushTrail() {
      this.trail.push({
        x: this.x,
        y: this.y
      }), this.trail.length > 12 && this.trail.shift()
    }
    draw() {
      if (!i() && this.task && this.task.phase === "act" && this.task.type === "outline" && (e.save(), e.globalAlpha = .15, e.strokeStyle = this.color, e.lineWidth = 1, e.setLineDash([3, 6]), e.beginPath(), e.moveTo(0, this.y), e.lineTo(s, this.y), e.moveTo(this.x, 0), e.lineTo(this.x, n), e.stroke(), e.restore()), this.trail.length > 2) {
        e.save();
        for (let t = 1; t < this.trail.length; t++) e.globalAlpha = t / this.trail.length * .22, e.strokeStyle = this.color, e.lineWidth = 1.2, e.beginPath(), e.moveTo(this.trail[t - 1].x, this.trail[t - 1].y), e.lineTo(this.trail[t].x, this.trail[t].y), e.stroke();
        e.restore()
      }
      e.save(), e.translate(this.x, this.y), this.press > 0 && e.scale(.85, .85), M(this.shape, this.color, this.name, i() ? .72 : 1), e.restore()
    }
  }

  function S(e, t) {
    const s = e.w,
      o = e.h,
      i = 2 * (s + o);
    let n = t * i;
    return n < s ? {
      x: e.x + n,
      y: e.y
    } : (n -= s, n < o ? {
      x: e.x + s,
      y: e.y + n
    } : (n -= o, n < s ? {
      x: e.x + s - n,
      y: e.y + o
    } : (n -= s, {
      x: e.x,
      y: e.y + o - n
    })))
  }

  function x() {
    for (const t of a) {
      const n = t.outline === 0[0] ? 0 : t.outline,
        s = t.typed === 0[0] ? 0 : t.typed,
        o = t.filled === 0[0] ? 0 : t.filled;
      if (!n && !s && !o) continue;
      const i = t.type === "title" || t.type === "text";
      if (!i && n > 0) {
        if (e.save(), e.globalAlpha = .55 * n, e.fillStyle = "rgba(20,26,36,.94)", h(e, t.x, t.y, t.w, t.h, t.radius || 10), e.fill(), e.restore(), e.save(), n < 1 ? (e.strokeStyle = u, e.lineWidth = 2.2, e.shadowColor = u, e.shadowBlur = 8) : (e.strokeStyle = "rgba(148,163,184,.30)", e.lineWidth = 1), F(e, t, n), e.stroke(), e.restore(), n < 1) {
          const n = Math.round(t.w) + " × " + Math.round(t.h);
          e.save(), e.font = "600 10px ui-monospace, SFMono-Regular, monospace";
          const s = e.measureText(n).width;
          e.fillStyle = "rgba(13,153,255,.16)", h(e, t.x - 1, t.y - 19, s + 12, 16, 3), e.fill(), e.strokeStyle = "rgba(13,153,255,.45)", e.lineWidth = 1, h(e, t.x - 1, t.y - 19, s + 12, 16, 3), e.stroke(), e.fillStyle = u, e.textBaseline = "top", e.fillText(n, t.x + 5, t.y - 15.5), e.restore()
        }
        if (o > 0) {
          e.save(), e.globalAlpha = .75, e.strokeStyle = "rgba(148,163,184,.34)", e.lineWidth = 2.5, e.lineCap = "round";
          const n = 3,
            s = n * o;
          for (let o = 0; o < n; o++) {
            const i = t.y + 36 + o * 13;
            if (i > t.y + t.h - 8) break;
            const a = c(s - o, 0, 1);
            if (a <= 0) break;
            const r = (t.w - 22) * (.45 + .16 * o);
            e.beginPath(), e.moveTo(t.x + 11, i), e.lineTo(t.x + 11 + r * a, i), e.stroke()
          }
          e.restore()
        }
      }
      if (i && s > 0) {
        const i = Math.ceil(t.text.length * s),
          n = t.text.slice(0, i),
          o = parseFloat((t.font.match(/(\d+(?:\.\d+)?)px/) || [0, 16])[1]);
        e.save(), e.fillStyle = t.color, e.font = t.font, e.textBaseline = "top";
        const a = T(e, n, t.x, t.y, t.w, o * 1.35);
        if (s < 1 && Math.floor(performance.now() / 380) % 2 === 0) {
          e.fillStyle = u, e.globalAlpha = .9;
          const s = n.split(`
`),
            i = s[s.length - 1] || "",
            r = e.measureText(i).width;
          e.fillRect(t.x + r + 1, a, 1.8, o)
        }
        e.restore()
      }
    }
  }

  function F(e, t, n) {
    const s = t.w,
      o = t.h,
      a = 2 * (s + o);
    let i = n * a;
    e.beginPath(), e.moveTo(t.x, t.y);
    const r = [
      [t.x, t.y, t.x + s, t.y],
      [t.x + s, t.y, t.x + s, t.y + o],
      [t.x + s, t.y + o, t.x, t.y + o],
      [t.x, t.y + o, t.x, t.y]
    ];
    for (const [t, n, s, o] of r) {
      const a = Math.hypot(s - t, o - n);
      if (i <= 0) break;
      const c = Math.min(1, i / a);
      e.lineTo(t + (s - t) * c, n + (o - n) * c), i -= a
    }
  }

  function T(e, t, n, s, o, i) {
    let a = "",
      r = s;
    for (const s of t) e.measureText(a + s).width > o && a ? (e.fillText(a, n, r), a = s, r += i) : a += s;
    return a && e.fillText(a, n, r), r
  }
  const t = {
    agents: [],
    time: 0,
    phase: "intro",
    built: 0,
    total: 0,
    rushing: !1,
    startT: 0,
    activeBuilders: 0,
    taskQueue: [],
    userScrolled: !1,
    finishing: !1,
    idleTime: 0,
    frontier: 0,
    waitCount: 0,
    tempo: 1,
    vel: 0,
    lastSy: 0,
    flockTarget() {
      const e = this.time,
        t = window.scrollY || 0;
      return {
        x: s * (.5 + .28 * Math.sin(e * .37)),
        y: t + n * (.42 + .22 * Math.sin(e * .53 + 1))
      }
    },
    init() {
      p();
      const e = y ? 0 : i() ? O : C;
      this.agents = Array.from({
        length: e
      }, (e, t) => new A(t)), this.total = a.length, this.taskQueue = [];
      const t = i() ? n * 1.05 : 1 / 0;
      if (a.forEach((e, n) => {
          if (e.y > t) {
            e.outline = 1, e.typed = 1, e.filled = 1, e.done = !0, e.reveal = 1, this.built++;
            return
          }
          this.taskQueue.push({
            type: "outline",
            b: e,
            i: n,
            k: 0
          });
          const s = e.type === "title" || e.type === "text";
          this.taskQueue.push({
            type: s ? "type" : "fill",
            b: e,
            i: n,
            k: 1
          })
        }), this.taskQueue.sort((e, t) => e.i - t.i || e.k - t.k), this.waitCount = this.taskQueue.length, this.frontier = 0, this.lastSy = window.scrollY || 0, L.textContent = e, m.textContent = 0, y || e === 0) {
        document.body.classList.add("swarm-done"), l.remove();
        return
      }
      this.startT = performance.now(), document.body.classList.add("swarm-running")
    },
    skip() {
      this.rushing = !0, this.taskQueue = [];
      for (const e of a) e.done = !0, e.reveal = 1, e.outline = 1, e.typed = 1, e.filled = 1;
      this.built = this.total, m.textContent = this.built;
      for (const e of this.agents) e.task = null;
      this.toHandoff()
    },
    toHandoff() {
      if (this.phase === "gather" || this.phase === "ambient") return;
      this.phase = "gather";
      const e = window.scrollY || 0;
      for (const t of this.agents) t.gather = {
        x: s * .5 + o(-58, 58),
        y: e + n * .46 + o(-46, 46)
      }, t.task = null;
      document.body.classList.add("swarm-done"), setTimeout(() => {
        l.style.transition = "opacity .7s ease", l.classList.add("is-fading"), setTimeout(() => {
          l.remove(), document.body.classList.remove("swarm-running"), this.phase = "ambient"
        }, 760)
      }, 950)
    }
  };
  z?.addEventListener("click", () => t.skip());
  const D = () => {
    /* 只接管滚动控制权（停掉自动下滑），不强制收工 —— 否则一滚就结束，看不到建造 */
    t.userScrolled = !0
  };
  ["wheel", "touchmove", "keydown"].forEach(e => addEventListener(e, D, {
    passive: !0
  })), addEventListener("keydown", e => {
    e.key === "Escape" && (t.phase === "build" || t.phase === "intro") && t.skip()
  });
  let b = performance.now();

  function f(e) {
    try {
      R(e)
    } catch (e) {
      window.__SWARM_DEBUG && (document.title = "ERR:" + e.message + " | " + String(e.stack || "").split(`
`).slice(1, 3).join(" ")), console.error("[swarm]", e)
    }
    requestAnimationFrame(f)
  }

  function R(o) {
    if (!r.isConnected) return;
    const i = Math.min((o - b) / 16.67, 2.5);
    if (b = o, t.time += i / 60, e.clearRect(0, 0, s, n), t.phase !== "ambient") {
      const t = e.createRadialGradient(s * .5, n * .34, 0, s * .5, n * .34, Math.max(s, n) * .8);
      t.addColorStop(0, "#10151d"), t.addColorStop(1, "#07090d"), e.fillStyle = t, e.fillRect(0, 0, s, n)
    } else e.clearRect(0, 0, s, n);
    const l = window.scrollY || 0;
    if (e.save(), e.translate(0, -l), (t.phase === "build" || t.phase === "handoff") && x(), t.phase !== "ambient") {
      {
        for (const e of t.agents) e.update(i, t);
        for (const e of t.agents) e.draw();
        t.phase === "intro" && o - t.startT > 450 && (t.phase = "build");
        {
          const e = window.scrollY || 0,
            s = Math.max(i * .01667, .001),
            o = Math.abs(e - t.lastSy) / s;
          t.vel = Math.max(t.vel * Math.exp(-s * 1.2), t.vel * .7 + o * .3), t.lastSy = e, t.phase !== "intro" && (t.frontier = Math.max(t.frontier, e + n + 250)), t.tempo = c(2.1 + t.vel / 900 + t.taskQueue.length / Math.max(1, t.agents.length) * .5, 2.1, 4.5) * (t.userScrolled ? 1.6 : 1)
        }
        if (t.phase === "build" && !t.rushing && !t.userScrolled) {
          const s = document.documentElement.scrollHeight - n,
            e = window.scrollY || 0;
          if (e < s - 2) {
            const s = t.taskQueue.filter(t => {
              const s = t.b.y - e;
              return s + t.b.h > -30 && s < n + 30
            }).length;
            s === 0 && window.scrollBy(0, 620 * (i * .01667))
          }
        }
        if (t.phase === "build" && !t.rushing && !t.finishing)
          if (t.waitCount <= 0 && t.activeBuilders === 0) t.finishing = !0, setTimeout(() => t.toHandoff(), 300);
          else if ((window.scrollY || 0) + window.innerHeight >= document.documentElement.scrollHeight - 12 && t.activeBuilders === 0) {
            t.finishing = !0; setTimeout(() => t.toHandoff(), 400);
          }
          else if (t.userScrolled) {
          const e = window.scrollY || 0,
            s = t.taskQueue.filter(t => {
              const s = t.b.y - e;
              return s + t.b.h > -30 && s < n + 30
            }).length;
          s === 0 && t.activeBuilders === 0 ? (t.idleTime += i, t.idleTime > 240 && (t.finishing = !0, t.toHandoff())) : t.idleTime = 0
        }
      }
    } else {
      e.globalAlpha = 1;
      for (const e of t.agents) e.update(i, t), e.draw()
    }
    e.restore(), window.__SWARM_DEBUG && (document.title = `bp=${a.length} ph=${t.phase} built=${t.built} ag=${t.agents.length} st=${Math.round(t.startT)} now=${Math.round(o)}`)
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => {
    t.init(), requestAnimationFrame(f)
  }) : (t.init(), requestAnimationFrame(f)), window.__swarm = t
})()