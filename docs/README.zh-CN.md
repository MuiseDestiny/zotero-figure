# Zotero Figure

在 Zotero 中本地解析 PDF 图、表和公式。

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure 通过 MuPDF WASM 在本机直接读取 PDF 附件，使用 DocLayout-YOLO 检测图片、表格、独立公式、说明和表格脚注，并在 PDF 阅读器的专用左侧栏中展示裁取结果。解析不要求阅读器已打开，PDF 页面和模型推理数据不会发送到远程服务。

> 检测模型可能出错。欢迎反馈插件崩溃、安装问题和可以稳定复现的集成缺陷；单纯的识别精度主要由模型能力决定。

## 功能

- 在本地检测 PDF 中的图片、表格和独立公式。
- 将最近的表格脚注合并到表格裁图和说明文字中。
- MuPDF WASM Worker 直接读取附件、提取页数和文字、生成 640 像素检测图，并按检测到的 PDF 坐标直接渲染高清 PNG；阅读器侧栏和后续主界面批处理共用同一份本地结果。
- XPI 内置优化版 Q8 模型，先按精确文件大小和 SHA-256 校验安装副本，再把已校验的模型字节传给 Worker，并在推理前再次校验 SHA-256。
- 在 Zotero 数据目录中，以 JSON 保存每个附件的结果索引，并以 PNG 保存裁取的图、表和公式。
- 重复解析时可按页替换本地旧结果，或保留已有结果并仅补充缺失项。
- 可取消长时间分析；正在推理时取消会终止相关 Worker，后续任务再重建。检测始终使用 640 像素渲染；缓存未命中的结果会直接按 PDF 坐标渲染，最长边目标 2400 像素、最高 6 倍且不超过 800 万像素，不再创建整页高清画布。
- 无可提取文本的页面也会进入检测，而不是被跳过；有文本的页面会使用完整的英文、中文、意大利文和俄文图表提示词来缩小检测范围。
- 以 PDF 阅读器左侧栏中的插件图标作为唯一主入口；顶部阅读器工具栏不再添加插件按钮。
- 结果卡片先按 PDF 页码、再按页面中的位置从上到下和从左到右排列，可按“全部”“图”“表”“公式”筛选；每个筛选项同时显示对应结果数量。本地 PNG 会在接近视口时通过可撤销的 Blob URL 懒加载，同时最多读取三张图片。
- 长图注默认折叠，点击图注即可展开或再次折叠。
- 直接在侧栏工具条中解析、取消、将全部结果加入笔记、刷新或清空本地结果。清空后侧栏立即变空，JSON 和 PNG 文件在后台删除，已有 Zotero 标注镜像不受影响。
- 阅读器解析进度直接显示在侧栏中，包括百分比进度条和已本地化的当前阶段文字，不再另弹进度窗口。
- 如果安装了 Zotero PDF Translate，可在工具条一键翻译结果说明，再次点击恢复原文；成功译文会按目标语言在本地缓存并复用。
- 可通过工具条按需将已有本地结果转换为 Zotero 标注镜像。
- 每张卡片都可复制、保存或贴出图片，修改说明、在整页预览中拖拽校正裁图区域、跳转到所在页、添加到笔记或删除。校正后会重新渲染高清 PNG，并在重复解析后保留。
- 可选把结果镜像为带有 `Figure N`、`Table N` 或 `Formula N` 标签的 Zotero 原生图片标注，并将说明写入评论；该选项默认关闭。
- 设置页只保留内置模型维护和可选标注同步；标注同步说明收纳在紧凑的问号悬浮提示中。
- 可把单张或全部结果写入 Zotero 笔记，图片作为真实的嵌入式 PNG 附件保存；即使没有创建标注镜像，点击笔记图片仍可跳转到源 PDF 中对应的裁图位置。
- 插件界面支持英语、简体中文、意大利语和俄语。

## 环境要求

