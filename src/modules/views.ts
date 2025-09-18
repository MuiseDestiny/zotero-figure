/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-non-null-withed-optional-chain */
import { config } from "../../package.json";
  
export default class Views {
  private dataDir: string;
  private figureDir: string;
  private zoteroDir: string;
  private addonDir: string;
  private button!: HTMLButtonElement;
  private view: "Figure" | "Annotation" | "All" = "Annotation"
  constructor() {
    this.registerButton()
    this.zoteroDir = Zotero.DataDirectory._dir
    this.addonDir = PathUtils.join(this.zoteroDir, config.addonRef)
    this.dataDir = PathUtils.join(this.addonDir, "data")
    this.figureDir = PathUtils.join(this.addonDir, "figure")

    // 点击图标展开更多
    window.addEventListener("click", (event: MouseEvent | any) => {
      if (!(
        event.target &&
        event.target.baseURI == "resource://zotero/reader/reader.html" &&
        event.target.tagName == "BUTTON" &&
        event.target.classList.contains("tag") &&
        event.target.innerText.match(/(Figure|Table)/)
      )) { return }
      event.preventDefault();
      event.stopPropagation();
      // 当点击未被激活的图表标注的标签时候
      const reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)
      const am = reader._internalReader._annotationManager
      this.clearFilter(reader)
      if (Zotero.BetterNotes?.hooks?.onShowImageViewer) {
        // @ts-ignore
        const annos = am._annotations
          .filter((a: any) => a.type == "image" && a.tags.find((t:any) => t.name.match(/^(Figure|Table)/)))
        const srcs = annos.map((a: any)=>a.image)
        Zotero.BetterNotes?.hooks?.onShowImageViewer(
          srcs,
          annos.map((a: any) => a.tags[0].name).indexOf(event.target.innerText),
          "Figure"
        )
      }
    })

    addon.api.views = this

