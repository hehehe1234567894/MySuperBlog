---
title: "Tailscale：把几台机器连成一张网，不用公网 IP 也不用开端口"
date: 2026-10-02
summary: "家里那台没公网 IP 的机器，怎么让外面的笔记本和手机直接访问它？Tailscale 把它变成一个虚拟局域网。这篇是我们本机的实测记录，包括没有 root 权限时用用户态模式跑的全部坑。"
tags: ["Tailscale", "组网", "WireGuard", "远程访问", "Linux"]
categories: ["折腾笔记"]
series: ["自建服务"]
weight: 2
ShowToc: true
TocOpen: false
draft: false
cover:
  image: "/images/covers/tailscale.svg"
  alt: "Tailscale 组网封面"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]
---

我家里那台 Linux 机器（就是跑这个博客和一堆折腾的那台）**没有公网 IP**。
以前想在外面访问它，要么端口转发 + DDNS，要么内网穿透，反正都挺烦。

现在不用了。Tailscale 把几台机器连成一张虚拟局域网，每台分一个固定 IP，
互相直接说话。**不开任何公网端口，不用买域名，不用动路由器。**

这篇是我们本机这套东西的记录。**大部分是实测的**——那台机器上的 Tailscale
现在就在跑着；**但有个很关键的前提**：它没有 root 权限，所以走的是用户态模式，
这部分坑特别多，我一条条写下来。文档上说、我没验过的，我会标出来。

## 它到底干了啥

一句话：**用 WireGuard 把你的设备连成一个私有网络。**

WireGuard 是个很轻的 VPN 协议。Tailscale 在它上面做了一层：帮你分配 IP、
帮你穿 NAT、帮你维护"谁是谁"，你只管登录。

对比一下老办法：

| | 端口转发 + DDNS | Tailscale |
|---|---|---|
| 要公网 IP | 要 | **不要** |
| 要动路由器 | 要 | 不用 |
| 要开端口给公网 | 要（有被扫的风险） | **不用，一个都不开** |
| 每台设备能互访 | 只能访问那一台 | 全网任意两台互通 |
| 证书 / 域名 | 自己搞 | 不需要 |

关键差别在最后：端口转发是"把一台机器暴露到公网"，Tailscale 是"把几台机器
圈进同一个房间"。后者安全得多 —— 对外网来说，你这几台机器**不存在**。

## 装 + 登录

各平台都有客户端，去官网下就行。Linux 上比较干净的是官方脚本：

```bash
# 在你的机器上执行
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

`tailscale up` 会打印一个链接，浏览器打开、登录（Google/GitHub/微软都行），
这台机器就进网了。

装完先看状态：

```bash
tailscale status        # 看网里有哪些机器、在线没有
tailscale ip -4         # 看自己这台分到的 tailnet IP（100.x.y.z）
tailscale netcheck      # 测网络环境：能不能打洞、走哪个中继
```

`netcheck` 特别值得跑一次，它能告诉你**能不能直连**。我这边跑出来是这样：

```
* UDP: true
* IPv4: yes, <我的公网出口>:51845
* Nearest DERP: 自建（放在我那台腾讯云机器上）
```

`UDP: true` 是好消息，说明有希望打洞直连。如果这里 `false`，那所有流量都得走
中继（DERP），速度和延迟都会差一截。

## MagicDNS：不用记 IP

Tailscale 会给每台机器一个名字，通常是主机名。开了 MagicDNS 之后，
你可以在任何一台设备上**直接用名字访问**另一台：

```bash
# 在任意一台已加入 tailnet 的机器上执行
ping <机器名>            # 直接 ping 名字
ssh <你的用户>@<机器名>   # 直接 ssh 过去
```

这比记 `100.x.y.z` 舒服太多。设备名可以在管理后台改，改完所有机器立即生效。

我之前有一台改过名的机器现在显示 `offline, last seen 1d ago` —— 这就是
`tailscale status` 的日常：一眼看出谁在线、谁是直的、谁要走中继。

## 子网路由：把整个局域网带进网

默认 Tailscale 只连"装了 Tailscale 的设备"。但有时候你想要的是一台设备背后
**整个局域网**——比如你装了 Tailscale 的机器连着家里网段 `192.168.1.0/24`，
想让外面的笔记本直接访问打印机。

这就是子网路由：

```bash
# 在"网关"那台机器上执行（要有 root / 要能改内核转发）
echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24

