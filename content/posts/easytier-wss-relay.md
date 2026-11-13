---
title: "校园网封了 Tailscale，我用 EasyTier 走 WSS/443 从宿舍连回家"
date: 2026-11-13
summary: "学校校园网按 TLS 握手里的域名做过滤，tailscale.com 直接被掐，家里的机器又没有公网 IP。最后的办法是：自己那台云服务器当 EasyTier 中继，把隧道塞进 443 端口上的一个普通 HTTPS 路径里，域名还是我自己的。这篇是完整部署记录——中继和节点怎么装、Caddy 的 /et/ 路由怎么和 SNI 配合、easytier-guard 那道防火墙在挡谁，以及真正踩疼的几个坑。"
tags: ["EasyTier", "网络", "组网", "WSS", "Caddy", "校园网"]
categories: ["折腾笔记"]
series: ["自建服务"]
weight: 6
ShowToc: true
TocOpen: false
draft: false
cover:
  image: ""
  alt: "EasyTier WSS 中继组网"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]
---

> 本文由默认配置（服务器管理）整理。

我家里那台机器（跑博客、跑一堆自建服务的那台）没有公网 IP，之前一直靠 Tailscale 在外面连回去。
九月开学之后这件事突然不成立了：**宿舍的校园网连不上 Tailscale**。

不是慢，是根本连不上。手机流量下一切正常，切到校园 WiFi 就废。

这篇文章记录的是最后跑通的方案：**自己那台云服务器当 EasyTier 中继，隧道走 443 端口上的一个普通 HTTPS 路径**。
现在 `easytier-cli peer` 在这台家里机器上看到的是这样：

```
| ipv4        | hostname   | cost | lat(ms) | loss | tunnel | NAT            | version        |
|-------------|------------|------|---------|------|--------|----------------|----------------|
| 10.1.1.2/24 | homeserver | Local| -       | -    | -      | PortRestricted | 2.6.4-8428a89d |
| 10.1.1.1/24 | relay      | p2p  | 25.30   | 0.0% | wss    | PortRestricted | 2.6.4-8428a89d |
```

`tunnel` 那一列写着 `wss`，延迟 25 毫秒，丢包 0。这就是全部成果。

## 一、先搞清楚校园网到底封了什么

一开始我以为是 UDP 被封了。Tailscale 打洞靠 UDP，UDP 不通就退到 DERP 中继，中继再不通就彻底没戏。
按这个思路折腾了半天，全是白费力气。

真正该做的第一件事是**分层测**，而不是猜。四个探针，一个比一个精确：

| 探什么 | 命令 | 失败说明什么 |
|---|---|---|
| 控制面域名通不通 | `curl -m 8 -o /dev/null -w '%{http_code}\n' https://controlplane.tailscale.com/health` | DNS 或 TLS 层就不通 |
| 中继域名通不通 | `curl -m 8 -o /dev/null -w '%{http_code}\n' https://derp.tailscale.com/` | 备用路径也断 |
| UDP 出得去吗 | `nc -zvu 1.1.1.1 41641; echo $?` | 不通 → 打洞这条路直接没了 |
| 是域名被拦还是 IP 被拦 | `curl -m 8 --resolve example.com:443:<已知IP> https://example.com/` | IP 能通、域名不通 → **SNI 过滤** |

最后一条是关键。**SNI 是 TLS 握手时客户端明发的那一段"我要访问哪个网站"**，它在加密开始之前就发出去了，
所以中间设备不用解密就能看见，也就能照着名单拦。

校园网拦的就是这个名单。`controlplane.tailscale.com`、`derp.tailscale.com`，看见 `tailscale` 这个词就断。
包根本没出去，跟你用什么 NAT 穿透算法、版本多新、有没有 IPv6，一点关系都没有。

**这个结论直接决定了方案**：换一个"更好的 VPN"是没用的，只要它的域名里还带着被拦的词，一样死。
唯一能过的形状是 —— **隧道的 SNI 必须是一个我自己拥有、不在名单上的域名**。

## 二、为什么是 WSS over 443

确定了病因，选药就简单了。三条要求：

1. 走 443 端口 —— 全世界的网络都不敢随便封 443，封了半个互联网都没了。
2. 走 TLS —— 不然中间设备能看见内容，一样能拦。
3. 域名是我自己的 —— 比如 `funnycode.site`，看着就是一个正常网站。

同时满足这三条的东西叫 **WSS（WebSocket over TLS）**。它在网络看来跟"浏览器打开一个网页"没有任何区别：
同一个端口、同一种握手、同一张证书。区别只在握手完成之后，里面跑的不是网页，是隧道流量。

