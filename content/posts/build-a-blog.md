---
title: "零基础搭一个自己的博客：Hugo + GitHub Pages"
date: 2026-09-27
summary: "不买服务器、不花一分钱：Hugo 生成静态页面，GitHub Pages 托管，推上去就自动上线。附我踩过的几个坑。"
tags: ["建站", "Hugo", "GitHub Pages"]
categories: ["折腾记录"]
ShowToc: true
draft: false
cover:
  image: "/images/covers/site.svg"
  alt: "建站教程封面"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]   # 分享预览图（SVG 封面不能当缩略图）
---

## 一、为什么选这条路

写博客常见三种做法：WordPress 这类动态博客、Hexo/Hugo 这类静态博客、直接在平台上开号。我选静态博客，理由三条：

1. **不要服务器**：生成的是纯 HTML，托管在 GitHub Pages 上，免费。
2. **不怕丢**：文章是 Markdown，全在 Git 仓库里。
3. **打开快**：没有数据库和后台，访问的就是静态文件。

代价是：没有后台界面，写完要"推"一下才上线。

## 二、装 Hugo

Hugo 负责把 Markdown 变成网页，就一个可执行文件，不用配环境。

- Windows：`winget install Hugo.Hugo.Extended`
- macOS：`brew install hugo`

敲 `hugo version` 看到版本号就成（要 0.146 以上）。

## 三、建站、装主题

```bash
hugo new site myblog
cd myblog
git init
```

主题我用 PaperMod：把它的文件放进 `themes/PaperMod/`。站点名、菜单、首页那句话、深浅色都写在 `hugo.toml` 里，主题自带的示例照着改就行。

## 四、写第一篇文章

```bash
hugo new content posts/hello.md
```

每篇开头有一小段 front matter：

```yaml
---
title: "文章标题"
date: 2026-09-27
tags: ["随笔"]
draft: false
---
```

`draft: true` 是草稿，不会发出去。正文就是普通 Markdown：`##` 小标题、`**加粗**`、反引号包代码块。

本地预览：`hugo server -D`，浏览器开 http://localhost:1313 ，边写边看。

## 五、推到 GitHub、打开 Pages

建一个 public 仓库，把代码推上去：

```bash
git remote add origin https://github.com/<用户名>/<仓库名>.git
git branch -M main
git push -u origin main
```

然后到仓库 **Settings → Pages**，Source 选 **GitHub Actions**。

想做到"推送即上线"，再加一个工作流 `.github/workflows/hugo.yml`：装 Hugo、`hugo --minify`、把产物发布到 Pages。配一次，以后只管写。

## 六、绑自己的域名

1. 域名商那边加解析：`blog` 用 **CNAME** 指向 `<用户名>.github.io`；
2. 仓库 `static/CNAME` 文件里写你的域名（一行）；
3. 回 Pages 设置填 Custom domain，证书签好再勾 **Enforce HTTPS**。

顺序别反：**先改 DNS，再放 CNAME 文件**，反了站点会跳到一个还没生效的域名，打不开。

## 七、评论

想要评论区用 Giscus：评论存在 GitHub Discussions 里，不需要数据库。把 Giscus 的 GitHub App 装到你的仓库，再在评论模板里填仓库、repo-id、category-id。**App 不装，页面会报 `giscus is not installed on this repository`。**

## 八、踩过的坑

- **baseURL 写错**：Pages 地址带仓库名，写错会导致 CSS 加载不出来，页面裸奔。
- **别改文章文件名**：Giscus 按路径认讨论帖，改名旧评论就对不上了。
- **国内访问**：GitHub Pages 在国外，速度看运气；想稳就备案后放自己的服务器，或套 CDN。
- **`gh-pages` 分支别动**：那是自动生成的产物。

最后一句实话：搭站只要一个下午，难的是把第一篇写完。
