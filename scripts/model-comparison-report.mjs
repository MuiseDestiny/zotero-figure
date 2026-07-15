const SUBJECT_TYPES = new Set(["figure", "table"]);
const DEFAULT_MATCH_IOU = 0.3;

export function buildComparisonReport({
  docLayoutPages,
  metadata,
  zoteroPages,
}) {
  const pageCount = Math.max(docLayoutPages.length, zoteroPages.length);
  const pages = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const docLayout =
      docLayoutPages[pageIndex] ?? emptyDocLayoutPage(pageIndex);
    const zotero = zoteroPages[pageIndex] ?? emptyZoteroPage(pageIndex);
    const normalizedZotero = zotero.detections.map((detection) => ({
      ...detection,
      xyxy: pdfRectToNormalized(detection.rect, zotero.viewRect),
    }));
    const normalizedDocLayout = docLayout.detections.map((detection) => ({
      ...detection,
      xyxy: detection.xyxy.map(clamp),
    }));
    const comparison = compareDetections(
      normalizedDocLayout,
      normalizedZotero,
      DEFAULT_MATCH_IOU,
    );

    pages.push({
      comparison,
      docLayout: normalizedDocLayout,
      height: docLayout.height,
      image: docLayout.image,
      index: pageIndex,
      viewRect: zotero.viewRect,
      width: docLayout.width,
      zotero: normalizedZotero,
    });
  }

  return {
    metadata: {
      ...metadata,
      matchIouThreshold: DEFAULT_MATCH_IOU,
    },
    pages,
    summary: summarizePages(pages),
  };
}

