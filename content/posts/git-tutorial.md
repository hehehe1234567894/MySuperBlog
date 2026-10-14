---
title: "Git 从入门到理解原理：一篇写给自己的完整笔记"
date: 2026-09-21
summary: "先讲原理，再给命令手册，最后附常见报错对照表。搞懂「三个区域 + 四个对象 + 引用」之后，Git 命令就不用背了。"
tags: ["Git", "版本控制", "教程"]
categories: ["工具"]
ShowToc: true
TocOpen: false
draft: false
cover:
  image: "/images/covers/git.svg"
  alt: "Git 教程封面"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]   # 分享预览图（SVG 封面不能当缩略图）
---
这篇分两部分：**先讲原理**（搞懂了原理，命令就不用背），**再给命令手册**（按场景查就行）。
最后有一张「常见报错对照表」，收录了我自己踩过的坑。

---

## 一、Git 到底在解决什么问题

没有版本控制的时候，我们是这样干活的：

```
论文.docx
论文-修改版.docx
论文-修改版2.docx
论文-最终版.docx
论文-最终版-真的最终.docx
```

问题很明显：**不知道每一版改了什么、谁改的、为什么改**；想回到上周的样子只能靠记忆；多人协作更是灾难。

Git 解决的就是这件事：**它把"文件的每一次变化"变成一条条有记录、可回溯、可对比、可合并的历史**。

**关键认知**：Git 不是"网盘"，也不只是"把代码传到服务器"。它是一台**本地的时间机器** —— 你电脑上就有一个完整的仓库，断网也能提交、看历史、切分支；服务器只是用来同步和备份的另一个副本。

---

## 二、核心原理（理解这 6 点就够了）

### 1. 三个区域：工作区 → 暂存区 → 本地仓库

```
工作区（你正在编辑的文件）
    │  git add
    ▼
暂存区（staging area / index，准备提交的内容）
    │  git commit
    ▼
本地仓库（.git 目录，永久保存的历史）
    │  git push
    ▼
远程仓库（Gitea / GitHub）
```

**为什么要多一个"暂存区"？** 因为一次提交应该只包含一件完整的事。你改了 5 个文件，但其中 2 个属于"修 bug"、3 个属于"加功能"，可以分两次提交 —— 暂存区就是让你**挑着提交**的地方。

### 2. 一次提交 = 一个快照，不是"差异"

很多人以为 Git 存的是"改了哪几行"（像 diff 那样）。**不是。** Git 每次提交保存的是**当时所有文件的完整快照**（没变的文件只记录一个指针，不重复存储，所以很省空间）。

好处：切分支、回退版本极快，因为不需要"反向应用补丁"。

### 3. 提交连成一张图（DAG）

每个提交都记录着"我的父提交是谁"：

```
A ← B ← C ← D   (main)
         ↑
         E ← F   (feature)
```

这就形成了**有向无环图**（DAG）。分支合并，其实就是把两条线的历史接起来。

### 4. 分支只是一个"指针"（这是 Git 最妙的设计）

`main` 不是文件夹、不是副本，**它只是一个写着某个提交 ID 的文件**：

```bash
cat .git/refs/heads/main
# 输出：f2be902b1a... （40 个字符的 SHA-1）
```

所以创建分支是**瞬间**的（就是写一个 41 字节的文件）；这也是为什么 Git 鼓励你"随便开分支"。
而 `HEAD` 是另一个指针，指向"我现在在哪个分支上"。

### 5. 一切都是按内容寻址的（哈希）

`.git/objects` 里存着三种对象：

| 对象 | 存什么 |
|---|---|
| **blob** | 一个文件的内容 |
| **tree** | 一个目录的结构（文件名 → blob/tree） |
| **commit** | 一次提交：指向一个 tree + 父提交 + 作者 + 说明 |

它们的名字都是**内容的 SHA-1 哈希**。这意味着：

- 内容一样 → 哈希一样 → **只存一份**（省空间）
- 内容改一个字符 → 哈希完全不同 → **历史无法被悄悄篡改**（改一个字节，后面所有提交的 ID 都会变）