# 其它设备想用这条路由，要显式接受
sudo tailscale up --accept-routes
```

然后去管理后台把这台机器的子网路由**批准**一下（默认不生效，这是防误操作）。

**什么时候用**：家里有个 NAS、打印机、老设备不方便装 Tailscale，那用网关代理它们。
**什么时候不用**：如果每台设备都能装 Tailscale，就别搞子网路由，直接装更简单。

## `tailscale serve` 和 `funnel` 别搞混

这俩名字像，干的事差很远：

| | 谁能访问 | 用途 |
|---|---|---|
| `tailscale serve` | **只有 tailnet 内**（你自己的设备） | 把本机某个端口发给自己的设备 |
| `tailscale funnel` | **真·公网**（任何人） | 对外发布服务 |

```bash
# 只有你自己的设备能访问本机的 3000 端口
tailscale serve --bg 3000

# 给公网开放（谨慎！）
tailscale funnel 3000
```

我自己的用法是**只用 serve，不用 funnel**。比如本机跑了个面板，
`tailscale serve` 一下，在外面用手机就能打开，但外网扫不到。

> 说明：`serve` / `funnel` 这两个我**没有实测**（本机没有 root，跑不了）。
> 上面的用法来自官方文档。

## 重点：没有 root 的机器怎么跑

这是这篇最想写的部分，因为踩得最狠。

我这边的情况是：**普通用户，没有 sudo，内核也不让提权**。于是三个事情都做不了：

- 装系统包（apt 要 root）；
- 建 TUN 设备（`/dev/net/tun` 要 root）→ **默认的内核态模式用不了**；
- `systemctl` 管服务（要 root/polkit）。

好消息是 Tailscale 有个**用户态模式**，专门对付这种情况：

```bash
# 在你的机器上执行（普通用户就行）
./tailscaled \
  --tun=userspace-networking \
  --socks5-server=127.0.0.1:1055 \
  --outbound-http-proxy-listen=127.0.0.1:1056 \
  --statedir=/path/to/state \
  --socket=/path/to/tailscaled.sock
```

这就是我机器上真实的启动参数（从 `ps` 里抓的）。几个参数：

- `--tun=userspace-networking` —— **核心**。不要虚拟网卡，网络协议栈跑在用户态。
  普通用户就能跑，入站连接能通（别人能访问你）。
- `--socks5-server` / `--outbound-http-proxy-listen` —— 因为**没有虚拟网卡，
  你没法用常规方式访问别人**，得让程序走它自带的代理。这个下面细说。
- `--socket=` —— 客户端命令要和守护进程说上话，得指到同一个 socket。
- `--statedir=` —— 状态目录（**注意是 dir，不是 state，这是个大坑，见下**）。

客户端命令也要带上 socket：

```bash
./tailscale --socket=./tailscaled.sock status
```

### 用户态模式下的"出站"要绕一下

普通模式下，你 `ping 100.x.y.z` 直接就通了，因为有虚拟网卡在路由。

**用户态模式下没网卡，所以直接 ping 是不通的。** 要访问别人的服务，
得让程序走它给的代理：

```bash
# 实测可用：用 socks5 代理访问另一台机器上的服务
curl -s --socks5-hostname 127.0.0.1:1055 \
  -o /dev/null -w '%{http_code}\n' \
  http://100.x.y.z:8091
