# Zotero Figure

在 Zotero 中提取 PDF 里的图、表和公式。

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure 可检测 PDF 中的图、表、独立公式、说明和表格脚注。PDF 读取、渲染和版面检测均在本机完成，所需模型已内置在插件中。

## 功能

- 在本机分析 PDF，不上传页面，也不在运行时下载模型。
- 在阅读器专用侧栏中查看结果、按类型筛选并跟踪分析进度。
- 复制、保存或贴出图片，修改说明或裁图区域，跳转到 PDF 页面，添加到笔记或删除结果。
- 在“PDF 图表库”中集中浏览多篇文献的结果，并按文库、文献、年份、分类、类型和说明关键词筛选。
- 批量分析选中的文献条目或 PDF 附件，并可将结果写入笔记或 Zotero 标注。
- 安装 Zotero PDF Translate 后翻译结果说明。
- 可选通过 SiliconFlow `Qwen/Qwen3.6-35B-A3B` 识别公式 LaTeX，在本机使用 KaTeX 渲染，并通过 Zotero 的 Monaco 编辑器复制、重新识别或修改源码。
- 创建带嵌入式 PNG 的 Zotero 笔记，点击图片可返回源 PDF。
- 可选将本地结果镜像为 Zotero 图片标注，以便同步和兼容其他插件。
- 界面支持英语、简体中文、意大利语和俄语。

## 环境要求

- Zotero 9。
- [最新版本](https://github.com/MuiseDestiny/zotero-figure/releases/latest)中的 Zotero Figure XPI。
- 仅公式 OCR 需要网络连接和 SiliconFlow API 密钥。

不需要 Java 或 `pdffigures2.jar`。

## 安装

1. 从最新 Release 下载 `zotero-figure.xpi`。
2. 在 Zotero 中打开“工具 > 插件”，选择“从文件安装插件”，然后选择 XPI。
3. 如果 Zotero 提示，请重启应用。

## 功能入口

- **PDF 阅读器：** 打开 PDF，点击左侧栏中的 Zotero Figure 图标，再选择“解析图、表和公式”。
- **图表库：** 打开“工具 > PDF 图表库”，集中浏览不同文献的结果；点击卡片可打开源 PDF。
- **批量处理：** 在文库中选中文献条目或 PDF 附件，右键打开 `PDF Figure >`，可进行分析、写入笔记或创建标注。
- **设置：** 打开 PDF Figure 设置页，可管理内置模型、标注同步和 SiliconFlow 公式 OCR；使用“转换已有公式”可处理所有文库中尚未缓存的公式。

## 隐私

PDF 解析、渲染、版面检测和本地结果存储均留在当前设备。除非开启标注镜像，本地结果不会使用 Zotero Sync。

公式 OCR 为可选功能。检查 API 密钥只会向 SiliconFlow 发送纯文本请求；识别公式时只发送公式 PNG 裁图，不会发送整页 PDF。密钥保存在本机 Zotero 偏好设置中，SiliconFlow 调用可能产生费用。

## 相关链接

- [版本发布](https://github.com/MuiseDestiny/zotero-figure/releases)
- [问题反馈](https://github.com/MuiseDestiny/zotero-figure/issues)
- [AGPL-3.0-or-later 许可证](../LICENSE)