- 仅支持 Zotero 9。
- [最新版本](https://github.com/MuiseDestiny/zotero-figure/releases/latest)中的 Zotero Figure XPI。

当前本地推理版本不再需要 Java 和 `pdffigures2.jar`。

## 安装与配置

1. 从最新 Release 下载 `zotero-figure.xpi`。
2. 在 Zotero 中打开“工具 > 插件”，选择“从文件安装插件”，然后选择 XPI。
3. 打开 PDF，点击阅读器左侧栏中的 Zotero Figure 图标并开始分析。插件会自动准备和校验内置模型，不需要单独下载模型。

## 内置模型

Zotero Figure 只内置一个模型：裁剪未使用输出后的 Q8 `optimized-q8-6c25a56c`，大小 19,505,323 字节，SHA-256 为 `6c25a56caf796a074e26def15eea9018686836155fd9e15e5e0950e9c08a4cac`。它完整保留插件实际使用的 `output0` 张量，并删除 7 个未使用的输出分支。插件会把它释放到 Zotero 数据目录的 `zotero-figure/models/`，并在分析前校验本地副本。

用户取得 XPI 后，不再需要访问 GitHub、Hugging Face 或其他模型站点。面向受限地区时，应把完全相同的 XPI 同时发布到 GitHub Release 和国内镜像，并核对两边 XPI 的 SHA-256 一致。

构建与镜像要求见[模型分发策略](MODEL_DISTRIBUTION.md)。

## 使用

1. 在 Zotero 阅读器中打开 PDF 附件。
2. 点击阅读器左侧栏中的 Zotero Figure 图标。顶部阅读器工具栏没有 Zotero Figure 按钮。
3. 点击侧栏工具条中的“解析图、表和公式”，等待页面渲染和检测完成。
4. 在“全部”“图”“表”“公式”之间切换，并通过卡片菜单复制、保存、贴出或校正图片、修改说明、跳转到所在页、添加到笔记或删除。
5. 如果安装了 Zotero PDF Translate，可点击语言按钮翻译结果说明，再次点击恢复原文。
6. 需要时可使用工具条中的“将全部结果保存到笔记”“刷新图表”或“清空本地结果”。清空只影响插件的本地 JSON 和 PNG，不会删除已有 Zotero 标注镜像。
7. 如果还需要 Zotero 同步标注，请在插件设置中勾选“解析后同时将结果同步写入 Zotero 图片标注”。该选项默认不勾选。
8. 批量处理时，在主界面选中一个或多个文献条目或 PDF 附件，右键使用“PDF Figure > 解析图、表和公式”“解析图、表和公式并写入笔记”或“解析图、表和公式并写入标注”。PDF 会逐个处理，不需要打开 Reader 标签页。

侧栏始终读取插件自己的本地结果仓库。每个 PDF 附件的元数据位于 Zotero 数据目录下的 `zotero-figure/results/<libraryID>/<attachmentKey>/manifest.json`，PNG 位于相邻的 `images/` 目录。schema v5 的 manifest 保存手动说明、手工裁图区域、按目标语言保存说明译文，并记录带版本的图片缓存身份。检测值会单独用于缓存匹配，因此手动说明和裁图校正在重复解析后都会保留；修改说明时会清除该结果的旧翻译缓存。重复分析时，只有附件源指纹（文件大小和修改时间；无法取得时回退为 Zotero 条目版本）、结果的分析版本、模型哈希、预览版本、结果指纹和当前裁图指纹都相同，且对应 PNG 仍存在，插件才会直接复用该 PNG。清单、翻译缓存和 PNG 都不使用 Zotero Sync。开启标注同步后，插件会额外创建一份原生标注镜像，用于同步和兼容其他读取标注的插件，但侧栏数据源不会改变。写入笔记的图片是嵌入式附件，不是指向本地 PNG 路径的链接；即使关闭标注镜像，点击笔记图片仍可跳转到源 PDF 中对应的裁图位置。

阅读器空闲时会提前准备 MuPDF、模型和 Worker；如果首次解析在准备完成前启动，仍可能较慢。耗时取决于 PDF 页数、页面复杂度、CPU 和可用内存。

解析期间最多同时调度三页。各个有界阶段分别限制为：最多两页进入检测、一个 MuPDF 渲染请求、一个高清局部阶段和一个存储操作。检测图最长边为 640 像素。缓存未命中的结果会逐个按 PDF 坐标直接渲染，最长边目标 2400 像素、最高 6 倍且不超过 800 万像素。两个持久 ONNX Worker 并发运行，每个固定一个推理线程；取消会终止受影响的 Worker，避免其继续占用 CPU。这样会复制一份 Q8 模型会话，但移除了原来的整页高清画布。内存分析见 [性能预算](PERFORMANCE.md)。

## 隐私

PDF 解析和渲染由内置 MuPDF WASM 完成，检测由 Zotero 内的 Transformers.js 和 ONNX Runtime Web 完成。插件不会把 PDF 页面发送到远程服务，也不会在运行时联网下载模型。

本地结果 JSON 和 PNG 会留在 Zotero 数据目录中。只有用户另行备份或同步该目录，或者主动开启 Zotero 标注同步以生成额外副本时，结果才可能离开当前设备。

## 开发

需要 Node.js 20.10 或更新版本。

```bash
npm install
npm run check
npm run build
```

常用命令：

| 命令                | 用途                                 |
| ------------------- | ------------------------------------ |
| `npm run build:dev` | 生成未打包的开发构建                 |
| `npm run build`     | 生成 `build/zotero-figure.xpi`       |
| `npm run typecheck` | 执行 TypeScript 检查                 |
| `npm run lint`      | 执行只读 ESLint 检查                 |
| `npm test`          | 运行领域逻辑、Worker 池和语言测试    |
| `npm run check`     | 运行全部质量门禁                     |
| `npm start`         | 构建、启动配置好的 Zotero 并监听文件 |

使用 `npm start` 前，将 `scripts/zotero-cmd-default.json` 复制为 `scripts/zotero-cmd.json`，并填写本机 Zotero 程序、配置目录和数据目录路径。

## 代码结构

| 路径                  | 职责                                     |
| --------------------- | ---------------------------------------- |
| `src/domain`          | 纯版面类型、文本重建与图注匹配           |
| `src/features`        | 阅读器界面、主界面批量操作与偏好设置     |
| `src/services`        | 附件解析、MuPDF 编排、推理与本地结果仓库 |
| `src/platform/zotero` | Zotero 阅读器和标注 API 的类型边界       |
| `src/utils`           | 本地化、偏好与工具包初始化               |
| `addon`               | 启动代码、翻译、Worker、图标与模型元数据 |
| `scripts`             | 构建、开发服务与质量检查                 |
| `tests`               | 可脱离 Zotero 运行的 Node 测试           |

领域逻辑应避免依赖 Zotero 全局变量。新增的 Zotero 私有 API 调用应集中到 `src/platform/zotero` 或单个功能适配器中，并使用尽可能窄的兼容类型。

## 现存不足

按优先级整理的完整清单见[现存不足与下一步修复清单](KNOWN_LIMITATIONS.md)。当前最重要的问题是扫描版 PDF 的图注提取、Zotero 阅读器私有 API 风险，以及真实 Zotero 9 端到端测试。

## 致谢与许可

感谢 [DocLayout-YOLO](https://github.com/opendatalab/DocLayout-YOLO)、[Transformers.js](https://github.com/huggingface/transformers.js)、[Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) 以及奠定本插件早期工作流的 [PDFFigures2](https://github.com/allenai/pdffigures2)。

本项目采用 [GNU AGPL v3.0 或更高版本](../LICENSE)。
