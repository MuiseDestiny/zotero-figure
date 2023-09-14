/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import { config } from "../../package.json";
  
export default class Views {
  private dataDir: string;
  private figureDir: string;
  private zoteroDir: string;
  private addonDir: string;
  private button!: HTMLButtonElement;
  constructor() {
    this.registerButton()
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

    window.addEventListener("click", (event: MouseEvent | any) => {
      if (!(
        event.target &&
        event.target.baseURI == "resource://zotero/reader/reader.html" &&
        event.target.tagName == "BUTTON" &&
        event.target.className == "tag selected inactive" &&
        event.target.innerText.match(/(Figure|Table)/)
      )) { return }
      // 当点击未被激活的图表标注的标签时候
      const reader = Zotero.Reader.getByTabID(Zotero_Tabs._tabs[Zotero_Tabs.selectedIndex].id)
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
  }

  /**
 * 注册所有按钮
 */
  private registerButton() {
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
        backgroundSize: "16px 16px",
        backgroundPosition: "35% center",
        backgroundRepeat: "no-repeat",
        width: "45px",
        filter: "grayscale(100%)",
        padding: "4px 3px 4px 22px"
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
              ]
            }, document.querySelector("#browser")!) as XUL.MenuPopup
            // 1. 解析PDF图表为注释
            const menuitem0 = ztoolkit.UI.appendElement({
              tag: "menuitem",
              attributes: {
                label: "PDF图表解析",
              }
            }, menupopup)
            menuitem0.addEventListener("command", () => {
              this.addAnnotation(reader)
            })
            // 2. 图表注释视图
            const menuitem1 = ztoolkit.UI.appendElement({
              tag: "menuitem",
              attributes: {
                label: "显示图表 & 隐藏标注",
              }
            }, menupopup)
            menuitem1.addEventListener("command", () => {
              this.clearFilter(reader)
              this.switchView(reader, true)
            })
            // 3. 普通注释视图
            const menuitem2 = ztoolkit.UI.appendElement({
              tag: "menuitem",
              attributes: {
                label: "显示标注 & 隐藏图表",
              }
            }, menupopup)
            menuitem2.addEventListener("command", () => {
              this.clearFilter(reader)
              this.switchView(reader, false)
            })
            // 4. 图表转笔记
            const menuitem3 = ztoolkit.UI.appendElement({
              tag: "menuitem",
              attributes: {
                label: "图表转笔记",
              }
            }, menupopup)
            menuitem3.addEventListener("command", async () => {
              const popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1})
                .createLine({ text: "Add To Note", type: "default" })
                .show()
              let annos = reader._item.getAnnotations()
              annos = annos
                .filter((a: any) => a.annotationType == "image" && a.getTags()[0].tag.match(/^(Figure|Table)/))

              const note = await createNoteFromAnnotations(
                annos,
                // @ts-ignore
                { parentID: reader._item.parentID as number }
              );
              
