---
title: "小白也能搞定：装好 C 语言编译器，用 VS Code 写出第一个程序"
date: 2026-09-20
summary: "第一次学 C 语言卡住的往往不是语法，而是环境。这篇把 Windows 上装编译器（w64devkit）、配 VS Code、写出并跑通第一个程序的过程一次讲清楚。"
tags: ["C语言", "环境配置", "VS Code"]
categories: ["C 语言"]
ShowToc: true
TocOpen: false
draft: false
cover:
  image: "/images/covers/c.svg"
  alt: "C 语言环境配置封面"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]   # 分享预览图（SVG 封面不能当缩略图）
---
很多同学第一次学 C 语言，卡住的不是语法，而是**环境**：代码写完了，不知道按哪里才能跑起来。
这篇就把这件事一次讲清楚——从装编译器到用 VS Code 写代码，全部走一遍。

## 一、先搞明白：写 C 代码需要三样东西

| 你需要的 | 它是干嘛的 | 常见选择 |
| --- | --- | --- |
| **编辑器** | 让你打字写代码的地方 | VS Code（免费、最好用） |
| **编译器** | 把你写的代码翻译成电脑能跑的程序 | Windows 上用 MinGW-w64（就是 GCC） |
| **终端** | 敲命令、看编译结果的黑框框 | Windows 自带的 PowerShell |

一句话记住：**编辑器负责写，编译器负责翻译，终端负责执行**。
VS Code 只是编辑器，它本身不能编译 C 语言——所以必须先装编译器。

## 二、第一步：装编译器（Windows）

新手最省事的方案是 **w64devkit**（MinGW-w64 的便携打包版，免安装）：

1. 打开 <https://github.com/skeeto/w64devkit/releases>，下载 `w64devkit-x.y.z.zip`。
2. 解压到一个**路径里没有中文和空格**的地方，例如 `C:\w64devkit`。
3. 把 `C:\w64devkit\bin` 加进系统环境变量 **PATH**：
   开始菜单搜「环境变量」→ 编辑系统环境变量 → 环境变量 → 在「系统变量」里选中 `Path` → 编辑 → 新建 → 粘贴 `C:\w64devkit\bin` → 一路确定。
4. **重开一个** PowerShell，输入：

```powershell
gcc --version
```

能打印出 `gcc (GCC) 15.x.x` 之类的一行，就说明装好了。

> 如果提示「'gcc' 不是内部或外部命令」，99% 是 PATH 没配对，或者你没重开终端窗口。

## 三、第二步：装 VS Code 并配好

1. 去 <https://code.visualstudio.com/> 下载安装（一路下一步即可）。
2. 打开 VS Code，点左侧「扩展」图标（四个方块），搜索并安装：
   - **C/C++**（微软官方，代码补全、报错提示都靠它）
   - **Code Runner**（可选，一键运行当前文件）
3. 建议装个中文语言包：扩展里搜 `Chinese`，装 **Chinese (Simplified) Language Pack**，重启后界面就是中文了。

## 四、第三步：写出并运行第一个程序

新建一个文件夹，比如 `D:\code\hello`，用 VS Code 打开这个文件夹（**不是**直接打开单个文件，这样后面管理多个文件更方便）。

新建文件 `hello.c`，内容如下：

```c
#include <stdio.h>              // 引入标准输入输出库

int main(void) {                // 每个 C 程序都从 main 开始
    printf("Hello, C!\n");      // 在屏幕上打印一行字
    return 0;                   // 返回 0 表示正常结束
}
```

**怎么运行它？** 打开 VS Code 里的终端（菜单：终端 → 新建终端，或按 `Ctrl + \``），敲：

```powershell
gcc hello.c -o hello     # 把 hello.c 编译成 hello.exe
.\hello                  # 运行它
```

屏幕上出现 `Hello, C!` —— 恭喜，你的第一个 C 程序跑起来了。

## 五、新手最常见的几个报错

| 报错 | 原因 | 怎么修 |
| --- | --- | --- |
| `'gcc' 不是内部或外部命令` | PATH 没配好 | 检查 PATH，重开终端 |
| `undefined reference to 'main'` | 文件里没有 `main` 函数，或文件名写错 | 确认代码里有 `int main(void)` |
| `No such file or directory` | 文件名/路径不对 | 用 `dir` 看看当前目录里到底叫什么 |
| 中文输出变乱码 | 控制台编码不是 UTF-8 | 终端里先敲 `chcp 65001`，或把源文件存成 UTF-8 |

## 六、卡住了？让 AI 帮你排查（强烈推荐）

遇到看不懂的报错，把**报错原文 + 你的代码**一起丢给 AI（比如 DeepSeek），提问方式很重要：

> 我在 Windows 上用 gcc 编译 `hello.c`，报错如下：
> （粘贴完整报错）
> 我的代码是：
> （粘贴代码）
> 请用最简单的方式告诉我哪里错了、怎么改。

比「为什么我编译不过」这种问法有效得多。AI 不会替你写作业，但能帮你省下几小时的瞎折腾。

## 七、写完的代码怎么存？放进自己的 Git 仓库

代码放在自己电脑上，换台机器就没了，也容易被误删。建议一上手就用 Git 管起来：

1. 在 Gitea（自建 Git 服务，类似 GitHub）里新建一个仓库，得到类似 `http://你的服务器/zxq/hello.git` 的地址。
2. 在项目文件夹里初始化并提交：

```bash
git init
git add .
git commit -m "我的第一个 C 程序"
git branch -M main
git remote add origin http://你的服务器/zxq/hello.git
git push -u origin main
```

3. 以后每写完一点就 `git add . && git commit -m "说明" && git push`，代码就有了完整的历史记录。

## 八、小结

- **编辑器 ≠ 编译器**，VS Code 装完还得装编译器（MinGW-w64/GCC）。
- 练手最快的路径：装好 w64devkit → 配 PATH → VS Code 装 C/C++ 扩展 → `gcc hello.c -o hello` → `.\hello`。
- 报错不要慌，先看报错关键词，再带着代码去问 AI。
- 代码写完记得提交到 Git，养成习惯。

环境配好只是开始，接下来才是真正有意思的部分：变量、循环、指针、结构体……一个一个啃下去就好。