EasyTier 恰好支持 WSS 作为节点之间的传输方式。这就是选它的全部理由 —— 不是因为它比 Tailscale 强，
而是因为它允许我把隧道挂到**自己的域名 + 自己的 443** 上。

顺便说一句，这条路有个物理上限要先说清楚：**所有流量都要经过那台云服务器，而它只有 3 Mbps 上行**。
跑 SSH、开个面板、传个小文件很舒服；想在上面看视频、同步相册、拖 SMB 大文件，那就是自找罪受。
这一点我在动手前就跟自己确认过了，所以后面没为"怎么加速"浪费一分钟。

## 三、整体形状

```
iPhone / 笔记本（校园网）
        │
        │  WSS，443 端口，SNI = funnycode.site
        ▼
┌───────────────────────────────────────┐
│ 云服务器 funnycode.site                │
│                                        │
│  Caddy（443，正常网站也在这儿）         │
│    └─ handle /et/* → 127.0.0.1:11011   │
│                          │              │
│  easytier-core（中继）◄───┘              │
│    虚拟 IP 10.1.1.1                     │
└───────────────────┬───────────────────┘
                    │  加密隧道
                    ▼
┌───────────────────────────────────────┐
│ 家里 homeserver                        │
│  easytier-core（节点）                  │
│    虚拟 IP 10.1.1.2                    │
│    easytier-guard：只放行家庭成员        │
└───────────────────────────────────────┘
```

几个设计决定，都是被现实逼出来的：

- **中继和网站共用 443**，不额外开端口。云服务器的安全组我一个都没动。
- **EasyTier 自己的 WebSocket 监听只绑 `127.0.0.1:11011`**，公网碰不到它，只有 Caddy 能转发进去。
- **家里那台不监听任何端口**（`--no-listener`），它只主动往外连。
- **云服务器是"借道"的，不是"进门"的**。这条后面单独讲，是我花时间最多的地方。

## 四、SNI 和 Caddy 的 `/et/` 到底怎么配合

这一段是整个方案的核心，值得拆开讲。

浏览器（或者 EasyTier）连 `funnycode.site:443` 时，顺序是这样的：

```
① TCP 连到 443
② TLS 握手，ClientHello 里带 SNI = "funnycode.site"   ← 中间设备在这一步检查，放行
③ 握手完成，HTTP 请求发出去：GET /et/  Upgrade: websocket
④ Caddy 看见路径是 /et/，把它转给 127.0.0.1:11011
⑤ EasyTier 收到 WebSocket，隧道建立
```

关键在于 **② 和 ④ 是两层完全独立的东西**：

- **SNI 决定"能不能过审查"**。它只看域名，看不见路径。
- **路径决定"进来之后去哪"**。Caddy 按 `/et/*` 这条规则分流。

所以中间设备看到的是"这个学生在访问 funnycode.site"，跟访问这个博客的首页一模一样。
它既不知道路径是 `/et/`，也不知道里面跑的是隧道 —— 那部分在 TLS 加密里面。

Caddy 这边要加的规则就三行，放在 `funnycode.site` 那个站点块里：

```caddyfile
	# EasyTier 中继：WSS 入口，SNI=funnycode.site 可过校园网
	handle /et/* {
		reverse_proxy 127.0.0.1:11011
	}
```

Caddy 默认就会转发 WebSocket 的 `Upgrade` 头，不用像 nginx 那样手动加两行 `proxy_set_header`。

### 这里有个特别容易误判的地方

配完之后验证，会看到：

```bash
curl -o /dev/null -w '%{http_code}\n' https://funnycode.site/et/
# 400
```

**400 是对的，不是错的。**

因为 `curl` 发的是一个普通 GET，不是 WebSocket 握手。Caddy 老老实实把它转到了 11011，
EasyTier 收到一个"不是 WebSocket 的请求"，于是回了 400。

如果这里返回的是 **404**，说明 Caddy 那条 `handle` 根本没生效，请求落到别处去了。
如果返回 **502**，说明 Caddy 转发了，但 11011 上没人听 —— 中继没起来。

三个状态码对应三个完全不同的故障，别看到 400 就以为配错了。我第一次看到 400 的时候还去翻了半天日志。

## 五、装中继（云服务器）

### 5.1 拿二进制

版本 2.6.4。这里遇到第一个坑：**GitHub 的 release 资源下不下来**。