              popupWin.changeLine({ type: "success" })
              popupWin.startCloseTimer(1000)
            })
            // 3. 普通注释视图
            const menuitem4 = ztoolkit.UI.appendElement({
              tag: "menuitem",
              attributes: {
                label: "清空图表",
              }
            }, menupopup)
            menuitem4.addEventListener("command", async () => {
              const popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 })
                .createLine({ text: "Remove All Figures", type: "default" })
                .show()
              this.switchView(reader, true, false)
              let annos = reader._item.getAnnotations()
              annos = annos
                .filter((a: any) => a.annotationType == "image" && a.getTags()[0].tag.match(/^(Figure|Table)/))
              await Promise.all(annos.map(async (anno) => await anno.eraseTx()))
              popupWin.changeLine({ type: "success" })
              popupWin.startCloseTimer(1000)
              this.button.style.filter = "grayscale(100%)";
              this.switchView(reader, false, false)
            })
            // @ts-ignore
            menupopup.openPopup(this.button, 'after_start', 0, 0, false, false)
          }
        },
      ],
      children: [
        {
          tag: "span",
          classList: ["dropmarker"],
          styles: {
            background: "url(assets/icons/searchbar-dropmarker@2x.4ebeb64c.png) no-repeat 0 0/100%",
            display: "inline-block",
            height: "4px",
            margin: "6px 0",
            marginInlineStart: "2px",
            position: "relative",
            verticalAlign: "top",
            width: "7px",
            zIndex: "1"
          }
        }
      ]
    }, ref) as HTMLButtonElement
    // 判断是否已经导入
    if (reader._item.getAnnotations().find(i => i.getTags().find(t => t.tag.match(/^(Figure|Table)/)))) {
      this.button.style.filter = "none"
    }
    this.switchView(reader, false, false)
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
  private switchView(reader: _ZoteroTypes.ReaderInstance, isFigure: boolean, isPopup = true) {
    let popupWin: any
    if (isPopup) {
      popupWin = new ztoolkit.ProgressWindow("Figure", { closeTime: -1 })
        .createLine({ text: "Switch to " + (isFigure ? "Figure" : "Normal") + " view", type: "default"})
        .show()
    }
    const am = reader._internalReader._annotationManager
    am._render = am._render || am.render;
    am.render = () => {
      const isFilter = !(am._filter.authors.length == 0 && am._filter.colors.length == 0 && am._filter.query == "" && am._filter.tags.length == 0)
      // const isFilter = false
      am._annotations.forEach((anno: any) => {
        if (anno.tags.find((tag: any) => tag.name.startsWith("Figure") || tag.name.startsWith("Table"))) {
          // 不显示图表，隐藏图表注释
          if (!isFigure) {
            anno._hidden = true
          } else {
            if (!isFilter) {
              delete anno._hidden
            }
          }
        } else {
          // 只显示图表，隐藏其它
          if (isFigure) {
            anno._hidden = true
          } else {
            if (!isFilter) {
              delete anno._hidden
            }
          }
        }
      })
      am._render()
    }
    am.render();
    if (popupWin) {
      popupWin.changeLine({ type: "success" })
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
    if (!javaPath) {
      window.alert("Java路径尚未配置")
      return []
    }
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
    popupWin.createLine({ text: "Parsing figures...", type: "default" })
    await Zotero.Utilities.Internal.exec(javaPath, args);
    popupWin.createLine({ text: "Searching json...", type: "default" })
    // 等待写入生成json
    let count = 0
    while (!(targetFile = this.getJsonFilepath(pdfItem)) && count < 3) {
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
      this.button.style.filter = "none"
      this.switchView(reader, true, false)
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
      this.switchView(reader, false, false)
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


async function createNoteFromAnnotations(annotations, { parentID, collectionID } = {}) {
  if (!annotations.length) {
    throw new Error("No annotations provided");
  }

  for (let annotation of annotations) {
    if (annotation.annotationType === 'image'
      && !await Zotero.Annotations.hasCacheImage(annotation)) {
      try {
        await Zotero.PDFRenderer.renderAttachmentAnnotations(annotation.parentID);
      }
      catch (e) {
        Zotero.debug(e);
        throw e;
      }
      break;
    }
  }

  let note = new Zotero.Item('note');
  note.libraryID = annotations[0].libraryID;
  if (parentID) {
    note.parentID = parentID;
  }
  else if (collectionID) {
    note.addToCollection(collectionID);
  }
  await note.saveTx();
  let editorInstance = new Zotero.EditorInstance();
  editorInstance._item = note;
  let jsonAnnotations = [];
  for (let annotation of annotations) {
    let attachmentItem = Zotero.Items.get(annotation.parentID);
    let jsonAnnotation = await Zotero.Annotations.toJSON(annotation);
    jsonAnnotation.attachmentItemID = attachmentItem.id;
    jsonAnnotation.id = annotation.key;
    jsonAnnotations.push(jsonAnnotation);
  }

  let vars = {
    title: "图表",
    date: new Date().toLocaleString()
  };
  let html = Zotero.Utilities.Internal.generateHTMLFromTemplate(Zotero.Prefs.get('annotations.noteTemplates.title'), vars);
  // New line is needed for note title parser
  html += '\n';

  await editorInstance.importImages(jsonAnnotations);

  let multipleParentParent = false;
  let lastParentParentID;
  let lastParentID;
  // Group annotations per attachment
  let groups = [];
  for (let i = 0; i < annotations.length; i++) {
    let annotation = annotations[i];
    let jsonAnnotation = jsonAnnotations[i];
    let parentParentID = annotation.parentItem.parentID;
    let parentID = annotation.parentID;
    if (groups.length) {
      if (parentParentID !== lastParentParentID) {
        // Multiple top level regular items detected, allow including their titles
        multipleParentParent = true;
      }
    }
    if (!groups.length || parentID !== lastParentID) {
      groups.push({
        parentTitle: annotation.parentItem.getDisplayTitle(),
        parentParentID,
        parentParentTitle: annotation.parentItem.parentItem && annotation.parentItem.parentItem.getDisplayTitle(),
        jsonAnnotations: [jsonAnnotation]
      });
    }
    else {
      let group = groups[groups.length - 1];
      group.jsonAnnotations.push(jsonAnnotation);
    }
    lastParentParentID = parentParentID;
    lastParentID = parentID;
  }
  let citationItems = [];
  lastParentParentID = null;
  for (let group of groups) {
    if (multipleParentParent && group.parentParentTitle && lastParentParentID !== group.parentParentID) {
      html += `<h2>${group.parentParentTitle}</h2>\n`;
    }
    lastParentParentID = group.parentParentID;
    // If attachment doesn't have a parent or there are more attachments with the same parent, show attachment title
    if (!group.parentParentID || groups.filter(x => x.parentParentID === group.parentParentID).length > 1) {
      html += `<h3>${group.parentTitle}</h3>\n`;
    }
    let { html: _html, citationItems: _citationItems } = Zotero.EditorInstanceUtilities.serializeAnnotations(group.jsonAnnotations, true);
    html += _html + '\n';
    for (let _citationItem of _citationItems) {
      if (!citationItems.find(item => item.uris.some(uri => _citationItem.uris.includes(uri)))) {
        citationItems.push(_citationItem);
      }
    }
  }
  citationItems = window.encodeURIComponent(JSON.stringify(citationItems));
  // Note: Update schema version only if using new features.
  let schemaVersion = 9;
  // If using underline annotations, increase schema version number
  // TODO: Can be removed once most clients support schema version 10
  if (schemaVersion === 9 && annotations.some(x => x.annotationType === 'underline')) {
    schemaVersion = 10;
  }
  html = `<div data-citation-items="${citationItems}" data-schema-version="${schemaVersion}">${html}</div>`;
  note.setNote(html);
  await note.saveTx();
  return note;
}