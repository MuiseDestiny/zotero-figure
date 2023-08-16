/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import { config } from "../../package.json";
  
export default class Views {
  private dataDir: string;
  private figureDir: string;
  private zoteroDir: string;
  private addonDir: string;
  private isFigure = true;
  private button!: HTMLButtonElement;
  constructor() {
    this.registerButtons()
    // @ts-ignore
    const OS = window.OS
    this.zoteroDir = Zotero.DataDirectory._dir
    this.addonDir = OS.Path.join(this.zoteroDir, config.addonRef)
    this.dataDir = OS.Path.join(this.addonDir, "data")
    this.figureDir = OS.Path.join(this.addonDir, "figure")

    ztoolkit.UI.appendElement({
      tag: 'div',
      styles: {
        backgroundImage: `url(chrome://${config.addonRef}/content/icons/favicon.png)`,
      },
    }, document.lastChild as HTMLElement);
  }

  /**
 * 注册所有按钮
 */
  private registerButtons() {
    const notifierID = Zotero.Notifier.registerObserver({
      notify: async (
        event: string,
        type: string,
        ids: Array<string> | number[],
        extraData: { [key: string]: any }
      ) => {
        if (
          type == "tab" &&
          extraData[ids?.[0]]?.type == "reader"
        ) {
          await this.registerReaderButton(await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance)
        }
      }
    }, [
      "tab",
    ]);
    window.setTimeout(async () => {
      // 可能会报错，但是没关系
      await this.registerReaderButton(await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance)
    })
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
    let timer: undefined | number, isFigure = false
    this.button = ztoolkit.UI.insertElementBefore({
      ignoreIfExists: true,
      namespace: "html",
      tag: "button",
      id: config.addonRef,
      classList: ["toolbarButton"],
      styles: {
        // 解决图标
        backgroundImage: `url(chrome://${config.addonRef}/content/icons/favicon.png)`,
        // backgroundImage: `url(chrome://zoterogpt/content/icons/favicon.png)`,
        // backgroundImage: "url(https://gitee.com/MuiseDestiny/BiliBili/raw/master/zoterofigure.png)",
        backgroundSize: "16px 16px",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        width: "32px"
      },
      attributes: {
        title: "长按我：调用pdffigure2解析PDF图/表并保存为图注释；单击我：切换为图表视图/普通视图，可以多次单击切换视图哦。",
        tabindex: "-1",
      },
      // 长按是解析图表，点击是切换
      listeners: [
        {
          type: "mousedown",
          listener: async (event: any) => {
            timer = window.setTimeout(async () => {
              timer = undefined
              this.addAnnotation(reader)
            }, 1000)
          }
        },
        {
          type: "mouseup",
          listener: () => {
            if (timer) {
              // 切换
              this.switchView(reader)
              window.clearTimeout(timer)
            }
          }
        }
      ]
    }, ref) as HTMLButtonElement
    this.switchView(reader, false)
  }