可以自己验证：
```bash
git cat-file -t HEAD          # 看 HEAD 是什么类型 → commit
git cat-file -p HEAD          # 看提交内容（树、父提交、作者、说明）
git cat-file -p HEAD^{tree}   # 看这个提交对应的目录
```

### 6. 分布式：每个人手里都是完整的仓库

克隆时，你拿到的是**全部历史**，不只是一个"当前版本"。所以：

- 断网也能提交、看 log、切分支
- 服务器挂了，任何一台克隆过的电脑都能重建整个仓库
- `push` / `pull` 只是"两个仓库之间同步提交"

---

## 三、动手：从零到第一次推送

### 0. 只做一次：配置身份和凭据

```bash
# 提交署名（会写进每一条提交记录）
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"

# 让 Git 记住密码（Windows 默认就有，Mac/Linux 按需）
git config --global credential.helper store     # 明文存，方便
```

> **技巧**：`--global` 影响所有仓库。想给某个仓库单独设身份（比如 Gitea 用一套、GitHub 用另一套），**去掉 `--global`**，在仓库目录里执行即可。

### 1. 两种开始方式

**方式 A：服务器上先建仓库，然后克隆下来**（推荐新手）
```bash
git clone http://你的服务器/zxq/my-repo.git
cd my-repo
```

**方式 B：本地已有文件夹，绑定到远程仓库**
```bash
cd 你的文件夹
git init                       # 让这个文件夹变成 Git 仓库（生成 .git 目录）
git add .
git commit -m "第一次提交"
git branch -M main             # 把默认的 master 改名成 main
git remote add origin http://你的服务器/zxq/my-repo.git   # 绑定远程仓库
git push -u origin main
```

> `-u` 的意思是"记住这次的上游分支"，以后直接 `git push` / `git pull` 就行。

### 2. 日常三步曲（90% 的时间只用这三条）

```bash
git add .                    # ① 把改动放进暂存区
git commit -m "说明这次改了啥"  # ② 提交到本地仓库
git push                     # ③ 同步到服务器
```

### 3. 写提交说明的规矩

好的说明长这样：`修复登录页在 Safari 下错位的问题`
差的说明：`update`、`修改`、`111`、`asdf`

**为什么重要**：三个月后你回头看历史，只有说明能救你。团队协作里，别人靠它判断你的改动要干什么。

---

## 四、命令手册（按场景查）

### 查看状态

```bash
git status              # 现在有哪些改动、哪些已暂存
git log --oneline       # 历史（一行一条）
git log --oneline --graph --all    # 带分支图的完整历史
git diff                # 工作区 vs 暂存区（还没 add 的改动）
git diff --staged       # 暂存区 vs 上次提交（马上要提交的内容）
git show 提交ID          # 看某次提交具体改了什么
```

### 分支

```bash
git branch                    # 列出本地分支（* 是当前分支）
git switch -c feature         # 新建并切到 feature 分支
git switch main               # 切回 main
git merge feature             # 把 feature 合并进当前分支
git branch -d feature         # 删除已合并的分支
git branch -M main            # 给当前分支改名（master → main）
```

### 撤销与回退（新手最需要，也最容易搞混）

| 我想…… | 命令 | 说明 |
|---|---|---|
| 放弃某个文件的**未提交**改动 | `git restore 文件名` | 恢复到上次提交的样子，**改了的内容会丢** |
| 把文件从暂存区拿出来 | `git restore --staged 文件名` | 改动还在，只是不准备提交了 |
| 修改**最后一次**提交的说明 | `git commit --amend -m "新说明"` | 只改说明/补文件，历史还是那条 |
| 撤销最后一次提交，**改动保留** | `git reset --soft HEAD~1` | 最安全，常用于"提交早了" |
| 撤销最后一次提交，**改动也丢掉** | `git reset --hard HEAD~1` | ⚠️ 危险，内容真没了 |
| 撤销一次**已推送**的提交 | `git revert 提交ID` | 生成一条"反向提交"，历史可追溯（团队场景用这个） |

**一句话记忆**：`restore` 动文件，`reset` 动历史（本地），`revert` 动历史（安全、可推送）。

### 远程