`github.com` 本身能打开，但真正的文件在 `release-assets.githubusercontent.com`，那台机器直接超时。
25 MB 的包下了七八次，每次都在几 MB 处断掉，`unzip` 报"找不到中央目录"。

解法是套一层镜像前缀，而且要在**目标机器上**跑（哪台能通因网络而异）：

```bash
cd /tmp
R="EasyTier/EasyTier/releases/download/v2.6.4/easytier-linux-x86_64-v2.6.4.zip"
curl -sSL -o et.zip "https://ghfast.top/https://github.com/$R"
unzip -q et.zip -d et
sudo install -m 755 et/easytier-linux-x86_64/easytier-core /usr/local/bin/
sudo install -m 755 et/easytier-linux-x86_64/easytier-cli  /usr/local/bin/
```

装好之后 `easytier-core --version` 应该打印 `2.6.4-8428a89d`。

家里那台**不用再下一次**，直接从这台 `scp` 过去就行，两个二进制一共 10 MB。

### 5.2 密钥

```bash
sudo mkdir -p /etc/easytier
openssl rand -base64 32 | tr -d '\n' | sudo tee /etc/easytier/secret  >/dev/null
openssl rand -base64 32 | tr -d '\n' | sudo tee /etc/easytier/privkey >/dev/null
sudo chmod 600 /etc/easytier/secret /etc/easytier/privkey
```

两个东西，作用完全不同：

- **`secret`（网络密钥）**：全网络共享，相当于"这个网络的入场券"。所有节点必须一模一样。
- **`privkey`（节点私钥）**：**每台机器自己一份，而且必须固定下来**。

`privkey` 这一条要划重点：如果每次启动随机生成，那么中继重启一次，公钥就变了，
任何 pin 了它公钥的客户端都会握手失败。症状是"中继明明在跑，节点就是连不上"，
而且重启一次好一次、再重启又坏 —— 非常难查。所以它是文件，不是每次现生成。

### 5.3 启动脚本

`/usr/local/bin/easytier-relay`：

```bash
#!/bin/bash
# EasyTier 中继（云服务器）
# 角色：转发密文 + 帮助打洞。持有网络密钥，但不持有家庭组密钥。
set -euo pipefail

SECRET="$(cat /etc/easytier/secret)"
PRIVKEY="$(cat /etc/easytier/privkey)"

exec /usr/local/bin/easytier-core \
  --network-name home \
  --network-secret "$SECRET" \
  --hostname relay \
  --ipv4 10.1.1.1 \
  --secure-mode true \
  --local-private-key "$PRIVKEY" \
  --listeners tcp://0.0.0.0:11010 \
  --listeners ws://127.0.0.1:11011 \
  --rpc-portal 127.0.0.1:15888 \
  --relay-network-whitelist home \
  -c /etc/easytier/relay.toml
```

逐条说人话：

| 参数 | 干什么 | 为什么这么设 |
|---|---|---|
| `--network-name home` | 网络名 | 名字对上才是一张网 |
| `--network-secret` | 网络密钥 | 从文件读，不写在脚本里 |
| `--ipv4 10.1.1.1` | 虚拟 IP | 中继固定占 `.1`，好记 |
| `--secure-mode true` | 端到端加密 | **中继自己解不开转发的流量** |
| `--local-private-key` | 固定身份 | 见上面那段，必须固定 |
| `--listeners ws://127.0.0.1:11011` | WebSocket 只绑回环 | 公网只能从 Caddy 进来 |
| `--rpc-portal 127.0.0.1:15888` | 管理接口只绑回环 | 这个接口能改配置，绝不能对外 |
| `--relay-network-whitelist home` | 只服务 home 这张网 | 不给自己揽别的活 |

`--listeners tcp://0.0.0.0:11010` 这个端口其实**是关着的** —— 云服务器安全组没放行，
从外面探测是 `CLOSED`。它留着是给同机或内网调试用的，实际对外只有 443 那一条路。

**这反而是好事**：整台机器的入口收敛成了"443 上的一个 HTTPS 路径"，攻击面和一台普通网站一样。

### 5.4 systemd

`/etc/systemd/system/easytier-relay.service`：

```ini
[Unit]
Description=EasyTier relay node (funnycode)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# 启动日志会打印网络密钥和私钥，压到 warn 避免落盘泄露
Environment=RUST_LOG=warn
ExecStart=/usr/local/bin/easytier-relay
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now easytier-relay
```

