---
title: "让 AI 直接运营 B 站账号：bilibili-mcp 部署与无头扫码登录"
date: 2026-10-26
summary: "想让 AI 帮我盯着账号数据、发动态、回评论，前提是它能调到 B 站接口。选了 bilibili-mcp，装在一台没有屏幕的服务器上，登录靠网页扫码解决。这篇是完整部署记录，重点是三个坑：没 root 装不了 venv、mcp 版本必须锁 1.x、以及扫码应答里那两层 code。"
tags: ["B站", "bilibili-mcp", "MCP", "AI 运营", "自建服务"]
categories: ["折腾笔记"]
series: ["自建服务"]
weight: 5
ShowToc: true
TocOpen: false
draft: false
cover:
  image: "/images/covers/bilimcp.svg"
  alt: "bilibili-mcp 部署与无头扫码登录封面"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]
---

我有个 B 站号，两年没动过，粉丝个位数。数据我懒得盯，评论没人回，选题想不出来。

想解决这事，最直接的办法是**让 AI 帮我干**——但 AI 得能真的调到 B 站接口才行，
不然它只能嘴上给我出主意。

所以这次折腾的目标很具体：**把 B 站的读写能力接进 AI 客户端**，让它能搜、能查数据、能发动态、能回评论。

## 选型：bilibili-mcp

