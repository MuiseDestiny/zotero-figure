# Zotero Figure
> 一个基于 [PDFFigures2](http://pdffigures2.allenai.org/) 的 PDF 图表解析插件

<img src="addon/chrome/content/icons/favicon.png" width="36px" height="36px">

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-round&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![Latest release](https://img.shields.io/github/v/release/MuiseDestiny/zotero-figure)](https://github.com/MuiseDestiny/zotero-figure/releases)
![Release Date](https://img.shields.io/github/release-date/MuiseDestiny/zotero-figure?color=9cf)
[![License](https://img.shields.io/github/license/MuiseDestiny/zotero-figure)](https://github.com/MuiseDestiny/zotero-figure/blob/master/LICENSE)
![Downloads latest release](https://img.shields.io/github/downloads/MuiseDestiny/zotero-figure/latest/total?color=yellow)

## 演示
> 特别注意，本项目**不接受**图表解析错误的 issue，因为图表解析并非本插件的功能，本插件只是把 PDFFigures2 和 Zotero 连接起来


Windows 使用截图

![image](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/c04ef2f9-8ad2-44a3-a114-65b907028453)

Mac 使用截图

![c22463902d8d7ef699b00bd4bad4b7d](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/fba88e37-4aaa-491b-a2fa-85f6e1511b72)

贴图 / 独立窗口打开图表
![image](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/341cf5c5-db4b-4a64-a1f7-ae0d0b771619)


## 主要功能
> 默认输出图片 dpi 为 300


1. 单击图片，复制图片到剪贴板，配合 [Snipaste](https://www.snipaste.com/) 粘贴到屏幕
2. 双击图片，独立窗口预览，需要安装 [Zotero Better Notes](https://github.com/windingwind/zotero-better-notes) 插件
3. 单击图注跳转到 PDF 对应图位置

## 使用步骤

👋

1. 下载 [Zotero Figure](https://github.com/MuiseDestiny/zotero-figure/releases) 插件（xpi后缀文件），安装

![image](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/5f3cc96b-6cdc-4085-830d-001575d52f8e)

![image](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/a0117f49-cb31-455a-aea4-647305492d03)


2. 下载 [pdffigures2.jar](https://github.com/MuiseDestiny/zotero-figure/raw/bootstrap/pdffigures2.jar) 移动到 Zotero 储存目录下
> 下图点击`打开数据文件夹`，**这个文件夹不要有中文**，如果有中文建议重命名后，在首选项重新选择它

![打开数据文件夹](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/6b85cb30-0946-416e-99ed-9ea14f57f2df)

![文件夹下的jar](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/8e8c3af3-7850-4346-bd7f-d7ab6600b75e)

3. **安装** [java](https://www.oracle.com/java/technologies/javase/jdk18-archive-downloads.html)，配置 java 路径

|系统|输入示例|注意|
|--|--|--|
|Windows|`C:\Program Files\Common Files\Oracle\Java\javapath\java.exe`|路径两侧不要有引号，且以 `java.exe`/`javaw.exe` 结尾，其中`javaw.exe`不显示cmd界面|
|Mac|`/usr/bin/java`||


![image](https://github.com/MuiseDestiny/zotero-figure/assets/51939531/ffb3c82a-7a34-46dd-9b14-64797ad2944b)



## 致谢
- [pdffigures2](https://github.com/allenai/pdffigures2) 
- [zotero-better-notes](https://github.com/windingwind/zotero-better-notes)

## 赞助

[Here](https://github.com/MuiseDestiny/zotero-reference#%E8%B5%9E%E5%8A%A9)