**`RUST_LOG=warn` 不是可选项。** easytier-core 默认在 INFO 级别把网络密钥和私钥原样打到 stdout，
而 stdout 会进 journald。也就是说，装完之后你的密钥就躺在 `journalctl` 里了，任何能读日志的人都能拿到。
这一行是必须的，不是优化。

## 六、装节点（家里那台）

`/usr/local/bin/easytier-home`：

```bash
#!/bin/bash
# EasyTier 家庭节点（homeserver）
# 角色：被访问目标（门卫）。ACL 默认拒绝，只放行 family 组。
set -euo pipefail

SECRET="$(cat /etc/easytier/secret)"
PRIVKEY="$(cat /etc/easytier/privkey)"

exec /usr/local/bin/easytier-core \
  --network-name home \
  --network-secret "$SECRET" \
  --hostname homeserver \
  --ipv4 10.1.1.2 \
  --secure-mode true \
  --local-private-key "$PRIVKEY" \
  --no-listener \
  --rpc-portal 127.0.0.1:15888 \
  --peers wss://funnycode.site:443/et/ \
  -c /etc/easytier/home.toml
```

跟中继的差别只有三处，但每一处都有意义：

- **`--peers wss://funnycode.site:443/et/`** —— 主动去连中继的 WSS 入口。
  **结尾那个斜杠不能少。** 少了 `wss://host:443/et` 握手会失败，而且报的错看着像 TLS 问题，
  会把人往证书方向带偏。
- **`--no-listener`** —— 不监听任何端口。家里这台永远只主动往外连，
  路由器和这台机器上都不需要任何入向规则。这一条跟"绝不在家开公网端口"是同一件事。
- **`-c /etc/easytier/home.toml`** —— 带一份 ACL 配置，这就是"门卫"。

家里的 systemd 单元跟中继一模一样，只把名字和 `ExecStart` 换掉：

```ini
[Unit]
Description=EasyTier node (homeserver)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=RUST_LOG=warn
ExecStart=/usr/local/bin/easytier-home
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

每加一台设备，`--ipv4` 往后递增（`.3`、`.4`、`.5`），`--hostname` 唯一。
目前 `.3` 是 iPhone，`.4` 是 Windows 笔记本，`.5` 是 Ubuntu 笔记本。

## 七、easytier-guard：中继能借道，但不能进门

这是我最在意的一块，也是唯一一处"除了 EasyTier 自己的机制之外还要自己动手"的地方。

### 问题在哪

先想清楚一件事：**中继也是这张网的一个成员**。它有虚拟 IP（10.1.1.1），
它能 ping 到 `10.1.1.2`，理论上也能直接连家里的 22、445、8080。

`--secure-mode` 解决的是"它读不懂内容"，不是"它碰不到你"。
即使它解不开加密的载荷，它照样能发一个 SYN 到你的 22 端口 —— 那是它自己发的，它知道内容。

所以安全边界不能建在中继上。**必须建在被保护的那一端，也就是家里这台。**

### 第一层：ACL（EasyTier 自己的）

`/etc/easytier/home.toml`：

```toml
# 家庭节点 ACL —— 门卫
# 关键：规则写在这台机器上，中继改不了

[acl.acl_v1.group]
members = ["family"]

# 组目录：用来验证别人声称的身份
[[acl.acl_v1.group.declares]]
group_name = "family"
group_secret = "<家庭组密钥>"

[[acl.acl_v1.group.declares]]
group_name = "relay"
group_secret = "<中继组密钥>"

[[acl.acl_v1.chains]]
name = "inbound_guard"
chain_type = 1        # 1 = 入站
description = "只允许 family 组访问本机"
enabled = true
default_action = 2    # 2 = 拒绝

[[acl.acl_v1.chains.rules]]
name = "allow_family"
priority = 1000
enabled = true
protocol = 5
action = 1            # 1 = 放行
source_groups = ["family"]
```

翻译一下：**默认拒绝一切入站，只放行自称属于 `family` 组的人。**

那中继呢？中继那边的配置是：

```toml
[acl.acl_v1.group]
members = ["relay"]