    Zotero.Reader.registerEventListener("renderTextSelectionPopup", (event) => {
      const {reader} = event
      if (this.view == "Figure") {
        this.switchToView(reader, "All")
      }
    })
  }

  private async addToNote(item: Zotero.Item) {
    const popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 })
      .createLine({ text: "Add To Note", type: "default" })
      .show()
    let annos = item.getAnnotations()
    annos = annos
      .filter((a: any) => a.annotationType == "image" && a.getTags()?.[0]?.tag?.match(/^(Figure|Table)/))
    
    await Zotero.EditorInstance.createNoteFromAnnotations(annos,
      // @ts-ignore
      { parentID: item.parentID as number })
    popupWin.changeLine({ type: "success" })
    popupWin.startCloseTimer(1000)
  }

  private async getReaderInstance(itemID: number, focus = false): Promise<_ZoteroTypes.ReaderInstance> {
    let reader: _ZoteroTypes.ReaderInstance | undefined
    const tab = Zotero_Tabs._tabs.find(tab => tab.type == "reader" && tab.data.itemID == itemID)
    // 条目已打开
    if (tab) {
      if (tab.type == "reader-unloaded") {
        Zotero_Tabs.close(tab.id)
      } else {
        reader = Zotero.Reader.getByTabID(tab.id)
      }
    }
    reader = reader || await Zotero.Reader.open(
      itemID,
      undefined,
      { openInBackground: !focus }
    )! as _ZoteroTypes.ReaderInstance

    if (!reader) {
      return this.getReaderInstance(itemID, focus)
    }

    while (!(reader?._internalReader?._lastView as any)?._iframeWindow?.PDFViewerApplication?.pdfDocument) {
      await Zotero.Promise.delay(100)
    }
    return reader
  }

  /**
   * 注册所有按钮
   */
  private registerButton() {
    Zotero.Reader.registerEventListener(
      "renderToolbar",
      async () => {
        await this.registerReaderButton(await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance)
      },
      config.addonID
    )
  }

  /**
   * 注册PDF阅读按钮
   * @param reader 
   */
  private async registerReaderButton(reader: _ZoteroTypes.ReaderInstance) {
    let _window: any
    // @ts-ignore
    while (!(_window = reader?._iframeWindow?.wrappedJSObject)) {
      await Zotero.Promise.delay(10)
    }
    const imgBase64String = `data:image/png;base64,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`
    const parent = _window.document.querySelector("#reader-ui .toolbar .start")!
    const ref = parent.querySelector("#pageNumber") as HTMLDivElement
    this.button = ztoolkit.UI.insertElementBefore({
      ignoreIfExists: true,
      namespace: "html",
      tag: "button",
      id: config.addonRef,
      classList: ["toolbar-button"],
      styles: {
        // margin: "0 .6em",
        width: "40px",
        filter: "grayscale(100%)",
        display: "flex",
        alignItems: "center"
      },
      attributes: {
        title: config.addonName,
        tabindex: "-1",
      },
      // 长按是解析图表，点击是切换
      listeners: [
        {
          type: "click",
          listener: () => {
            const menupopup = ztoolkit.UI.appendElement({
              tag: "menupopup",
              id: config.addonRef + "-menupopup",
              namespace: "xul",
              children: [
                {
                  tag: "menuitem",
                  attributes: {
                    label: "PDF图表解析",
                  },
                  listeners: [
                    {
                      type: "command",
                      listener: () => {
                        this.addAnnotations(reader._item.id)
                      }
                    }
                  ]

                },
                {
                  tag: "menuseparator"
                },
                {
                  tag: "menuitem",
                  attributes: {
                    label: "仅显示图表",
                    type: "checkbox",
                    checked: this.view == "Figure"
                  },
                  listeners: [
                    {
                      type: "command",
                      listener: () => {
                        this.clearFilter(reader)
                        if (this.view != "Figure") {
                          this.switchToView(reader, "Figure")
                        } else {
                          this.switchToView(reader, "All")
                        }
                      }
                    }
                  ]
                },
                {
                  tag: "menuitem",
                  attributes: {
                    label: "仅显示标注",
                    type: "checkbox",
                    checked: this.view == "Annotation"
                  },
                  listeners: [
                    {
                      type: "command",
                      listener: () => {
                        this.clearFilter(reader)
                        if (this.view != "Annotation") {
                          this.switchToView(reader, "Annotation")
                        } else {
                          this.switchToView(reader, "All")
                        }
                      }
                    }
                  ]
                },
                {
                  tag: "menuseparator"
                },
                {
                  tag: "menuitem",
                  attributes: {
                    label: "图表转笔记",
                  },
                  listeners: [
                    {
                      type: "command",
                      listener: async () => {
                        await this.addToNote(reader._item)
                      }
                    }
                  ]
                },
                {
                  tag: "menuitem",
                  attributes: {
                    label: "清空图表",
                  },
                  listeners: [
                    {
                      type: "click",
                      listener: async () => {
                        const popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 })
                          .createLine({ text: "Remove All Figures", type: "default" })
                          .show()
                        this.switchToView(reader, "Figure", false)
                        let annos = reader._item.getAnnotations()
                        annos = annos
                          .filter((a: any) => a.annotationType == "image" && a.getTags()?.[0]?.tag?.match(/^(Figure|Table)/))
                        await Promise.all(annos.map(async (anno) => await anno.eraseTx()))
                        popupWin.changeLine({ type: "success" })
                        popupWin.startCloseTimer(1000)
                        this.button.style.filter = "grayscale(100%)";
                        this.switchToView(reader, "Annotation", false)
                      }
                    }
                  ]
                }
              ]
            }, document.querySelector("#browser")!) as XUL.MenuPopup
            // @ts-ignore
            menupopup.openPopup(this.button, 'after_start', 0, 0, false, false)
          }
        },
      ],
      properties: {
        innerHTML: `
        <span style="background: url(${imgBase64String}); background-size: 16px 16px; background-position: 35% center; background-repeat: no-repeat; display:block;width: 16px;height: 16px;margin-right: 5px;"></span>
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none"><path fill="currentColor" d="m0 2.707 4 4 4-4L7.293 2 4 5.293.707 2z"></path></svg>`
      }
    }, ref) as HTMLButtonElement
    // 判断是否已经导入
    if (reader._item.getAnnotations().find(i => i.getTags().find(t => t.tag.match(/^(Figure|Table)/)))) {
      this.button.style.filter = "none"
    }
    this.switchToView(reader, Zotero.Prefs.get(`${config.addonRef}.view`) as any, false)
  }

  private clearFilter(reader: _ZoteroTypes.ReaderInstance) {
    const am = reader._internalReader._annotationManager
    am._filter.authors.forEach((i: any) => am._filter.authors.pop());
    am._filter.colors.forEach((i: any) => am._filter.colors.pop());
    am._filter.tags.forEach((i: any) => am._filter.tags.pop());
    am._filter.query = "";
    am.render();
  }

  /**
   * 切换显示图表/普通视图
   * @param reader 
   * @param isFigure 
   */
  private switchToView(reader: _ZoteroTypes.ReaderInstance, view: "Figure" | "Annotation" | "All", isPopup = true) {
    Zotero.Prefs.set(`${config.addonRef}.view`, view)
    let popupWin: any
    if (isPopup) {
      popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 })
        .createLine({ text: "Switch to " + view + " view", type: "default"})
        .show()
    }
    const am = reader._internalReader._annotationManager
    // @ts-ignore
    am._render = am._render || am.render;
    am.render = () => {
      const isFilter = !(am._filter.authors.length == 0 && am._filter.colors.length == 0 && am._filter.query == "" && am._filter.tags.length == 0)
      // const isFilter = false
      am._annotations.forEach((anno: any) => {
        if (anno.tags.find((tag: any) => tag.name.startsWith("Figure") || tag.name.startsWith("Table"))) {
          // 不显示图表，隐藏图表注释
          if (view == "Annotation") {
            anno._hidden = true
          } else {
            if (!isFilter) {
              delete anno._hidden
            }
          }
        } else {
          // 只显示图表，隐藏其它
          if (view == "Figure") {
            anno._hidden = true
          } else {
            if (!isFilter) {
              delete anno._hidden
            }
          }
        }
      })
      // @ts-ignore
      am._render()
    }
    am.render();
    this.view = view
    if (popupWin) {
      popupWin.changeLine({ type: "success" })
      popupWin.startCloseTimer(1000)
    }
  }

  private async getValidPDFFilepath(pdfItem: Zotero.Item) {
    let filepath = await pdfItem.getFilePathAsync() as string
    // 不合法文件处理
    // @ts-ignore
    const origName = PathUtils.split(filepath).slice(-1)[0]
    if (origName.indexOf(",") >= 0) {
      const newName = origName.replace(/,/g, "_")
      if (
        Zotero.Prompt.confirm({
          title: "Confirm",
          text: `"${origName}" is not available for PDFFigures2, rename it to "${newName}".`,
          button0: "Rename",
          button1: "Cancel",
          checkbox: {}
        }) == 0
      ) {
        await pdfItem.renameAttachmentFile(newName);
        filepath = await pdfItem.getFilePathAsync() as string
      }
    }
    return filepath
  }

  private getJsonFilepath(pdfItem: Zotero.Item) {
    const files = Zotero.File.pathToFile(this.dataDir).directoryEntries
    let filepath: string | undefined
    while (files.hasMoreElements()) {
      const file = files.getNext().QueryInterface(Components.interfaces.nsIFile);
      if ((file.leafName as string).startsWith(pdfItem.key)) {
        // @ts-ignore
        filepath = window.PathUtils.join(this.dataDir, file.leafName)
        break
      }
    }
    return filepath
  }

  private async readAsJson(filepath: string) {
    // 先用utf-8
    let rawString = await Zotero.File.getContentsAsync(filepath, "utf-8") as string
    if (rawString.indexOf("�") >= 0) {
      rawString = await Zotero.File.getContentsAsync(filepath, "gbk") as string
    }
    return JSON.parse(rawString) as Figure[]
  }

  private async getFigures(pdfItem: Zotero.Item, isFigure: boolean, popupWin: any) {
    // 运行
    const filename = await this.getValidPDFFilepath(pdfItem)

    /**
     * java -jar E:/Zotero/pdffigures2.jar "E:\OneDrive\OneDrive - junblue\Zotero\JRST\Jin et al_2021_Improved Bi-Angle Aerosol Optical Depth Retrieval Algorithm from AHI Data Based.pdf" -d E:\Github\scipdf_parser\figures\data\ -m  E:\Github\scipdf_parser\figures\figures\ -i 300
     * java -jar E:/Zotero/pdffigures2.jar "E:\Zotero\storage\LLEKT58E\Lv 等 - 2016 - Improving the Accuracy of Daily PM 2.5 .pdf" -m  E:\Github\scipdf_parser\figures\figures\ -i 300 -g E:\Github\scipdf_parser\figures\data\
     */
    // const cmdPath = Zotero.Prefs.get(`${config.addonRef}.path.cmd`) as string
    const javaPath = Zotero.Prefs.get(`${config.addonRef}.path.java`) as string
    const jarPath = PathUtils.join(this.zoteroDir, "pdffigures2.jar")

    if (!javaPath) {
      window.alert("Java路径尚未配置，请参考https://github.com/MuiseDestiny/zotero-figure配置")
      return []
    }
    try {
      if (!(await IOUtils.exists(javaPath))) {
        window.alert("Java不存在，请重新配置，请参考https://github.com/MuiseDestiny/zotero-figure配置")
        return []
      }
    } catch (e) {
      window.alert(`路径${javaPath}错误`)
      return []
    }
    try {      
      if (!(await IOUtils.exists(jarPath))) {
        window.alert(`pdffigures2.jar不存在，请重新下载，并移动到 ${this.zoteroDir} 下，请参考https://github.com/MuiseDestiny/zotero-figure下载`)
        return []
      }
    } catch (e) {
      window.alert(`路径${jarPath}错误`)
      return []
    }

    
    let args = [
      "-jar",
      jarPath,
      filename,
      "-d",
      PathUtils.join(this.dataDir, pdfItem.key),
      // "-m",
      // this.figureDir + "/",
      // "-i",
      // "300",
    ]
    if (isFigure) {
      args = [...args, ...[
        "-m",
        this.figureDir + "/",
        "-i",
        "300",
      ]]
    }
    if (!await IOUtils.exists(this.addonDir)) {
      await IOUtils.makeDirectory(this.addonDir);
    }
    if (!await IOUtils.exists(this.dataDir)) {
      await IOUtils.makeDirectory(this.dataDir);
    }
    if (!await IOUtils.exists(this.figureDir)) {
      await IOUtils.makeDirectory(this.figureDir);
    }
    let targetFile: string | undefined
    popupWin?.createLine({ text: "Parsing figures...", type: "default" })
    ztoolkit.log(javaPath, args)
    try {
      await Zotero.Utilities.Internal.exec(javaPath, args);
    } catch (e) {
      ztoolkit.log(e)
    }
  
    popupWin?.createLine({ text: "Searching json...", type: "default" })
    // 等待写入生成json
    let count = 0
    while (!(targetFile = this.getJsonFilepath(pdfItem)) && count < 3) {
      await Zotero.Promise.delay(1000)
      count += 1
    }
    if (targetFile) {
      popupWin?.createLine({ text: "Reading json...", type: "success" })
      const figures = await this.readAsJson(targetFile)
      if (figures.length == 0) {
        popupWin?.createLine({ text: "No figures were parsed", type: "default" })
        popupWin?.createLine({ text: "Finished", type: "default" })
        popupWin?.startCloseTimer(3000)
      }
      return figures
    } else {
      popupWin?.createLine({ text: "Not Found", type: "fail" })
      return []
    }
  }

  private async addAnnotations(itemID: number) {
    const reader = await this.getReaderInstance(itemID) as _ZoteroTypes.ReaderInstance
    const popupWin = new ztoolkit.ProgressWindow(config.addonName.split(" ").slice(-1)[0], { closeOtherProgressWindows: true, closeTime: -1 })
      .createLine({ text: "Start", type: "default" })
      .show()
    const figures = await this.getFigures(await Zotero.Items.getAsync(itemID), false, popupWin)
    if (figures.length) {
      window.setTimeout(() => {
        this.button.style.filter = "none"
      })
      this.switchToView(reader, "Figure", false)
      const t = figures.length
      // @ts-ignore
      const idx = popupWin.lines.length
      popupWin.createLine({ text: `[0/${t}] Add to Annotation`, progress: 0, type: "default" })
      // 写入注释
      const pdfWin = (reader!._iframeWindow as any).wrappedJSObject.document.querySelector("iframe").contentWindow
      const height = pdfWin.PDFViewerApplication.pdfViewer._pages[0].viewport.viewBox[3]
      for (let figure of figures) {
        const y1 = height - figure.regionBoundary.y2
        const y2 = height - figure.regionBoundary.y1
        figure.regionBoundary.y1 = y1
        figure.regionBoundary.y2 = y2
        await generateImageAnnotation(
          Zotero,
          reader,
          figure.page,
          Object.values(figure.regionBoundary),
          figure.caption,
          figure.figType + " " + figure.name
        )
        const i = figures.indexOf(figure) + 1
        
        popupWin.changeLine({
          progress:  i / t * 100,
          text: `[${i}/${t}] Add to Annotation`,
          idx
        });
      }
      popupWin.changeLine({
        progress: 100,
        text: `[${t}/${t}] Add to Annotation`,
        idx
      });
      popupWin.changeLine({ text: "Done", type: "success", idx})
      popupWin.startCloseTimer(3000)
      this.switchToView(reader, "Annotation", false)
    }
    ztoolkit.log("render")
    await Zotero.PDFRenderer.renderAttachmentAnnotations(itemID);
  }

}


