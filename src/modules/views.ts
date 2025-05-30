/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-non-null-withed-optional-chain */
import { config } from "../../package.json";
const SVGIcon = `<svg t="1748587495754" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1471" width="16" height="16"><path d="M942.2 486.2C847.4 286.5 704.1 186 512 186c-192.2 0-335.4 100.5-430.2 300.3-7.7 16.2-7.7 35.2 0 51.5C176.6 737.5 319.9 838 512 838c192.2 0 335.4-100.5 430.2-300.3 7.7-16.2 7.7-35 0-51.5zM512 766c-161.3 0-279.4-81.8-362.7-254C232.6 339.8 350.7 258 512 258c161.3 0 279.4 81.8 362.7 254C791.5 684.2 673.4 766 512 766z" p-id="1472"></path><path d="M508 336c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176z m0 288c-61.9 0-112-50.1-112-112s50.1-112 112-112 112 50.1 112 112-50.1 112-112 112z" p-id="1473"></path></svg>`;
  
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
    ztoolkit.UI.appendElement({
      tag: 'div',
      styles: {
        backgroundImage: `url(chrome://${config.addonRef}/content/icons/favicon.png)`,
      },
    }, document.lastChild as HTMLElement);

    // 新增：为图表注释添加"查看图表"按钮
    Zotero.Reader.registerEventListener(
      "renderSidebarAnnotationHeader",
      (event) => {
        const { reader, doc, params, append } = event;
        const annotationData = params.annotation;
        // 只为图表注释添加按钮
        if (annotationData.type === "image" && annotationData.comment?.startsWith("[zoterofigure]")) {
          append(
            ztoolkit.UI.createElement(doc, "div", {
              classList: ["icon"],
              properties: {
                innerHTML: SVGIcon,
                title: "查看图表",
              },
              listeners: [
                {
                  type: "click",
                  listener: (e) => {
                    const am = reader._internalReader._annotationManager;
                    const annos = am._annotations.filter(
                      (a) => a.type === "image" && a.comment?.startsWith("[zoterofigure]")
                    );
                    const srcs = annos.map((a) => a.image);
                    const index = annos.findIndex((a) => a.id === annotationData.id);
                    Zotero.BetterNotes?.hooks?.onShowImageViewer(srcs, index, "Figure");
                    e.preventDefault();
                  },
                },
                {
                  type: "mouseover",
                  listener: (e) => {
                    (e.target as HTMLElement).style.backgroundColor = "var(--color-sidepane)";
                  },
                },
                {
                  type: "mouseout",
                  listener: (e) => {
                    (e.target as HTMLElement).style.removeProperty("background-color");
                  },
                },
              ],
              enableElementRecord: false,
              ignoreIfExists: true,
            })
          );
        }
      },
      config.addonID
    );

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
      .filter((a: any) => a.annotationType == "image" && a.annotationComment?.startsWith('[zoterofigure]'))
    annos = annos.map((a: any) => {
      a.annotationComment = a.annotationComment.replace('[zoterofigure]', '')
      return a
    })
    
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
                          .filter((a: any) => a.annotationType == "image" && a.annotationComment?.startsWith('[zoterofigure]'))
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
        <span style="background: url(chrome://${config.addonRef}/content/icons/favicon.png); background-size: 16px 16px; background-position: 35% center; background-repeat: no-repeat; display:block;width: 16px;height: 16px;margin-right: 5px;"></span>
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none"><path fill="currentColor" d="m0 2.707 4 4 4-4L7.293 2 4 5.293.707 2z"></path></svg>`
      }
    }, ref) as HTMLButtonElement
    // 判断是否已经导入
    if (reader._item.getAnnotations().find(i => i.annotationComment?.startsWith('[zoterofigure]'))) {
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
        if (anno.comment?.startsWith('[zoterofigure]')) {
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
    if (!(await IOUtils.exists(javaPath))) {
      window.alert("Java不存在，请重新配置，请参考https://github.com/MuiseDestiny/zotero-figure配置")
      return []
    }
    if (!(await IOUtils.exists(jarPath))) {
      window.alert(`pdffigures2.jar不存在，请重新下载，并移动到 ${this.zoteroDir} 下，请参考https://github.com/MuiseDestiny/zotero-figure下载`)
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
          ""  // Empty tag since we're not using tags anymore
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
  annotation.comment = '[zoterofigure]' + (comment || '');
  annotation.tags = [];  // Initialize empty tags array
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
  // savedAnnotation.addTag(tag);
  await savedAnnotation.saveTx();
}