[[acl.acl_v1.group.declares]]
group_name = "relay"
group_secret = "<中继组密钥>"
```

它**只声明自己是 relay 组**，不声明 family。

这个不对称是关键：家里这台机器持有 `family` 和 `relay` 两个组的密钥（用来**验证**别人），
中继只持有 `relay` 一个。**中继手里没有 family 的密钥，所以它连"我是家庭成员"这句话都说不出来。**

而中转流量不受影响 —— 别人通过中继访问家里时，家里看到的源地址是对方的虚拟 IP，
不是中继的。所以放行 family、拒绝中继，两者互不干扰。

实测计数器（家里这台）：

```
InboundPacketsAllowed: 946250
InboundPacketsDropped: 11128
```

一个在涨，另一个也在涨。这就是"门卫真的在工作"的样子。

### 第二层：iptables（不信 ACL 也能挡）

ACL 是应用层的东西。配置写错一个字母、版本升级改了字段名、或者哪天有人把 `default_action` 改成 0，
门就开了，而且**没有任何提示**。

所以我又加了一道内核层的网。`/usr/local/bin/easytier-guard.sh`：

```bash
#!/bin/bash
# easytier-guard：让中继（云服务器）只能借道，不能访问本机任何服务
# 用法: easytier-guard.sh [接口] [apply|status|remove]
set -u

IF="${1:-tun0}"
CHAIN="ET-GUARD"

apply() {
  iptables -N "$CHAIN" 2>/dev/null
  iptables -F "$CHAIN"

  # 1) 已知家庭设备：放行（新增设备要在这里加一行）
  iptables -A "$CHAIN" -s 10.1.1.3/32 -j RETURN   # iPhone
  iptables -A "$CHAIN" -s 10.1.1.4/32 -j RETURN   # Windows 笔记本
  iptables -A "$CHAIN" -s 10.1.1.5/32 -j RETURN   # Ubuntu 笔记本
  # 中继(10.1.1.1)：只放行"回包"，自己发起的连接一律丢弃
  iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  # 2) 其余一律丢弃 —— 含中继 10.1.1.1 以及任何未知节点
  #    转发别人的包走 FORWARD 链，不受影响
  iptables -A "$CHAIN" -j DROP

  # 挂到 tun0 的 INPUT 上（只挂一次）
  iptables -C INPUT -i "$IF" -j "$CHAIN" 2>/dev/null || \
    iptables -I INPUT 1 -i "$IF" -j "$CHAIN"

  # 3) EasyTier RPC 端口只允许本机访问（防远程改配置）
  iptables -C INPUT -p tcp --dport 15888 ! -i lo -j DROP 2>/dev/null || \
    iptables -I INPUT 2 -p tcp --dport 15888 ! -i lo -j DROP

  # 4) 云服务器（tailnet 地址）不得主动连接本机任何服务
  #    只挡 NEW，已建立的回包/家里主动发起的连接不受影响
  iptables -C INPUT -m conntrack --ctstate NEW -s <云服务器的 tailnet 地址> -j DROP 2>/dev/null || \
    iptables -I INPUT 3 -m conntrack --ctstate NEW -s <云服务器的 tailnet 地址> -j DROP

  status
}
```

四段规则，每一段挡的是不同的东西：

**① 白名单 + 兜底 DROP**：只认识 `.3/.4/.5` 三台，其他一律丢。
这样即使中继被攻破、即使有人拿着网络密钥新加了一台节点（它会拿到一个新 IP），也进不来。
这比"只挡 10.1.1.1"强得多 —— 单挡一个地址，换个 IP 就绕过了。

**② conntrack 例外（这行最容易漏）**：如果只有白名单加 DROP，会把自己的路也切断。
家里这台主动去连云服务器上的服务（比如心跳接口）时，**对方回来的 SYN-ACK 也会被这条 DROP 吃掉**，
症状是连接永远建不起来，`tcpdump` 能看到 SYN-ACK 出去了、客户端还在重传 SYN。
`ESTABLISHED,RELATED` 只匹配"已经存在的连接"，所以别人的连接照样起不来，自己的回包能过。

**③ 15888 只准本机**：这个端口是 EasyTier 的管理 RPC，能改配置 —— 包括 ACL 链。
暴露出去等于把门卫的遥控器挂在门外。

**④ 挡住云服务器的 tailnet 身份**：这条是后来才想起来的。
那台云服务器上还跑着一个 Tailscale 容器，它有 `<云服务器的 tailnet 地址>` 这个地址。
也就是说，除了 EasyTier 这条路，它还有**另一扇门**能敲到家里。
只挡 `NEW`（新建连接），所以家里主动发起的连接不受影响。

第四段其实指向一个更大的道理：**你封了一条路，不等于封了所有路**。
做安全审计的时候要把那台机器上所有的网络身份都列出来，而不是只盯着刚装的那一个。

### 让它开机自动生效

iptables 规则只活在内存里，重启就没了。而这台机器没有 `netfilter-persistent`，所以用一个 oneshot 单元：

`/etc/systemd/system/easytier-guard.service`：

```ini
[Unit]
Description=EasyTier guard — keep the relay out of local services
After=network-online.target easytier-home.service
Wants=network-online.target easytier-home.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/easytier-guard.sh tun0 apply
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