interface Boundary {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}
interface Figure {
  caption: string;
  name: string;
  page: number;
  renderURL: string;
  regionBoundary: Boundary;
  figType: "Figure" | "Table"
}


function flattenChars(structuredText) {
  let flatCharsArray = [];
  for (let paragraph of structuredText.paragraphs) {
    for (let line of paragraph.lines) {
      for (let word of line.words) {
        for (let charObj of word.chars) {
          flatCharsArray.push(charObj);
        }
      }
    }
  }
  return flatCharsArray;
}
function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
  let left = bx2 < ax1;
  let right = ax2 < bx1;
  let bottom = by2 < ay1;
  let top = ay2 < by1;

  if (top && left) {
    return Math.hypot(ax1 - bx2, ay2 - by1);
  }
  else if (left && bottom) {
    return Math.hypot(ax1 - bx2, ay1 - by2);
  }
  else if (bottom && right) {
    return Math.hypot(ax2 - bx1, ay1 - by2);
  }
  else if (right && top) {
    return Math.hypot(ax2 - bx1, ay2 - by1);
  }
  else if (left) {
    return ax1 - bx2;
  }
  else if (right) {
    return bx1 - ax2;
  }
  else if (bottom) {
    return ay1 - by2;
  }
  else if (top) {
    return by1 - ay2;
  }

  return 0;
}
function getClosestOffset(chars, rect) {
  let dist = Infinity;
  let idx = 0;
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    let distance = rectsDist(ch.rect, rect);
    if (distance < dist) {
      dist = distance;
      idx = i;
    }
  }
  return idx;
}
function applyTransform(p, m) {
  const xt = p[0] * m[0] + p[1] * m[2] + m[4];
  const yt = p[0] * m[1] + p[1] * m[3] + m[5];
  return [xt, yt];
}
function normalizeRect(rect) {
  const r = rect.slice(0); // clone rect
  if (rect[0] > rect[2]) {
    r[0] = rect[2];
    r[2] = rect[0];
  }
  if (rect[1] > rect[3]) {
    r[1] = rect[3];
    r[3] = rect[1];
  }
  return r;
}
function getAxialAlignedBoundingBox(r, m) {
  const p1 = applyTransform(r, m);
  const p2 = applyTransform(r.slice(2, 4), m);
  const p3 = applyTransform([r[0], r[3]], m);
  const p4 = applyTransform([r[2], r[1]], m);
  return [
    Math.min(p1[0], p2[0], p3[0], p4[0]),
    Math.min(p1[1], p2[1], p3[1], p4[1]),
    Math.max(p1[0], p2[0], p3[0], p4[0]),
    Math.max(p1[1], p2[1], p3[1], p4[1]),
  ];
}
function getRotationTransform(rect, degrees) {
  degrees = degrees * Math.PI / 180;
  let cosValue = Math.cos(degrees);
  let sinValue = Math.sin(degrees);
  let m = [cosValue, sinValue, -sinValue, cosValue, 0, 0];
  rect = normalizeRect(rect);
  let x1 = rect[0] + (rect[2] - rect[0]) / 2;
  let y1 = rect[1] + (rect[3] - rect[1]) / 2;
  let rect2 = getAxialAlignedBoundingBox(rect, m);
  let x2 = rect2[0] + (rect2[2] - rect2[0]) / 2;
  let y2 = rect2[1] + (rect2[3] - rect2[1]) / 2;
  let deltaX = x1 - x2;
  let deltaY = y1 - y2;
  m[4] = deltaX;
  m[5] = deltaY;
  return m;
}
function getPositionBoundingRect(position, pageIndex) {
  // Use nextPageRects
  if (position.rects) {
    let rects = position.rects;
    if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
      rects = position.nextPageRects;
    }
    if (position.rotation) {
      let rect = rects[0];
      let tm = getRotationTransform(rect, position.rotation);
      let p1 = applyTransform([rect[0], rect[1]], tm);
      let p2 = applyTransform([rect[2], rect[3]], tm);
      let p3 = applyTransform([rect[2], rect[1]], tm);
      let p4 = applyTransform([rect[0], rect[3]], tm);
      return [
        Math.min(p1[0], p2[0], p3[0], p4[0]),
        Math.min(p1[1], p2[1], p3[1], p4[1]),
        Math.max(p1[0], p2[0], p3[0], p4[0]),
        Math.max(p1[1], p2[1], p3[1], p4[1]),
      ];
    }
    return [
      Math.min(...rects.map(x => x[0])),
      Math.min(...rects.map(x => x[1])),
      Math.max(...rects.map(x => x[2])),
      Math.max(...rects.map(x => x[3]))
    ];
  }
  else if (position.paths) {
    let x = position.paths[0][0];
    let y = position.paths[0][1];
    let rect = [x, y, x, y];
    for (let path of position.paths) {
      for (let i = 0; i < path.length - 1; i += 2) {
        let x = path[i];
        let y = path[i + 1];
        rect[0] = Math.min(rect[0], x);
        rect[1] = Math.min(rect[1], y);
        rect[2] = Math.max(rect[2], x);
        rect[3] = Math.max(rect[3], y);
      }
    }
    return rect;
  }
}
function getTopMostRectFromPosition(position) {
  // Sort the rectangles based on their y2 value in descending order and return the first one
  return position?.rects?.slice().sort((a, b) => b[2] - a[2])[0];
}