```

我自己就是这么访问服务器上那些内部面板的。

**这个限制要记住**：用户态模式下，**能进来的（入站）正常工作**，
**主动出去的（出站）得走代理**。所以它特别适合"把这台机器暴露给 tailnet 用"
这种场景 —— 正好就是我的需求。

### 保活：它是远程访问的生命线

用户态模式不是系统服务，守护进程挂了就没了。我写了个脚本管它，
还在系统里留了个 systemd 单元做兜底（`Restart=always`）。

这里有个**很值得学的坑**：系统里那个 systemd 单元的 `ExecStart` 写死指向一个
老路径的脚本，而那个路径在 `/etc` 下、我改不了。最后的解法很土但很好用：
**把那个老脚本换成一行转发**：

```bash
exec /bin/bash ~/DSH/tools/tailscale/ts-ensure.sh watch
```

于是监管链变成：systemd（开机自启、崩了自动拉）→ 我的脚本（每 15 秒体检）
→ tailscaled。不用 root 也拿到了 systemd 级的可靠性。

## 踩过的坑（都是真金白银）

### 1. `--state` 和 `--statedir` 是两个东西

这个最坑。`--state` 是**状态文件**路径，`--statedir` 是**目录**。
如果你写成 `--state=/某个目录`，tailscaled 会把目录当文件读写，
**读不到旧身份 → 节点变成新设备，要重新登录**。

```bash
# 错的
--state=~/DSH/tools/tailscale/state
# 对的
--statedir=~/DSH/tools/tailscale/state
```

### 2. state 目录 = 你的身份，丢了就要重登

节点私钥就在 `state/` 里。**别删、别外传、别提交到 git。**
我把它当成和 SSH 私钥一个级别的东西对待。

### 3. 守护进程抢不到端口不会报错，只会"半死"

tailscaled 如果发现 socks5 端口被占了，它**只打一行日志**然后继续跑：

```
SOCKS5 listener: listen tcp 127.0.0.1:1055: bind: address already in use
```

进程状态是 Running，看起来一切正常，**但代理没了**。这种半死状态极难发现。

所以我的脚本启动前会等端口空出来，启动后还会**显式复查 1055 真的绑上了没有**。

### 4. 别用 `pgrep -f` 找自己的进程

我用 `pgrep -f watchdog.sh` 找进程，结果**把执行这条命令的 shell 自己也匹配进去了**，
然后一条 `kill -9` 把自己的 shell 一起打死（日志里就是 `[killed by signal: SIGKILL]`）。

正确做法是读 `/proc/<pid>/cmdline`，要求 `argv[0]` 的 basename **正好**是 `tailscaled`，
并且跳过自己（`$$`）。

### 5. 健康检查超时别给太小

`tailscale status --json` 在机器被压住的时候可能超过 10 秒。超时太短会被判"不健康"，
看门狗就白重启一次守护进程。给到 20 秒，并且要求**连续失败 3 次**才重启。

## 排错

- **两个设备看不到对方** → 先 `tailscale status` 确认都在线；
  再看是不是被 ACL 拦了（默认同 tailnet 互通，但如果配过 ACL 就要检查）。
- **能连但很慢** → `tailscale ping <对方IP>` 看是 `direct` 还是 `via DERP`。
  走 DERP 就是中继，慢是正常的。我这边实测有一次：
  ```
  pong from <对方机器名> (100.x.y.z) via DERP(gz203) in 33ms
  direct connection not established
  ```
  —— 那次没打洞成功，走了自己在广州的中继，33ms 还能接受。
- **DNS 不生效** → MagicDNS 要在管理后台打开；用户态模式下 DNS 支持有限，这点要注意。
- **`tailscale ping` 不通但 `tailscale status` 正常** → 很可能你就是用户态模式，
  没有虚拟网卡。这是预期行为，改用 socks5 代理访问。
- **想临时断开所有入站** → `tailscale set --shields-up=true`，等于给自己套个盾，
  别人连不进来，你还能出去。

## 安全

- **默认同 tailnet 内互通。** 如果你把不该互通的设备放进同一个 tailnet，
  它们默认是能互相访问的。设备多了就该配 ACL 收紧了。
- **设备 key 有有效期。** 管理后台可以设自动过期时间，也可以关掉。
  建议开着，丢了设备也能自己失效。
- **`.state` 目录等于身份**，别外传。
- **只用 `serve`，别随手 `funnel`**。funnel 是真公网。

## 最后：它和自建服务是绝配

Tailscale 解决的是"我的机器互相看得见"，接下来自然会想把服务放进去。
我服务器上那些面板、博客都是**只绑 tailscale IP** 的：

```
LISTEN  100.x.y.z:8091           # 只有 tailnet 能访问
LISTEN  127.0.0.1:8091           # 本机可以
```

外网扫不到，自己随时随地能开。

顺着这个思路，我另一台东西是这么用的：**用 RustDesk 自建服务器做远程桌面**，
然后把它和这套 tailnet 配合起来 —— 需要看屏幕的时候用 RustDesk，
需要访问内部服务的时候走 tailnet。那篇在这里：
[用 RustDesk 自建远程桌面](/posts/self-host-rustdesk/)。