`RemainAfterExit=yes` 让它在脚本跑完之后仍显示 `active (exited)` —— 这样它才是个"状态"，
否则 systemd 会认为它"跑完就结束了"，重启时不会重跑。

`After=easytier-home.service` 是因为脚本要往 `tun0` 上挂链，接口得先存在。

现在的实际状态：

```
$ iptables -S INPUT
-P INPUT ACCEPT
-A INPUT -i tun0 -j ET-GUARD
-A INPUT ! -i lo -p tcp -m tcp --dport 15888 -j DROP
-A INPUT -s <云服务器的 tailnet 地址>/32 -m conntrack --ctstate NEW -j DROP
```

三条都在，`ET-GUARD` 链挂在 INPUT 第一行。

## 八、网络名和密钥怎么管

装完之后 `/etc/easytier/` 里躺着五个文件，全是 `600 root:root`：

```
-rw------- family      # 家庭组密钥（家里这台持有，中继不持有）
-rw------- home.toml   # 家里的 ACL 配置
-rw------- privkey     # 本节点身份私钥（每台不同，固定不变）
-rw------- relaykey    # 中继组密钥
-rw------- secret      # 网络密钥（全网共享）
```

管理上有四条规矩，都是从上面那些道理推出来的：

**1. `secret` 一样，`privkey` 不一样。**
网络密钥是"入场券"，全网一份；节点私钥是"身份证"，每台一份且固定。

**2. 组密钥按"谁需要验证谁"来发，不是见者有份。**
家里这台要验证 family 和 relay 两种身份，所以它拿两个；
中继只需要声明自己是 relay，所以它只拿 relay 那一个。
**绝对不能把 family 的密钥给中继** —— 给了之后它就能宣布自己是家庭成员，门卫形同虚设。

**3. 网络名（`home`）不是安全措施。**
它只是个标签，防止误连到别的网络。真正的门槛是 `secret` 加 `secure-mode`。
别指望"名字没人知道"能挡住什么。

**4. 换密钥 = 全网一起换。**
`secret` 一改，所有节点都得同步改，否则连不上。这是个协调动作，不是改一个文件。
所以密钥生成一次就好好存着，别手贱去轮换。

顺便说虚拟网段的选择。一开始用的是 `10.144.144.0/24`（EasyTier 文档的示例网段），
后来改成了 `10.1.1.0/24`。理由：

- 必须是私有地址。有人会想用 `1.1.1.x` 这种"好记"的段 —— 那会让客户端以为整个 `1.1.1.0/24` 都在链路上，
  于是发往 `1.1.1.1` 的 DNS 查询全进了隧道，网直接废掉，而且没人会想到是 VPN 干的。
- 要避开家里的真实网段。我家是 `192.168.6.0/24`，所以 `10.x` 是安全的。
- 短。手机上要手输的地址，`10.1.1.2` 比 `10.144.144.2` 舒服太多。

**但改网段是一次"全网协同手术"，不是改个数字**：中继的 `--ipv4` 要改、家里的要改、
每一台客户端都要重新粘贴配置、每一个写了旧网段的 allowlist（Samba 的 `hosts allow`、
nginx 的 `geo` 映射、sshd 的 `Match Address`）都要跟着改。

我当时以为改完服务端就完了，结果手机还一直用旧地址发包，在 Samba 日志里表现为
`Denied connection from 10.144.144.3` —— 看着像 ACL 坏了，其实是客户端没跟上。
**这个网段选定之后就当它永久。** 想清楚再定，别改第二次。

## 九、怎么验证（别信 systemctl）

`systemctl is-active easytier-home` 返回 `active` 只证明**进程存在**。
进程活着但隧道没建起来、或者建起来了但服务拒绝新网段，它照样是 `active`。

按顺序做这三层，每一层证明的东西不一样：

### 第一层：隧道本身

```bash
easytier-cli peer
```

```
| ipv4        | hostname   | cost | lat(ms) | loss | tunnel | NAT            |
|-------------|------------|------|---------|------|--------|----------------|
| 10.1.1.2/24 | homeserver | Local| -       | -    | -      | PortRestricted |
| 10.1.1.1/24 | relay      | p2p  | 25.30   | 0.0% | wss    | PortRestricted |
```

