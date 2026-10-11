---
title: "把 DSH 跑在自己机器上：Web 界面 + Tailscale 远程访问"
date: 2026-09-30
summary: "从零把 DeepSeek Harness(dsh) 的 Web 界面跑起来，用 systemd 让它常驻开机自启，再用 Tailscale 在手机、笔记本上安全访问——全程不开放任何公网端口。"
tags: ["DSH", "Tailscale", "systemd", "远程访问", "Linux"]
categories: ["折腾笔记"]
series: ["自建服务"]
weight: 1
cover:
  image: "/images/covers/dsh.svg"
  alt: "DSH + Tailscale 远程访问封面"
  relative: false
  hiddenInSingle: true
ShowToc: true
TocOpen: false
draft: false
images: ["https://blog.funnycode.site/og.png"]   # 分享预览图
---

我把自己的一台 Linux 机器（家宽、没有公网 IP）变成了随时随地能用的一台「工作机」：
上面跑 **DeepSeek Harness（dsh）** 的 Web 界面，用 **systemd** 保证它开机自启、崩了自己回来，
再用 **Tailscale** 组网，让手机和笔记本在外面也能直接打开它 —— **没有开任何公网端口，也没有买域名。**

这篇就把这套搭法从零写一遍。文中命令都在我自己的机器上跑过（Ubuntu 24.04 / Node v22.23.2 /
dsh 0.1.1-rc.2 / tailscale 1.102.3），把里面的 `100.x.y.z`、机器名、令牌换成你自己的就能照做。

## 目录