搜下来有个现成的 [bilibili-mcp](https://github.com/adoresever/bilibili-mcp)，基于 Python 的 `bilibili-api-python` 封了一层 MCP 协议，提供 **27 个工具**：

| 类别 | 例子 |
|------|------|
| 发布 | 发动态、传视频（单P/多P）、发专栏 |
| 互动 | 回楼中楼、私信、查未读、看收到的回复和赞 |
| 数据 | 热门榜、周榜、分区榜、UP 主数据、稿件数据 |
| 采集 | 搜索、抓评论、拿字幕、拿弹幕 |
| 收藏 | 收藏夹列表、收藏夹内容 |

对我的场景来说够用了：**读的部分（调研、数据）和轻量写的部分（发动态、回评论）都能覆盖**。

部署包我自己整理了一份，把上游代码 + 实测修复 + 无头服务器登录方案打在一起。
下面讲的都是我自己那台机器上的真实情况：**Ubuntu 24.04 / Python 3.12.3**。

## 坑一：没 root，装不了 venv

第一条命令就卡住了。系统里 `python3` 有，但：

```
$ python3 -m venv venv
The virtual environment was not created successfully because ensurepip is not
available.  On Debian/Ubuntu systems, you need to install the python3-venv
package using the following command.
    apt install python3.12-venv
```

正常解法是 `sudo apt install python3.12-venv`，但我那台机器上 `sudo` 被
`no_new_privs` 标志挡住了，压根提不了权。

绕过去的办法是**先建一个不带 pip 的 venv，再自己把 pip 塞进去**：

```bash
python3 -m venv --without-pip venv      # 不要 ensurepip，先建出干净的解释器
curl -sSL -o get-pip.py https://bootstrap.pypa.io/get-pip.py
./venv/bin/python get-pip.py            # 用 venv 自己的解释器装 pip
```

装完 `./venv/bin/pip --version` 能正常打印就成。

顺带两个小坑：

- **pip 默认写 `~/.cache/pip`**，我当时被沙箱挡了，得显式挪走：
  `PIP_NO_CACHE_DIR=1 PIP_CACHE_DIR=<工作区内路径> TMPDIR=<工作区内路径>`
- **PyPI 直连慢得离谱**，换阿里云镜像立刻就好了：
  `-i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com`

## 坑二：mcp 版本必须锁在 1.x

上游 `requirements.txt` 里写的是 `mcp>=1.0.0`，这个范围**太宽了**。

PyPI 上的 mcp 2.x 已经把 `mcp.server.fastmcp` 这个旧 API 移除了，
装到 2.x 的话 `mcp_server.py` 直接起不来，报 import 错误。

所以部署包里我把依赖钉死了：

```txt
mcp==1.30.0          # 必须 <2
bilibili-api-python==17.4.2
aiohttp==3.14.5
qrcode==8.2
pillow==12.3.0
```

**凡是 `>=` 这种写法，装之前都值得怀疑一遍。** 这次要不是提前知道，能白折腾半小时。

## 坑三：扫码应答有两层 code

这个坑最阴险，也是我觉得最值得记一笔的。

B 站扫码登录是轮询式的：生成二维码拿到 `qrcode_key`，然后反复问「扫了没」。
应答长这样：

```json
{"code": 0, "message": "OK", "ttl": 1,
 "data": {"code": 86101, "message": ""}}
```

注意有**两个 `code`**：

- **外层 `code`** 恒为 `0`，意思是「这个接口调用成功了」，跟你扫没扫码**毫无关系**
- **`data.code` 才是真实状态**：`86101` 未扫码、`86090` 已扫待确认、`86038` 已过期、**`0` 成功**

上游的 `bili_login.py`（以及网上一堆教程）读的是**外层** code。
结果就是：你刚生成二维码，一查发现「code=0，登录成功！」——
然后把**空凭证**写进文件，后面所有调用全部报 `invalid literal for int()`，
查半天以为是凭证过期，其实是**从来就没拿到过**。

我在部署包里改成了读 `data.code`，另外加了三重保险：

1. 凭证从**响应 Cookie**、**会话 jar**、**data.url 的参数**三个地方兜着捞
2. 落盘之前必须先打一次 `nav` 接口验证 `isLogin` 和 `mid` 都有值
3. 验证不过就换一张二维码重来，绝不写空文件

## 没有屏幕怎么扫码

服务器没显示器，但登录服务会开一个**内网网页**：

```bash
./venv/bin/python login_service.py
```

然后在和服务器**同一个内网**的浏览器里打开 `http://<服务器IP>:8899/`，
页面上是一张二维码，过期自动换新，页面自己刷新。
手机 B 站 App 扫一扫、点确认，页面显示登录成功，脚本自动退出。

```json
{"logged_in": true, "uid": "1012932724", "username": "会电脑的喵", "message": "凭证有效"}
```

两个要注意的：

- **二维码只活 180 秒**（脚本按 168 秒就换新，留了余量）。发给别人扫的话动作要快。
- `login_service.py` 绑的是 `0.0.0.0:8899`，**公网机器务必先加防火墙**，
  或者干脆走 SSH 隧道：`ssh -L 8899:127.0.0.1:8899 服务器`。

## 凭证就是账号钥匙

登录成功会在本地生成 `bili_credential.json`，里面是 `SESSDATA`、`bili_jct`、
`DedeUserID` 这几个 cookie。

**它等价于你的账号**，拿到它就能以你的身份干任何事。所以：

- 权限设成 `600`
- 不要提交进 git
- 不要放进共享目录
- 过期了重新扫码就行，有效期通常几周到几个月

## AI 能干什么、不能干什么

工具能力是全的，但**能做不代表该做**。我自己划了三条线，写在给 AI 的指令里：

| | |
|---|---|
| ✅ 随便做 | 数据采集与分析、竞品/热门调研、盯账号指标 |
| ⚠️ 发之前问我 | 发动态（这条我放开了让它直接发）、起草回复 |
| ❌ 不许做 | 上传投稿、盗版资源分享、刷量、批量私信 |

第二条里的**视频投稿必须我点头**，是因为那玩意儿不可逆、影响面大；
动态我放开了，因为写错了删掉重发成本很低（B 站动态不能编辑，只能删）。

另外提醒一句：**新号别一天发太多**。平台风控对批量行为很敏感，
动态一天一两条、评论隔几分钟再发，像正常人一样用，比猛冲安全得多。

## 现在是什么状态

装完到现在跑了两天，实际用下来的感受是：

- **读的部分很爽**。想看某个话题下的高播放视频、想对比自己和同类账号的数据，
  一句话的事，不用再开一堆网页。
- **写的部分够用但要盯着**。它发的动态我会回读一遍确认真的上线了
  （图文动态的内容在接口的 `major.opus` 里，不在 `draw`，这个也踩过）。
- **它不会替我做决定**。选题、调性、要不要删旧稿，这些还是我拍板。

要说缺点：这套东西本质是**拿自己的账号 cookie 给 AI 用**，
所以接进来之前得想清楚你到底信任它到什么程度、愿意让它碰哪些操作。
我的答案是——**权限给到最小，不可逆的事永远自己确认**。

---

*部署包和踩坑记录我整理在自己的仓库里；本文里的命令都在一台 Ubuntu 24.04 上实测过。
少数没实测的地方我标出来了，有出入欢迎指正。*