看三列：`cost` 是 `p2p`（打通了）、`loss` 是 `0.0%`、**`tunnel` 是 `wss`**。
最后这一列最重要 —— 它证明流量真的走了 TLS 那条路，而不是别的什么回退路径。

### 第二层：三层可达

```bash
ip -br addr show tun0        # 10.1.1.2/24
ping -c 3 10.1.1.1
```

### 第三层：真实服务

```bash
nc -z -w3 10.1.1.1 22
ssh ubuntu@10.1.1.1 'echo $SSH_CLIENT'
```

最后这条要看到 `SSH_CLIENT` 里的源地址是 `10.1.1.2` —— 这才证明"整条路径通了"，
而不只是"握手成功了"。

如果 `nc` 通了但 `ssh` 报 `Permission denied`，那是密钥授权问题，不是隧道问题。**别去查 VPN。**

### 反向验证：门卫真的挡住了

光验证"能进"不够，还得验证"中继进不来"。从云服务器那边往家里探：

```bash
# 在云服务器上执行
nc -z -w3 10.1.1.2 22     # 应该失败
nc -z -w3 10.1.1.2 445    # 应该失败
```

以及看计数器：

```bash
# 在家里这台执行
easytier-cli acl stats
```

`InboundPacketsDropped` 应该在涨。**一个只在涨 Allowed、Dropped 永远是 0 的门卫，说明它谁都没拦。**

### 一个会骗人的现象

**`ping` 通不代表端口开着。**

EasyTier 在虚拟层里自己回答 ICMP，包根本没交给家里那台机器的内核。
所以中继可以 `ping 3 received` 全通，同时家里每一个 TCP 端口都拒绝它 ——
看起来像"防火墙没生效"，其实是 ICMP 走的是另一条路。

想确认，对比 `nstat -az | grep -E '^IcmpInMsgs'` 前后的值：没变，就说明主机内核根本没看见那个包。
**结论：ICMP 只证明"对方在线"，不证明任何可达性。端口探测才是证据。**

## 十、踩过的坑，一条条记

### 1. 400 不是错误，404 才是

上面说过了，再强调一次：`curl https://funnycode.site/et/` 返回 **400 = 配对了**。
400 说明请求到了 EasyTier，只是它不接受非 WebSocket。404 才是路由没生效。

### 2. `caddy reload` 在这台机器上永远是失败

这台 Caddy 的全局配置里有 `admin off`，管理 API 是关掉的。于是：

```
Error: sending configuration to instance: Post "http://127.0.0.1:2019/load":
connect: connection refused
```

而 `caddy validate` 会告诉你"配置有效" —— 于是你以为改好了，实际线上跑的还是旧配置，新路径一直 404。