```bash
git remote -v                                  # 看当前绑定的远程地址
git remote set-url origin 新地址               # 换地址
git remote add origin 地址                     # 绑定（首次）
git fetch                                      # 只下载，不合并
git pull                                       # 下载 + 合并（= fetch + merge）
git pull --rebase                              # 下载后把自己的提交"接"在最上面（历史更干净）
git push                                       # 上传
git push -u origin main                        # 首次推送，并记住上游
```

### 忽略文件：`.gitignore`

在项目根目录建一个 `.gitignore`，一行写一个规则：

```
node_modules/
*.exe
*.o
.env
密码.txt
build/
```

被忽略的文件**不会**出现在 `git status` 里，也不会被提交。**密码、密钥、编译产物**都应该写进去。

### 临时保存：`git stash`

改到一半要切分支、又不想提交：

```bash
git stash          # 把当前改动先收起来（工作区变干净）
git switch main    # 去干别的事
git switch -c xxx
git stash pop      # 把收起来的改动拿回来
```

---

## 五、冲突：为什么会有、怎么解

**什么时候会冲突**：你和别人（或者你另一台电脑）**改了同一个文件的同一处**，Git 没法替你决定保留哪个。

**冲突长这样**：

```
<<<<<<< HEAD
这行是你当前分支的内容
=======
这行是对方分支的内容
>>>>>>> feature
```

**解决步骤**：

1. 打开文件，**手工改成你想要的样子**，把 `<<<<<<<`、`=======`、`>>>>>>>` 这三行标记**全部删掉**
2. `git add 这个文件`
3. `git commit`（或者 `git rebase --continue`）
4. 想放弃这次合并：`git merge --abort`

**心态**：冲突不是错误，是 Git 在提醒你"这里有两个人改动重叠了，需要人来判断"。每次冲突都是一次理解代码的机会。

---

## 六、常见报错对照表（踩过的坑）

| 报错 | 原因 | 解决 |
|---|---|---|
| `src refspec main does not match any` | 本地分支叫 `master`，却推 `main` | `git branch -M main` 再推 |
| `Please tell me who you are` | 没配身份 | `git config --global user.name/email` |
| `Updates were rejected ... fetch first` | 服务器上有你本地没有的提交 | `git pull --rebase` 后重新 `push` |
| `Permission denied (publickey)` | 公钥没加到平台，或用的不是那把私钥 | `ssh -T git@服务器` 自测，重新添加公钥 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | 服务器重装过，主机密钥变了 | `ssh-keygen -R 服务器IP`，再连一次输 `yes` |
| `Connection timed out`（SSH） | 端口被防火墙挡了，或 IP 被 fail2ban 封了 | 确认端口放行；让管理员解封 |
| `fatal: not a git repository` | 当前目录不是仓库 | `git init` 或 `cd` 到正确目录 |
| `nothing to commit` | 没有新改动（或没 `add`） | 先 `git status` 看看 |
| 推送要输密码 | 用了 HTTP 地址 | 用 SSH 地址，或把访问令牌写进 URL |

---

## 七、一张图记住全部

```
         ┌──────────────┐   git add    ┌──────────┐  git commit  ┌────────────┐
         │   工作区      │ ───────────► │  暂存区   │ ───────────► │  本地仓库   │
         │ (你编辑文件)  │ ◄─────────── │ (准备提交)│ ◄─────────── │  (.git)    │
         └──────────────┘  git restore └──────────┘  git reset   └─────┬──────┘
                                                                        │ git push
                                                                        ▼
                                                                 ┌────────────┐
                                                                 │  远程仓库   │
                                                                 │ (Gitea等)  │
                                                                 └────────────┘
                                                                        │ git pull
                                                                        ▼
                                                                   （回到本地）
```

**核心就一句话**：`add` 挑内容 → `commit` 存档 → `push` 同步；出问题用 `status` 看现场、用 `log` 看历史。

---

## 八、练习建议

1. 建一个仓库，把这篇笔记存进去，提交 3 次（每次改一点）
2. 新建分支 `test`，改点东西提交，再合并回 `main`
3. 故意制造一次冲突，把它解开
4. 用 `git reset --soft HEAD~1` 撤销一次提交，再重新提交
5. 用 `git cat-file -p HEAD` 看看提交对象长什么样 —— 你会对"原理"有实感

把这五步做完，Git 就算入门了。剩下的命令，用到再查就行。