function getSortIndex(pdfPages, position) {
  let { pageIndex } = position;
  let offset = 0;
  let top = 0;
  if (pdfPages[position.pageIndex]) {
    let { chars } = pdfPages[position.pageIndex];
    let viewBox = pdfPages[position.pageIndex].viewBox;
    let rect = getTopMostRectFromPosition(position) || getPositionBoundingRect(position, null);
    offset = chars.length && getClosestOffset(chars, rect) || 0;
    let pageHeight = viewBox[3] - viewBox[1];
    top = pageHeight - rect[3];
    if (top < 0) {
      top = 0;
    }
  }
  return [
    pageIndex.toString().slice(0, 5).padStart(5, '0'),
    offset.toString().slice(0, 6).padStart(6, '0'),
    Math.floor(top).toString().slice(0, 5).padStart(5, '0')
  ].join('|');
}
function _generateObjectKey() {
  let len = 8;
  let allowedKeyChars = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';

  var randomstring = '';
  for (var i = 0; i < len; i++) {
    var rnum = Math.floor(Math.random() * allowedKeyChars.length);
    randomstring += allowedKeyChars.substring(rnum, rnum + 1);
  }
  return randomstring;
}

async function generateImageAnnotation(Zotero: any, reader: any, pageIndex: any, rect: any, comment: any, tag: any) {
  // const reader = Zotero.Reader.getByTabID(Zotero_Tabs._tabs[Zotero_Tabs.selectedIndex].id)
  const pdfPages = reader._internalReader._primaryView._pdfPages
  const attachment = reader._item
  let annotation: any = {
    type: 'image',
    color: "#d2d8e2",
    pageLabel: String(pageIndex + 1),
    position: {
      pageIndex: pageIndex,
      rects: [rect]
    }
  };
  annotation.sortIndex = getSortIndex(pdfPages, annotation.position)

  annotation.pageLabel = annotation.pageLabel || '';
  annotation.text = annotation.text || '';
  annotation.comment = comment;
  annotation.tags = annotation.tags || [];
  // Automatically set properties
  annotation.key = annotation.id = _generateObjectKey();
  annotation.dateCreated = (new Date()).toISOString();
  annotation.dateModified = annotation.dateCreated;
  annotation.authorName = "zoterofigure";

  // Ensure numbers have 3 or less decimal places
  if (annotation.position.rects) {
    annotation.position.rects = annotation.position.rects.map(
      (rect: any) => rect.map((value: any) => parseFloat(value.toFixed(3)))
    );
  }
  const savedAnnotation = await Zotero.Annotations.saveFromJSON(attachment, annotation);
  savedAnnotation.addTag(tag);
  await savedAnnotation.saveTx();
}