**唯一的办法是 `systemctl restart caddy`**，代价是整站断 1～2 秒（博客、git、tasks、心跳全在这一台上）。
所以改 Caddyfile 是个"有代价的操作"，不是随手改改。流程固定成：

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)
# 改
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
# 然后必须同时检查老站和新路径
curl -o /dev/null -w '%{http_code}\n' https://funnycode.site/
curl -o /dev/null -w '%{http_code}\n' https://funnycode.site/et/
```

最后那两行是重点。**加一条路由是"动线上网站"，不是"装个软件"** ——
改完只看新路径通了就收工，是老站挂了都不知道。

### 3. `iptables -A` 写在 `-j RETURN` 后面是死规则

我第一版 guard 脚本是往链尾追加 DROP，结果前面有一条 `RETURN`，DROP 永远到不了。
而 `iptables -S` 仍然会把这条规则列出来 —— **规则存在，但什么也不做。**

看规则要从上往下读，确认执行顺序，别只确认"它在那儿"。

### 4. `--proxy-networks` 会把整个家庭网段送出去

这个参数的名字听起来很无辜（"代理网络"），实际效果是：**这张网里的每一个成员都能访问你家里的整个子网**，
包括中继。

我一开始为了"让某台设备能访问某个服务"加上了它，后来发现这是最不该开的东西 ——
那个服务本身已经有虚拟 IP 了，根本不需要导出整个网段。

现在已经删掉了，启动脚本里搜不到 `--proxy-networks`。

### 5. WireGuard 门户这条路我放弃了

EasyTier 有个 `--vpn-portal`，能在中继上开一个 WireGuard 服务端，让没有客户端的设备接进来。
iPhone 那会儿还没搞定原生 App，看起来是个好办法。

问题是：**门户的私钥和客户端列表都在中继上**。也就是说，拿到中继的 root 权限，
就等于拿到了一台合法的手机 —— 它可以给自己发一个门户地址，然后以"手机"的身份进来。

而 mesh 的 ACL 管不到它，因为门户客户端根本不参与 mesh 握手，**没有身份可供匹配，只有一个 IP，
而那个 IP 是中继自己发的**。

所以这个方案跟"云服务器必须进不了家里"直接冲突，放弃了。iPhone 最后装的是 EasyTier 官方 iOS 客户端，
它是一个正常的 mesh 节点，有自己的身份密钥和组身份，比门户那条路干净得多。

（顺便：那个 App 国区不上架，得用非国区 Apple ID 或者自己装 IPA。）

### 6. 卸载这件事，我做错过一次

有一次我说要"先把 EasyTier 删了"，结果是我自己误解了上下文 —— 那句话其实是在问"要不要停掉旧的 Tailscale"。
删完之后两台机器都断了，Caddy 的 `/et/` 也被我改掉，还顺手把心跳接口的 502 一起带出来了。

能恢复，是因为**备份里有二进制和 iptables 规则**，不只是配置文件：

```bash
/tmp/easytier-backup-homeserver-<时间>.tgz
/tmp/easytier-backup-funnycode-<时间>.tgz
```

这条教训值得单独写下来：**一个"配置文件备份"不叫备份。**
真正的状态还包括 `/usr/local/bin` 里的二进制（恢复时没有它，单元装好了也起不来）、
`iptables-save` 出来的防火墙规则（不恢复的话，网通了但门卫没了 —— 这是最坏的组合）、
以及被这次部署顺手停掉的其他服务。

所以现在的约定是：**动之前先 `iptables-save`，二进制一起打包，改 Caddyfile 之前先备份。**

### 7. 资源占用说实话

EasyTier 一个节点常驻大约 **34 MB** 内存，降不下去。

我之前给自建服务定的规矩是"常驻不超过 5 MB"，这套东西明显超标。
与其装完被问"怎么 34 MB"，不如先说：**这是这个产品的固有成本，不是配置问题。**
心跳监控那种用 systemd timer 的能做到空闲零占用，mesh VPN 做不到 —— 它得一直保持连接。

## 十一、现在的状态和它的边界

**已经在跑的**（都是实测过的）：

```
homeserver  10.1.1.2  running  开机自启  tunnel=wss  25.3ms  0% 丢包
relay       10.1.1.1  running  开机自启  /et/ → 400（正常）
easytier-guard  active(exited)  开机自启  ET-GUARD 挂在 INPUT
ACL  InboundPacketsAllowed 946250 / Dropped 11128
```

**它的边界，说清楚**：

- **速度上限是云服务器的 3 Mbps**。SSH、面板、小文件没问题；SMB 传大文件、看视频别想。
- **中继是这张网的一个成员**。它能知道谁在线、谁和谁通信、通信量多少 —— 这些元数据躲不掉。
  它读不懂内容（`--secure-mode`），也进不来（ACL + guard），但它知道你在连。
- **它不能替代 Tailscale 的全部功能**。没有 MagicDNS、没有子网路由的图形化管理、没有 exit node 那套东西。
  我现在是两套并存：Tailscale 走能通的网络（手机流量、家里 WiFi），EasyTier 专门对付校园网。
  两套网段不重叠（`100.64.0.0/10` 和 `10.1.1.0/24`），互不干扰。

**一条我到现在还没解决的问题**：家里那台如果重启，`tun0` 起来之前 guard 脚本会失败一次
（`After=easytier-home.service` 只保证"服务启动了"，不保证"接口已经就绪"）。
目前靠 systemd 的重试掩盖过去了，正确的做法是给 guard 加一个"等 tun0 出现"的循环。
这个还没改，记在这里。

---

最后说一句选型的感想。

这件事真正花时间的不是装软件，而是**搞清楚"到底哪一层被挡了"**。
如果一开始就去试 ZeroTier、试各种"更强的穿透"，我会在同一个坑里反复摔 ——
因为病因是 TLS 握手里的一个字符串，跟穿透算法毫无关系。

诊断清楚之后，方案几乎是自动浮现的：**把隧道伪装成一个普通的 HTTPS 网站，域名用自己的。**
剩下的都是体力活。

至于"能不能不经过任何第三方"，答案是不能 —— 家里没有公网 IP、校园网又封域名，
这两条加起来意味着必须有一台两边都能连到的机器做中转。
能做的只是把它的权限压到最小：**能借道，不能进门。**