  private switchView(reader: _ZoteroTypes.ReaderInstance, toggle = true) {
    let popupWin: any
    if (toggle) {      
      this.isFigure = !this.isFigure
      popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 })
        .createLine({ text: "Switch to " + (this.isFigure ? "Figure" : "Normal") + " view", type: "default"})
        .show()
    }
    if (!this.isFigure) {
      this.button.style.filter = "grayscale(100%)"
    } else {
      this.button.style.filter = "none"
    }
    const am = reader._internalReader._annotationManager
    am._render = am._render || am.render;
    am.render = () => {
      const isFilter = !(am._filter.authors.length == 0 && am._filter.colors.length == 0 && am._filter.query == "" && am._filter.tags.length == 0)
      am._annotations.forEach((anno: any) => {
        if (anno.tags.find((tag: any) => tag.name.startsWith("Figure") || tag.name.startsWith("Table"))) {
          // 不显示图表，隐藏图表注释
          if (!this.isFigure) {
            anno._hidden = true
          } else {
            if (!isFilter) {
              anno._hidden = false
            }
          }
        } else {
          // 只显示图表，隐藏其它
          if (this.isFigure) {
            anno._hidden = true
          } else {
            if (!isFilter) {
              anno._hidden = false
            }
          }
        }
      })
      am._render()
    }
    am.render();

    if (popupWin) {
      popupWin.createLine({ text: "Done", type: "success" })
      popupWin.startCloseTimer(1000)
    }
  }

  private async getValidPDFFilepath(pdfItem: Zotero.Item) {
    let filepath = await pdfItem.getFilePathAsync() as string
    // 不合法文件处理
    // @ts-ignore
    const origName = window.OS.Path.basename(filepath)
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
        filepath = window.OS.Path.join(this.dataDir, file.leafName)
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

  private async getFigures(reader: _ZoteroTypes.ReaderInstance, popupWin: any) {
    // 运行
    const pdfItem = reader._item;
    const filename = await this.getValidPDFFilepath(reader._item)

    /**
     * java -jar E:/Zotero/pdffigures2.jar "E:\OneDrive\OneDrive - junblue\Zotero\JRST\Jin et al_2021_Improved Bi-Angle Aerosol Optical Depth Retrieval Algorithm from AHI Data Based.pdf" -d E:\Github\scipdf_parser\figures\data\ -m  E:\Github\scipdf_parser\figures\figures\ -i 300
     * java -jar E:/Zotero/pdffigures2.jar "E:\Zotero\storage\LLEKT58E\Lv 等 - 2016 - Improving the Accuracy of Daily PM 2.5 .pdf" -m  E:\Github\scipdf_parser\figures\figures\ -i 300 -g E:\Github\scipdf_parser\figures\data\
     */
    // @ts-ignore
    const OS = window.OS

    // const cmdPath = Zotero.Prefs.get(`${config.addonRef}.path.cmd`) as string
    const javaPath = Zotero.Prefs.get(`${config.addonRef}.path.java`) as string

    const args = [
      "-jar",
      OS.Path.join(this.zoteroDir, "pdffigures2.jar"),
      filename,
      "-d",
      OS.Path.join(this.dataDir, pdfItem.key),
      // "-m",
      // this.figureDir + "/",
      // "-i",
      // "300",
      // "-t",
      // "8"
    ]
    if (!await OS.File.exists(this.addonDir)) {
      await OS.File.makeDir(this.addonDir);
    }
    if (!await OS.File.exists(this.dataDir)) {
      await OS.File.makeDir(this.dataDir);
    }
    if (!await OS.File.exists(this.figureDir)) {
      await OS.File.makeDir(this.figureDir);
    }
    let targetFile: string | undefined
    // if (!targetFile) {
    popupWin.createLine({ text: "Parsing figures...", type: "default" })
    await Zotero.Utilities.Internal.exec(javaPath, args);
    // }
    popupWin.createLine({ text: "Searching json...", type: "default" })
    // 等待写入生成json
    let count = 0
    while (!(targetFile = this.getJsonFilepath(pdfItem)) && count < 10) {
      await Zotero.Promise.delay(1000)
      count += 1
    }
    if (targetFile) {
      popupWin.createLine({ text: "Reading json...", type: "success" })
      const figures = await this.readAsJson(targetFile)
      if (figures.length == 0) {
        popupWin.createLine({ text: "No figures were parsed", type: "default" })
        popupWin.createLine({ text: "Finished", type: "default" })
        popupWin.startCloseTimer(3000)
      }
      return figures
    } else {
      popupWin.createLine({ text: "Not Found", type: "fail" })
      return []
    }
  }

  private async addAnnotation(reader: _ZoteroTypes.ReaderInstance) {
    const popupWin = new ztoolkit.ProgressWindow(config.addonName.split(" ").slice(-1)[0], { closeOtherProgressWindows: true, closeTime: -1 })
      .createLine({ text: "Start", type: "default" })
      .show()
    const figures = await this.getFigures(reader, popupWin)
    ztoolkit.log(figures)
    if (figures.length) {
      const t = figures.length
      const idx = popupWin.lines.length
      popupWin.createLine({ text: `[0/${t}]Add to Annotation`, progress: 0, type: "default" })
      // 写入注释
      const reader = await ztoolkit.Reader.getReader()
      const pdfWin = (reader!._iframeWindow as any).wrappedJSObject.document.querySelector("iframe").contentWindow
      const height = pdfWin.PDFViewerApplication.pdfViewer._pages[0].viewport.viewBox[3]
      for (let figure of figures) {
        const y1 = height - figure.regionBoundary.y2
        const y2 = height - figure.regionBoundary.y1
        figure.regionBoundary.y1 = y1
        figure.regionBoundary.y2 = y2
        await generateImageAnnotation(
          Zotero,
          Zotero_Tabs,
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
    }
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
function getPositionBoundingRect(position, pageIndex) {
  // Use nextPageRects
  if (position.rects) {
    let rects = position.rects;
    if (position.nextPageRects && position.pageIndex + 1 === pageIndex) {
      rects = position.nextPageRects;
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
function getFlattenedCharsByIndex(pdfPages, pageIndex) {
  let structuredText = pdfPages[pageIndex].structuredText;
  return flattenChars(structuredText);
}
function getSortIndex(pdfPages, position) {
  let { pageIndex } = position;
  let offset = 0;
  let top = 0;
  if (pdfPages[position.pageIndex]) {
    let chars = getFlattenedCharsByIndex(pdfPages, position.pageIndex);
    let viewBox = pdfPages[position.pageIndex].viewBox;
    let rect = getPositionBoundingRect(position);
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

async function generateImageAnnotation(Zotero, Zotero_Tabs, pageIndex, rect, comment, tag) {
  const reader = Zotero.Reader.getByTabID(Zotero_Tabs._tabs[Zotero_Tabs.selectedIndex].id)
  const pdfPages = reader._internalReader._primaryView._pdfPages
  const attachment = reader._item
  let annotation: any = {
    type: 'image',
    color: "#fd7e7e",
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
  // annotation.isAuthorNameAuthoritative = false;

  // Ensure numbers have 3 or less decimal places
  if (annotation.position.rects) {
    annotation.position.rects = annotation.position.rects.map(
      (rect: any) => rect.map((value: any) => parseFloat(value.toFixed(3)))
    );
  }
  const savedAnnotation = await Zotero.Annotations.saveFromJSON(attachment, annotation);
  savedAnnotation.addTag(tag);
  await savedAnnotation.saveTx();
  // reader._internalReader._primaryView._pdfRenderer.start()
  // reader._internalReader._primaryView._render();
}