- [0. 五分钟快速开始](#0-五分钟快速开始)
- [1. 环境要求](#1-环境要求)
- [2. 安装 dsh](#2-安装-dsh)
- [3. 第一次启动 Web 界面](#3-第一次启动-web-界面)
- [4. 用 systemd 常驻 + 开机自启](#4-用-systemd-常驻--开机自启)
- [5. Tailscale：远程访问，不暴露公网](#5-tailscale远程访问不暴露公网)
- [6. 没有 root 也能玩：用户态模式](#6-没有-root-也能玩用户态模式)
- [7. 我踩过的坑](#7-我踩过的坑)

## 0. 五分钟快速开始

有 root 的普通 Linux 机器（Ubuntu/Debian 系）：

```bash
# 1) 装 dsh（全局）
npm i -g @deepseek-ai/dsh
dsh --version                 # 能打印版本号就算装好

# 2) 起 Web 界面（首次会自动初始化 profile，可能要装一会儿依赖）
dsh web --port 3080 --no-open

# 3) 按打印出来的地址在本机浏览器打开（默认 http://127.0.0.1:3080/）

# 4) 想常驻 + 开机自启：抄第 4 节的 systemd 单元

# 5) 想在外面访问：装 Tailscale，见第 5 节
```

## 1. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| 系统 | Linux x86_64 / arm64 | 我用的 Ubuntu 24.04，本文只覆盖 Linux |
| Node.js | **≥ 22** | 版本太低会在启动时报模块/语法错 |
| 包管理器 | npm 或 pnpm | profile 内部用的是 pnpm |
| 用户 | 一个**非 root** 账号（下文叫 `agent`） | 用 root 跑会因为 profile 目录属主混乱而 `EACCES` |
| 权限 | 建议有 `sudo` | 只为装 systemd 单元；没有 sudo 也能跑（见第 6 节） |
| 网络 | 能访问 npm registry | 首次启动要装 profile 依赖 |

`dsh` 的家目录默认 `~/.dsh`（可用 `DSH_HOME` 环境变量改）：

```
~/.dsh/
├── profiles/<名字>/     # 每个 profile 一套：package.json + cordis.patch.yml + node_modules
├── sessions/            # 会话记录
├── settings.yaml        # 全局设置
└── storages/  memory/  attachments/
```

## 2. 安装 dsh

```bash
npm i -g @deepseek-ai/dsh     # 或：pnpm add -g @deepseek-ai/dsh
dsh --version                 # 例：0.1.1-rc.2
dsh --help                    # launcher 自己的帮助
```

几个概念先弄清楚，能省掉后面一堆疑惑：

- **profile** = 一组插件包（bundle）+ 补丁层，按顺序叠成一棵树。`web`、`headless`、`sdk`、`acp` 是内置的几个。
- `dsh --profile <name>` 启动指定 profile；`dsh web` 就是 `dsh --profile web` 的别名。
- **launcher 只认自己的参数**（`--profile`、`--patch`、`--dump-config` 等）；它遇到第一个不认识的参数，
  后面的**全部**交给 profile 里的 App —— 所以 **Web 自己的参数必须写在 `dsh web` 之后**。
- `web` / `headless` / `sdk` / `sdk-minimal` / `acp` 首次使用时**自动初始化**（从自带模板装依赖）；
  其它名字的 profile 要自己用 `dsh plugin --profile <名字> ...` 建。

> 想从源码跑（开发用）：仓库根目录 `pnpm run build`，然后 `pnpm dsh <参数...>`。

## 3. 第一次启动 Web 界面

```bash
dsh web
```

首次启动会在 `~/.dsh/profiles/web/` 下初始化 profile 并安装依赖（等几分钟属正常）。起来后终端会打印：

```
dsh web: http://127.0.0.1:3080/ (LAN: http://192.168.x.y:3080/)
```

常用参数（**都写在 `dsh web` 后面**）：

| 参数 | 作用 |
|---|---|
| `--host <ip>` | 绑定哪张网卡。默认只绑回环（`127.0.0.1`），所以只有本机能访问 |
| `--port <n>` | 端口，例如 `3080` |
| `--trusted-host <ip>` | **信任围栏**：额外信任的访问来源地址，可重复。从别的机器访问时不加就会被打回 |
| `--no-open` | 不自动开浏览器（服务器上建议加） |
| `--help` | 看 Web App 自己的参数 |

### 3.1 从别的机器访问，要同时满足两件事

1. **绑定**：`--host` 绑到对方能打到的那张网卡的地址（不是回环）；
2. **信任**：把**你浏览器地址栏里用的那个地址**加进 `--trusted-host`。

本机自己用，默认就行：

```bash
dsh web --port 3080 --no-open
```

内网 / Tailscale 上访问，两个都要写：

```bash
dsh web --host 100.x.y.z --port 3080 --trusted-host 100.x.y.z --no-open
```

### 3.2 远程暴露就该配一个访问令牌

只靠 IP 信任围栏是不够的 —— 同一个内网里谁都能试。远程访问时建议开启**访问令牌门卫**
（页面、`/api`、WebSocket 全部挡在门卫后面）。我用的是 `@studyzy/dsh-web-remote-access`
这个插件，它同时解锁 `--host 0.0.0.0`：

```bash
dsh plugin --profile web add @studyzy/dsh-web-remote-access

# 令牌走环境变量（推荐，systemd 里也是这么放的）
DSH_WEB_TOKEN='换成你自己的长随机串' dsh web --host 0.0.0.0 --port 3080 --no-open
```

浏览器首次访问要带令牌：`http://<地址>:3080/?web_token=<令牌>`，
服务器校验后 302 到干净路径并下发会话 Cookie（`HttpOnly`），之后正常用即可。

> 不装这个插件也能远程 —— 用第 5 节的 `tailscale serve`（我最推荐），或者绑 tailnet 地址 + `--trusted-host`。

## 4. 用 systemd 常驻 + 开机自启

新建 `/etc/systemd/system/dsh.service`：

```ini
[Unit]
Description=DeepSeek Harness (web GUI)
After=network-online.target
Wants=network-online.target

[Service]
User=agent
WorkingDirectory=~
EnvironmentFile=-/etc/dsh.env          # 里面写 DSH_WEB_TOKEN=... （chmod 600）
ExecStart=/usr/bin/dsh web --host 0.0.0.0 --port 3080 --trusted-host 127.0.0.1 --no-open
Restart=on-failure
RestartSec=10
KillMode=mixed
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dsh
systemctl status dsh --no-pager
journalctl -u dsh -f          # 看日志（也会打印那行 dsh web: URL）
```

几个要点：

- **`ExecStart` 用绝对路径**（`which dsh` 查一下，通常是 `/usr/bin/dsh`）；
- 令牌别写进仓库：用 `EnvironmentFile`（`chmod 600`）；
- `User=` 要和 profile 目录的属主一致，否则 `EACCES`（见第 7 节）；
- 重启电脑后 systemd 自己拉起来，不用管。

## 5. Tailscale：远程访问，不暴露公网

Tailscale 是基于 WireGuard 的组网：你的设备之间点对点加密直连，地址形如 `100.x.y.z`，
不需要公网 IP、不用开端口、不用域名。**dsh 只要在这个网里，你的手机和笔记本就能访问它。**

### 5.1 安装（有 root 的机器）

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # 会打印登录链接，浏览器点开授权
tailscale ip -4              # 例：100.x.y.z
tailscale status             # 看网内都有谁
```

### 5.2 把 dsh 暴露给 tailnet（三种方式）

**A. `tailscale serve`（最推荐：dsh 仍然只听本机）**

```bash
sudo tailscale serve --bg https / http://127.0.0.1:3080
tailscale serve status       # 显示 https://<机器名>.<你的tailnet>.ts.net
```

之后在 tailnet 内任何设备打开那个 `https://…ts.net` 地址即可，证书由 Tailscale 自动签。
好处：dsh 不用绑 `0.0.0.0`、不用配信任围栏，公网也进不来。

**B. 直接绑 tailnet 地址**

```bash
dsh web --host 100.x.y.z --port 3080 --trusted-host 100.x.y.z --no-open
```

然后访问 `http://100.x.y.z:3080/`。

**C. 绑所有网卡 + 令牌门卫**（配 `@studyzy/dsh-web-remote-access`，见 3.2）

```bash
DSH_WEB_TOKEN='…' dsh web --host 0.0.0.0 --port 3080 --no-open
```

> 三种方式的差别：A 不暴露端口、最省心；B 简单直接；C 方便，但**一定要有令牌**。

### 5.3 从你的其它设备访问

在手机 / 另一台电脑上装 Tailscale 客户端，登录**同一个 tailnet**，然后：

- A 方式：浏览器打开 `https://<机器名>.<tailnet>.ts.net/`
- B / C 方式：浏览器打开 `http://100.x.y.z:3080/`（C 要带 `?web_token=…`）

### 5.4 自检两行

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/   # 本机应返回 200/302
tailscale status | head -5                                        # 对端应显示在线
```

## 6. 没有 root 也能玩：用户态模式

在**容器里、或没有 sudo 的账号**下，`tailscaled` 默认模式起不来 —— 它要建 TUN 设备（要 root）。
换成**用户态网络**就绕开了：普通用户就能跑。

```bash
# 1) 下静态包（版本按需换）
curl -fsSLO https://pkgs.tailscale.com/stable/tailscale_1.102.3_amd64.tgz
tar xzf tailscale_1.102.3_amd64.tgz && cd tailscale_1.102.3_amd64

# 2) 起守护进程（state 和 socket 都放自己的目录）
./tailscaled --tun=userspace-networking \
             --state=./state/tailscaled.state \
             --socket=./tailscaled.sock &

# 3) 登录（authkey 在 Tailscale 后台 Settings → Keys 生成）
./tailscale --socket=./tailscaled.sock up --authkey=tskey-auth-xxxxxxxx

# 4) 看地址
./tailscale --socket=./tailscaled.sock ip -4
./tailscale --socket=./tailscaled.sock status
```

要点与限制：

- **入站访问是通的**：tailnet 里别的机器可以直接访问本机的 `100.x.y.z:3080` ✅ —— 这正是我们要的方向；
- 本机**看不到虚拟网卡**，出站要走它自带的 SOCKS5/HTTP 代理
  （`--socks5-server=127.0.0.1:1055`、`--outbound-http-proxy-listen=127.0.0.1:1056`）；
- 所有 `tailscale` 子命令都要带 `--socket=` 指向你自定义的 socket，否则会找不到守护进程；
- 保活：有 root 就写个 systemd 单元；没 root 就写个 `while true; do 检查 & 拉起; sleep 30; done`
  的看门狗脚本，挂到你能用的常驻机制上。

保活用的 systemd 单元长这样（`/etc/systemd/system/tailscaled-user.service`）：

```ini
[Unit]
Description=Tailscale daemon (userspace networking, per-user install)
After=network-online.target
Wants=network-online.target

[Service]
User=agent
WorkingDirectory=~/tailscale
ExecStart=~/tailscale/tailscale_1.102.3_amd64/tailscaled \
  --tun=userspace-networking \
  --state=~/tailscale/state/tailscaled.state \
  --socket=~/tailscale/tailscaled.sock \
  --socks5-server=127.0.0.1:1055 \
  --outbound-http-proxy-listen=127.0.0.1:1056
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 7. 我踩过的坑

| 现象 | 原因 / 解法 |
|---|---|
| `EACCES: permission denied, open '…/profiles/web/cordis.yml'` | 用了和 profile 目录属主不同的用户跑（比如 root 跑过、之后换普通用户）。`ls -l ~/.dsh/profiles/web`，把属主改回来或换用户跑 |
| 页面打不开 / 一直转圈，日志说被信任围栏拦了 | `--trusted-host` 少了**你浏览器地址栏里那个地址**。走 Tailscale 就写 `100.x.y.z`，别写 `127.0.0.1` |
| `--host 0.0.0.0` 启动直接报错 | 新版本 CLI 拒绝全接口绑定：改用 `--host <具体IP>`，或加 `@studyzy/dsh-web-remote-access` 插件，或用 `tailscale serve` |
| 从 SSH 里启动没自动开浏览器 | 有意为之（SSH 转发场景下，浏览器该由你的 SSH 客户端负责）。用打印出来的 URL 手动开 |
| 改了端口 / 绑定没生效 | Web 参数必须写在 `dsh web` **后面**；写在前面会被 launcher 当成非法参数 |
| 端口被占：`EADDRINUSE` | `ss -ltnp \| grep 3080` 找出占用者，或换 `--port` |
| Node 版本太低启动就崩 | 升到 Node ≥ 22（`node -v` 确认） |
| 远程能连但一刷新就掉登录 | 令牌 Cookie 是会话级、`HttpOnly`，带 `?web_token=` 重新进一次即可 |
| 重启机器 dsh 就没了 | 没装 systemd 单元，或者单元没 `enable`：`systemctl is-enabled dsh` |

## 小结

这套组合的好处是**简单**：dsh 负责界面，systemd 负责常驻，Tailscale 负责「在哪都能连上」，
三者之间只有一个端口、一个令牌要管。机器在家、在外面一样用，公网上什么都看不到。

有 root 就用 `tailscale serve`；没 root 就用用户态模式 —— 两条路我都跑通了，
真正麻烦的从来不是技术，而是「信任围栏到底该写哪个 IP」这种细节：**写你地址栏里的那个地址。**

---

参考：`dsh --help`、`dsh web --help` 和安装目录里的 `@deepseek-ai/dsh/README.md`；
Tailscale 的 <https://tailscale.com/download> 与官方知识库（`serve` / `funnel` / auth key）。
