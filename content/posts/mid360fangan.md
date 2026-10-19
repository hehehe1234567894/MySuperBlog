---
title: "关于将Mid360运用于RM的雷达上"
date: 2026-10-19
summary: "自己花了一段时间开始了解RM的大致规则并开始战队的雷达站开发，这是个人思路没有任何的技术可言"
tags: ["RoboMaster", "Mid360", "大疆"]
categories: ["折腾笔记"]
series: ["RoboMaster"]
weight: 4
ShowToc: true
TocOpen: false
draft: false
cover:
  image: ""
  alt: "Robomaster 激光雷达可行性"
  relative: false
  hiddenInSingle: true
images: ["https://blog.funnycode.site/og.png"]
---
RM的规则中写的是，雷达站自2025年起，可以采用无线电方案，但在此之前，不少战队受用3D雷达方案，但是我们战队依旧没有去实现3D激光雷达方案，依旧采用纯视觉，现在打算使用开发Mid360作为雷达方案

1. 使用3D激光雷达方案可以避免一些遮挡性问题
2. 战队的哨兵使用3D激光雷达，原先还有一个激光雷达安装于英雄上，鉴于英雄是四处移动的，可以避免想雷达一样只有一个静止地点，导致远处的点云出现问题，借鉴北理工的方案是使用双激光雷达，但是这样就意味成本上升
3. 哨兵和雷达信息是可以互通的，如此，可以实现哨兵决策信息更完整