export function renderComparisonHtml(report) {
  const serialized = JSON.stringify(report).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PDF 版面识别模型对比</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f5f2;
      --surface: #ffffff;
      --surface-muted: #ecefeb;
      --line: #cbd0ca;
      --text: #18201c;
      --muted: #616963;
      --doc: #d6473d;
      --doc-soft: #fff0ed;
      --zotero: #087d78;
      --zotero-soft: #e5f6f3;
      --table: #9b5b00;
      --shadow: 0 10px 28px rgb(24 32 28 / 8%);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }

    button, input { font: inherit; }

    .topbar {
      border-bottom: 1px solid var(--line);
      background: var(--surface);
    }

    .topbar-inner,
    .summary-inner,
    .workspace {
      width: min(1560px, calc(100% - 32px));
      margin: 0 auto;
    }

    .topbar-inner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding: 22px 0 18px;
    }

    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }

    .subtitle {
      margin: 7px 0 0;
      max-width: 920px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }

    .run-meta {
      flex: 0 0 auto;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
      text-align: right;
    }

    .summary-band {
      border-bottom: 1px solid var(--line);
      background: #e9ede8;
    }

    .summary-inner {
      display: grid;
      grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 1px;
      background: var(--line);
    }

    .metric {
      min-height: 92px;
      padding: 16px 18px;
      background: var(--surface-muted);
    }

    .metric-label {
      color: var(--muted);
      font-size: 12px;
    }

    .metric-value {
      display: block;
      margin-top: 8px;
      font-size: 26px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
    }

    .metric-detail {
      display: block;
      margin-top: 7px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }

    .workspace {
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr);
      gap: 18px;
      padding: 18px 0 32px;
    }

    .sidebar {
      align-self: start;
      position: sticky;
      top: 12px;
      max-height: calc(100vh - 24px);
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .sidebar-title {
      padding: 13px 14px;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      font-weight: 700;
    }

    .page-list {
      max-height: calc(100vh - 70px);
      overflow: auto;
    }

    .page-row {
      width: 100%;
      display: grid;
      grid-template-columns: 40px 1fr auto;
      align-items: center;
      gap: 8px;
      min-height: 45px;
      padding: 6px 10px;
      border: 0;
      border-bottom: 1px solid #ecefec;
      background: transparent;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }

    .page-row:hover { background: #f2f5f1; }

    .page-row[aria-current="page"] {
      background: #dfe8e2;
      box-shadow: inset 3px 0 0 var(--zotero);
    }

    .page-number {
      font-size: 13px;
      font-weight: 700;
    }

    .page-counts {
      color: var(--muted);
      font-size: 11px;
    }

    .agreement-badge {
      min-width: 38px;
      padding: 3px 5px;
      border-radius: 4px;
      background: #edf0ec;
      color: var(--muted);
      font-size: 10px;
      text-align: center;
    }

    .content { min-width: 0; }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
    }

    .toolbar-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .icon-button {
      width: 34px;
      height: 34px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      font-size: 19px;
      line-height: 1;
    }

    .icon-button:hover { background: #eef2ee; }
    .icon-button:disabled { cursor: default; opacity: 0.4; }

    .page-status {
      min-width: 96px;
      font-size: 13px;
      font-weight: 700;
      text-align: center;
    }

    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 8px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .toggle input { accent-color: var(--zotero); }

    .threshold {
      display: inline-grid;
      grid-template-columns: auto 120px 42px;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .threshold input { accent-color: var(--doc); }

    .model-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .model-panel {
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 48px;
      padding: 10px 13px;
      border-bottom: 1px solid var(--line);
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 700;
    }

    .model-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: currentColor;
    }

    .doc-color { color: var(--doc); }
    .zotero-color { color: var(--zotero); }

    .panel-count {
      color: var(--muted);
      font-size: 11px;
    }

    .page-stage {
      position: relative;
      width: 100%;
      overflow: hidden;
      background: #d8dcd8;
    }

    .page-stage img {
      display: block;
      width: 100%;
      height: auto;
    }

    .box {
      position: absolute;
      min-width: 2px;
      min-height: 2px;
      border: 2px solid currentColor;
      background: color-mix(in srgb, currentColor 9%, transparent);
      pointer-events: none;
    }

    .box.table { color: var(--table); }
    .box.caption { border-style: dashed; }

    .box-label {
      position: absolute;
      left: -2px;
      bottom: 100%;
      max-width: min(220px, 80vw);
      padding: 2px 4px;
      overflow: hidden;
      background: currentColor;
      color: #fff;
      font-size: 9px;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .details {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
      background: var(--surface);
    }

    .details-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
    }

    .details-header h2 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0;
    }

    .details-note {
      color: var(--muted);
      font-size: 11px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th, td {
      padding: 9px 12px;
      border-bottom: 1px solid #e7eae7;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #f1f3f0;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .text-cell {
      max-width: 520px;
      overflow-wrap: anywhere;
    }

    .empty-row {
      padding: 20px;
      color: var(--muted);
      text-align: center;
    }

    .methodology {
      margin-top: 14px;
      padding: 14px 16px;
      border-left: 4px solid #747c76;
      background: #e8ebe7;
      color: #485049;
      font-size: 12px;
      line-height: 1.6;
    }

    @media (max-width: 1100px) {
      .summary-inner { grid-template-columns: repeat(3, 1fr); }
      .workspace { grid-template-columns: 190px minmax(0, 1fr); }
      .model-grid { grid-template-columns: 1fr; }
    }

    @media (max-width: 760px) {
      .topbar-inner { display: block; }
      .run-meta { margin-top: 12px; text-align: left; }
      .summary-inner { grid-template-columns: repeat(2, 1fr); }
      .workspace { display: block; width: min(100% - 20px, 1560px); }
      .sidebar { position: static; max-height: none; margin-bottom: 12px; }
      .page-list { display: flex; max-height: none; overflow-x: auto; }
      .page-row { min-width: 118px; border-right: 1px solid #ecefec; }
      .toolbar { align-items: flex-start; }
      .threshold { grid-template-columns: auto 90px 36px; }
      .details { overflow-x: auto; }
      table { min-width: 720px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div>
        <h1>PDF 版面识别模型对比</h1>
        <p class="subtitle" id="subtitle"></p>
      </div>
      <div class="run-meta" id="run-meta"></div>
    </div>
  </header>

  <section class="summary-band">
    <div class="summary-inner" id="summary"></div>
  </section>

  <main class="workspace">
    <aside class="sidebar">
      <div class="sidebar-title">逐页结果</div>
      <div class="page-list" id="page-list"></div>
    </aside>

    <section class="content">
      <div class="toolbar">
        <div class="toolbar-group">
          <button class="icon-button" id="previous" title="上一页" aria-label="上一页">&#8592;</button>
          <span class="page-status" id="page-status"></span>
          <button class="icon-button" id="next" title="下一页" aria-label="下一页">&#8594;</button>
        </div>
        <div class="toolbar-group">
          <label class="toggle"><input type="checkbox" id="show-figures" checked>图像</label>
          <label class="toggle"><input type="checkbox" id="show-tables" checked>表格</label>
          <label class="toggle"><input type="checkbox" id="show-captions" checked>标题框</label>
          <label class="threshold">
            <span>DocLayout 置信度</span>
            <input type="range" id="threshold" min="0" max="1" step="0.01" value="0.10">
            <output id="threshold-value">0.10</output>
          </label>
        </div>
      </div>

      <div class="model-grid">
        <article class="model-panel">
          <div class="panel-header">
            <div class="panel-title doc-color"><span class="model-dot"></span>DocLayout-YOLO</div>
            <span class="panel-count" id="doc-count"></span>
          </div>
          <div class="page-stage doc-color" id="doc-stage"></div>
        </article>

        <article class="model-panel">
          <div class="panel-header">
            <div class="panel-title zotero-color"><span class="model-dot"></span>Zotero document-worker</div>
            <span class="panel-count" id="zotero-count"></span>
          </div>
          <div class="page-stage zotero-color" id="zotero-stage"></div>
        </article>
      </div>

      <section class="details">
        <div class="details-header">
          <h2>当前页检测明细</h2>
          <span class="details-note" id="agreement-note"></span>
        </div>
        <div id="details-table"></div>
      </section>

      <section class="methodology" id="methodology"></section>
    </section>
  </main>

  <script>
    const report = ${serialized};
    const state = {
      pageIndex: 0,
      showCaptions: true,
      showFigures: true,
      showTables: true,
      threshold: 0.10,
    };

    const elements = Object.fromEntries([
      "subtitle", "run-meta", "summary", "page-list", "previous", "next",
      "page-status", "show-figures", "show-tables", "show-captions", "threshold",
      "threshold-value", "doc-count", "zotero-count", "doc-stage", "zotero-stage",
      "details-table", "agreement-note", "methodology",
    ].map(id => [id, document.getElementById(id)]));

    function formatSeconds(milliseconds) {
      return (milliseconds / 1000).toFixed(1) + " s";
    }

    function formatPercent(value) {
      return Math.round(value * 100) + "%";
    }

    function typeLabel(type) {
      return ({
        figure: "图像",
        table: "表格",
        figure_caption: "图像标题",
        table_caption: "表格标题",
        caption: "标题",
      })[type] || type;
    }

    function visibleDetection(detection, model) {
      if (model === "doc" && detection.score < state.threshold) return false;
      if (detection.type === "figure") return state.showFigures;
      if (detection.type === "table") return state.showTables;
      return state.showCaptions;
    }

    function renderBox(detection) {
      const [left, top, right, bottom] = detection.xyxy;
      const box = document.createElement("div");
      const caption = detection.type.includes("caption") || detection.type === "caption";
      box.className = "box " + (detection.type === "table" || detection.type === "table_caption" ? "table " : "") + (caption ? "caption" : "");
      box.style.left = (left * 100) + "%";
      box.style.top = (top * 100) + "%";
      box.style.width = (Math.max(0, right - left) * 100) + "%";
      box.style.height = (Math.max(0, bottom - top) * 100) + "%";
      const label = document.createElement("span");
      label.className = "box-label";
      label.textContent = typeLabel(detection.type) + (detection.score == null ? "" : " " + detection.score.toFixed(2));
      box.append(label);
      return box;
    }

    function renderStage(stage, page, detections, model) {
      stage.replaceChildren();
      stage.style.aspectRatio = page.width + " / " + page.height;
      const image = document.createElement("img");
      image.src = page.image;
      image.alt = "PDF 第 " + (page.index + 1) + " 页";
      stage.append(image);
      for (const detection of detections.filter(d => visibleDetection(d, model))) {
        stage.append(renderBox(detection));
      }
    }

    function renderPageList() {
      elements["page-list"].replaceChildren();
      report.pages.forEach((page) => {
        const row = document.createElement("button");
        row.className = "page-row";
        row.setAttribute("aria-current", page.index === state.pageIndex ? "page" : "false");
        row.innerHTML = '<span class="page-number">P' + (page.index + 1) + '</span>' +
          '<span class="page-counts">D ' + countSubjects(page.docLayout) + ' / Z ' + countSubjects(page.zotero) + '</span>' +
          '<span class="agreement-badge">F' + page.comparison.matchedFigures + '/T' + page.comparison.matchedTables + '</span>';
        row.addEventListener("click", () => {
          state.pageIndex = page.index;
          render();
        });
        elements["page-list"].append(row);
      });
    }

    function countSubjects(detections) {
      return detections.filter(d => d.type === "figure" || d.type === "table").length;
    }

    function renderSummary() {
      const summary = report.summary;
      const metrics = [
        ["页面", summary.pageCount, "同一 PDF 的完整页数"],
        ["DocLayout 图像", summary.docLayoutFigures, summary.docLayoutFigureCaptions + " 个图注"],
        ["Zotero SDT 图像", summary.zoteroFigures, summary.zoteroFigureCaptions + " 个图注"],
        ["科研图像匹配", summary.matchedFigures, "IoU >= " + report.metadata.matchIouThreshold],
        ["表格框匹配", summary.matchedTables + " / " + Math.max(summary.docLayoutTables, summary.zoteroTables), "两侧均检测到 " + summary.docLayoutTables + " 个表格"],
        ["表格平均 IoU", formatPercent(summary.averageMatchedTableIou), "表格边界高度一致"],
      ];
      elements.summary.innerHTML = metrics.map(([label, value, detail]) =>
        '<div class="metric"><span class="metric-label">' + label + '</span><strong class="metric-value">' + value + '</strong><span class="metric-detail">' + detail + '</span></div>'
      ).join("");
    }

    function renderDetails(page) {
      const rows = [
        ...page.docLayout.filter(d => visibleDetection(d, "doc")).map(d => ({ ...d, model: "DocLayout-YOLO" })),
        ...page.zotero.filter(d => visibleDetection(d, "zotero")).map(d => ({ ...d, model: "Zotero SDT" })),
      ];
      if (!rows.length) {
        elements["details-table"].innerHTML = '<div class="empty-row">当前筛选条件下没有检测框</div>';
        return;
      }
      elements["details-table"].innerHTML = '<table><thead><tr><th>模型</th><th>类型</th><th>置信度</th><th>归一化坐标</th><th>关联文本</th></tr></thead><tbody>' +
        rows.map(row => '<tr><td>' + row.model + '</td><td>' + typeLabel(row.type) + '</td><td>' + (row.score == null ? 'n/a' : row.score.toFixed(3)) + '</td><td>' + row.xyxy.map(value => value.toFixed(3)).join(', ') + '</td><td class="text-cell">' + escapeHtml(row.text || '') + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function escapeHtml(value) {
      return value.replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
      })[char]);
    }

    function render() {
      const page = report.pages[state.pageIndex];
      const docVisible = page.docLayout.filter(d => visibleDetection(d, "doc"));
      const zoteroVisible = page.zotero.filter(d => visibleDetection(d, "zotero"));
      elements["page-status"].textContent = "第 " + (page.index + 1) + " / " + report.pages.length + " 页";
      elements.previous.disabled = page.index === 0;
      elements.next.disabled = page.index === report.pages.length - 1;
      elements["doc-count"].textContent = docVisible.length + " 个可见框";
      elements["zotero-count"].textContent = zoteroVisible.length + " 个可见框";
      elements["agreement-note"].textContent = "图像匹配 " + page.comparison.matchedFigures + "，表格匹配 " + page.comparison.matchedTables;
      renderStage(elements["doc-stage"], page, page.docLayout, "doc");
      renderStage(elements["zotero-stage"], page, page.zotero, "zotero");
      renderDetails(page);
      renderPageList();
    }

    elements.previous.addEventListener("click", () => {
      state.pageIndex = Math.max(0, state.pageIndex - 1);
      render();
    });
    elements.next.addEventListener("click", () => {
      state.pageIndex = Math.min(report.pages.length - 1, state.pageIndex + 1);
      render();
    });
    elements["show-figures"].addEventListener("change", event => { state.showFigures = event.target.checked; render(); });
    elements["show-tables"].addEventListener("change", event => { state.showTables = event.target.checked; render(); });
    elements["show-captions"].addEventListener("change", event => { state.showCaptions = event.target.checked; render(); });
    elements.threshold.addEventListener("input", event => {
      state.threshold = Number(event.target.value);
      elements["threshold-value"].textContent = state.threshold.toFixed(2);
      render();
    });

    elements.subtitle.textContent = report.metadata.pdfTitle + " | " + report.metadata.pdfPath;
    elements["run-meta"].innerHTML = "生成于 " + report.metadata.generatedAt + "<br>DocLayout " + formatSeconds(report.metadata.timings.docLayoutMs) + " / Zotero " + formatSeconds(report.metadata.timings.zoteroMs);
    elements.methodology.textContent = "本次结果：DocLayout-YOLO 生成 " + report.summary.docLayoutFigures + " 个图像框并识别 " + report.summary.docLayoutFigureCaptions + " 个图注；Zotero SDT 生成 " + report.summary.zoteroFigures + " 个 image 节点并识别 " + report.summary.zoteroFigureCaptions + " 个图注。图像框跨模型匹配 " + report.summary.matchedFigures + " 个。表格两侧各检测到 " + report.summary.docLayoutTables + " 个，匹配 " + report.summary.matchedTables + " 个，平均边界 IoU 为 " + formatPercent(report.summary.averageMatchedTableIou) + "。SDT 模型使用 PDF 文字行与对象特征，不读取整页 RGB 像素；DocLayout-YOLO 使用渲染页图像。";
    renderSummary();
    render();
  </script>
</body>
</html>`;
}

function emptyDocLayoutPage(pageIndex) {
  return {
    detections: [],
    height: 1,
    image: `pages/page-${String(pageIndex + 1).padStart(2, "0")}.jpg`,
    index: pageIndex,
    width: 1,
  };
}

function emptyZoteroPage(pageIndex) {
  return {
    detections: [],
    index: pageIndex,
    viewRect: [0, 0, 1, 1],
  };
}

function pdfRectToNormalized(rect, viewRect) {
  const [viewLeft, viewBottom, viewRight, viewTop] = viewRect;
  const width = Math.max(viewRight - viewLeft, Number.EPSILON);
  const height = Math.max(viewTop - viewBottom, Number.EPSILON);
  return [
    clamp((rect[0] - viewLeft) / width),
    clamp((viewTop - rect[3]) / height),
    clamp((rect[2] - viewLeft) / width),
    clamp((viewTop - rect[1]) / height),
  ];
}

function compareDetections(docLayout, zotero, matchThreshold) {
  const docSubjects = docLayout.filter((item) => SUBJECT_TYPES.has(item.type));
  const zoteroSubjects = zotero.filter((item) => SUBJECT_TYPES.has(item.type));
  const candidates = [];

  for (let docIndex = 0; docIndex < docSubjects.length; docIndex++) {
    for (
      let zoteroIndex = 0;
      zoteroIndex < zoteroSubjects.length;
      zoteroIndex++
    ) {
      if (docSubjects[docIndex].type !== zoteroSubjects[zoteroIndex].type) {
        continue;
      }
      candidates.push({
        docIndex,
        iou: intersectionOverUnion(
          docSubjects[docIndex].xyxy,
          zoteroSubjects[zoteroIndex].xyxy,
        ),
        zoteroIndex,
      });
    }
  }

  candidates.sort((first, second) => second.iou - first.iou);
  const usedDoc = new Set();
  const usedZotero = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (candidate.iou < matchThreshold) break;
    if (
      usedDoc.has(candidate.docIndex) ||
      usedZotero.has(candidate.zoteroIndex)
    ) {
      continue;
    }
    usedDoc.add(candidate.docIndex);
    usedZotero.add(candidate.zoteroIndex);
    matches.push(candidate);
  }

  const denominator = Math.max(docSubjects.length, zoteroSubjects.length, 1);
  const figureMatches = matches.filter(
    (match) => docSubjects[match.docIndex].type === "figure",
  );
  const tableMatches = matches.filter(
    (match) => docSubjects[match.docIndex].type === "table",
  );
  return {
    averageMatchedIou: matches.length
      ? matches.reduce((sum, match) => sum + match.iou, 0) / matches.length
      : 0,
    docLayoutSubjects: docSubjects.length,
    matchedFigures: figureMatches.length,
    matchedSubjects: matches.length,
    matchedTables: tableMatches.length,
    matchedTableIou: tableMatches.reduce((sum, match) => sum + match.iou, 0),
    subjectAgreement: matches.length / denominator,
    zoteroSubjects: zoteroSubjects.length,
  };
}

function summarizePages(pages) {
  const summary = {
    averageMatchedIou: 0,
    averageMatchedTableIou: 0,
    docLayoutFigureCaptions: 0,
    docLayoutFigures: 0,
    docLayoutSubjects: 0,
    docLayoutTables: 0,
    matchedFigures: 0,
    matchedSubjects: 0,
    matchedTables: 0,
    pageCount: pages.length,
    subjectAgreement: 0,
    zoteroFigures: 0,
    zoteroFigureCaptions: 0,
    zoteroSubjects: 0,
    zoteroTables: 0,
  };

  let matchedIouSum = 0;
  let matchedTableIouSum = 0;
  for (const page of pages) {
    summary.docLayoutFigures += page.docLayout.filter(
      (item) => item.type === "figure",
    ).length;
    summary.docLayoutTables += page.docLayout.filter(
      (item) => item.type === "table",
    ).length;
    summary.docLayoutFigureCaptions += page.docLayout.filter(
      (item) => item.type === "figure_caption",
    ).length;
    summary.zoteroFigures += page.zotero.filter(
      (item) => item.type === "figure",
    ).length;
    summary.zoteroTables += page.zotero.filter(
      (item) => item.type === "table",
    ).length;
    summary.zoteroFigureCaptions += page.zotero.filter(
      (item) => item.type === "figure_caption",
    ).length;
    summary.docLayoutSubjects += page.comparison.docLayoutSubjects;
    summary.zoteroSubjects += page.comparison.zoteroSubjects;
    summary.matchedFigures += page.comparison.matchedFigures;
    summary.matchedSubjects += page.comparison.matchedSubjects;
    summary.matchedTables += page.comparison.matchedTables;
    matchedTableIouSum += page.comparison.matchedTableIou;
    matchedIouSum +=
      page.comparison.averageMatchedIou * page.comparison.matchedSubjects;
  }

  summary.subjectAgreement =
    summary.matchedSubjects /
    Math.max(summary.docLayoutSubjects, summary.zoteroSubjects, 1);
  summary.averageMatchedIou = summary.matchedSubjects
    ? matchedIouSum / summary.matchedSubjects
    : 0;
  summary.averageMatchedTableIou = summary.matchedTables
    ? matchedTableIouSum / summary.matchedTables
    : 0;
  return summary;
}

function intersectionOverUnion(first, second) {
  const left = Math.max(first[0], second[0]);
  const top = Math.max(first[1], second[1]);
  const right = Math.min(first[2], second[2]);
  const bottom = Math.min(first[3], second[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const firstArea =
    Math.max(0, first[2] - first[0]) * Math.max(0, first[3] - first[1]);
  const secondArea =
    Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
  return intersection / (firstArea + secondArea - intersection + 1e-9);
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
