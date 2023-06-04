import { config } from "../../package.json";
import { getString, initLocale } from "../utils/locale";
var jschardet = require('jschardet');
export default class Views {
  private id = config.addonRef
  constructor() {
    this.addStyle()
    // 初次打开Zotero就是一篇PDF
    window.setTimeout(async () => {
      const reader = await ztoolkit.Reader.getReader(10e3) as _ZoteroTypes.ReaderInstance
      if (reader) {
        await this.registerReaderSideBar()
      }
    })
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
          await this.registerReaderSideBar()
        }
      }
    }, [
      "tab",
    ]);
  }

  private addStyle(parentNode?: HTMLElement, id: string = this.id) {
    ztoolkit.UI.appendElement({
      tag: "style",
      id: `${config.addonRef}-style`,
      namespace: "html",
      properties: {
        innerHTML: `
          #${id} {
            padding: 0px;
          }
          #${id} .figure-box {
            padding: 10px;
            transition: background-color .23s;
          }
          #${id} .figure-box:hover {
            background-color: rgba(22, 152, 149, 0.2);
          }
          #${id} .figure-box:active {
            background-color: rgba(22, 152, 149, 0.3);
          }
          #${id} .figure-box .caption {
            margin-bottom: 5px;
          }
          #${id} .figure-box .figure, #${id} .figure-box .caption {
            cursor: pointer;
          }
          #figureView::before {
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 576 512'%3E%3C!--! Font Awesome Free 6.2.1 by %40fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0  Fonts: SIL OFL 1.1  Code: MIT License) Copyright 2022 Fonticons  Inc. --%3E%3Cpath d='M512 32H160c-35.35 0-64 28.65-64 64v224c0 35.35 28.65 64 64 64H512c35.35 0 64-28.65 64-64V96C576 60.65 547.3 32 512 32zM528 320c0 8.822-7.178 16-16 16h-16l-109.3-160.9C383.7 170.7 378.7 168 373.3 168c-5.352 0-10.35 2.672-13.31 7.125l-62.74 94.11L274.9 238.6C271.9 234.4 267.1 232 262 232c-5.109 0-9.914 2.441-12.93 6.574L176 336H160c-8.822 0-16-7.178-16-16V96c0-8.822 7.178-16 16-16H512c8.822 0 16 7.178 16 16V320zM224 112c-17.67 0-32 14.33-32 32s14.33 32 32 32c17.68 0 32-14.33 32-32S241.7 112 224 112zM456 480H120C53.83 480 0 426.2 0 360v-240C0 106.8 10.75 96 24 96S48 106.8 48 120v240c0 39.7 32.3 72 72 72h336c13.25 0 24 10.75 24 24S469.3 480 456 480z' fill='%23555555'/%3E%3C/svg%3E");
              display: inline-block;
              vertical-align: top;
              width: 16px;
              height: 16px;
              content: "";
          }
          #figureView.toggled::before {
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 576 512'%3E%3C!--! Font Awesome Free 6.2.1 by %40fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0  Fonts: SIL OFL 1.1  Code: MIT License) Copyright 2022 Fonticons  Inc. --%3E%3Cpath d='M512 32H160c-35.35 0-64 28.65-64 64v224c0 35.35 28.65 64 64 64H512c35.35 0 64-28.65 64-64V96C576 60.65 547.3 32 512 32zM528 320c0 8.822-7.178 16-16 16h-16l-109.3-160.9C383.7 170.7 378.7 168 373.3 168c-5.352 0-10.35 2.672-13.31 7.125l-62.74 94.11L274.9 238.6C271.9 234.4 267.1 232 262 232c-5.109 0-9.914 2.441-12.93 6.574L176 336H160c-8.822 0-16-7.178-16-16V96c0-8.822 7.178-16 16-16H512c8.822 0 16 7.178 16 16V320zM224 112c-17.67 0-32 14.33-32 32s14.33 32 32 32c17.68 0 32-14.33 32-32S241.7 112 224 112zM456 480H120C53.83 480 0 426.2 0 360v-240C0 106.8 10.75 96 24 96S48 106.8 48 120v240c0 39.7 32.3 72 72 72h336c13.25 0 24 10.75 24 24S469.3 480 456 480z' fill='white'/%3E%3C/svg%3E");
          }
        `
      },
      // #output-container div.streaming span:after,  
    }, parentNode || document.documentElement);
  }

  /**
   * 注册阅读侧边栏
   */
  public async registerReaderTabPanel() {
    ztoolkit.ReaderTabPanel.register(
      getString("tabpanel.reader.tab.label"),
      (
        panel: XUL.TabPanel | undefined,
        deck: XUL.Deck,
        win: Window,
        reader: _ZoteroTypes.ReaderInstance
      ) => {
        if (!panel) {
          ztoolkit.log(
            "This reader do not have right-side bar. Adding reader tab skipped."
          );
          return;
        }

        const container = ztoolkit.UI.appendElement({
          tag: "relatedbox",
          id: this.id,
          namespace: "xul",
          attributes: {
            flex: "1",
          },
          styles: {
            // padding: "10px"
          },
          children: [
            {
              tag: "div",
              // namespace: "xul",
              namespace: "html",
              classList: ["container"],
              styles: {
                display: "inline",
              },
              children: []
            }
          ]
        }, panel).querySelector("div.container") as XUL.Box
        window.setTimeout(async () => {
          const figures = await this.getFigures(reader, true)
          if (figures.length) {
            await this.renderToContainer(container, figures)
          }
        })
        
      },
      {
        tabId: "zotero-figure",
      }
    )
  }

  private async getValidFilepath(pdfItem: Zotero.Item) {
    let filepath = await pdfItem.getFilePathAsync() as string
    // 不合法文件处理
    // @ts-ignore
    const origName = window.OS.Path.basename(filepath)
    if (origName.indexOf(",") >= 0) {
      let newName = origName.replace(/,/g, "_")
      if (
        Zotero.Prompt.confirm({
          title: "Confirm",
          text: `"${origName}" is not available for PDFFigures2, rename it to "${newName}".`,
          button0: "Rename",
          button1: "Cancle",
          checkbox: {}
        }) == 0
      ) {
        await pdfItem.renameAttachmentFile(newName);
        filepath = await pdfItem.getFilePathAsync() as string
      }
    }
    return filepath
  }

  private async getFigures(reader: _ZoteroTypes.ReaderInstance, popupWin: any) {
    // 运行
    const pdfItem = Zotero.Items.get(reader._itemID)
    let filename = await this.getValidFilepath(pdfItem)
    
    /**
     * java -jar E:/Zotero/pdffigures2.jar "E:\OneDrive\OneDrive - junblue\Zotero\JRST\Jin et al_2021_Improved Bi-Angle Aerosol Optical Depth Retrieval Algorithm from AHI Data Based.pdf" -d E:\Github\scipdf_parser\figures\data\ -m  E:\Github\scipdf_parser\figures\figures\ -i 300
     */
    // @ts-ignore
    const OS = window.OS
    const zoteroDir = Zotero.DataDirectory._dir
    const addonDir = OS.Path.join(zoteroDir, config.addonRef)
    const dataDir = OS.Path.join(addonDir, "data")
    const figureDir = OS.Path.join(addonDir, "figure")

    // const cmdPath = Zotero.Prefs.get(`${config.addonRef}.path.cmd`) as string
    const javaPath = Zotero.Prefs.get(`${config.addonRef}.path.java`) as string

    const key = pdfItem.key
    const args = [
      "-jar",
      OS.Path.join(zoteroDir, "pdffigures2.jar"),
      filename,
      "-d",
      OS.Path.join(dataDir, key),
      "-m",
      figureDir + "/",
      "-i",
      "300",
      "-t",
      "8"
    ]
    if (!await OS.File.exists(addonDir)) {
      await OS.File.makeDir(addonDir);
    }
    if (!await OS.File.exists(dataDir)) {
      await OS.File.makeDir(dataDir);
    }
    if (!await OS.File.exists(figureDir)) {
      await OS.File.makeDir(figureDir);
    }
    let getTargetFile = () => {
      const files = Zotero.File.pathToFile(dataDir).directoryEntries
      let targetFile: string | undefined
      while (files.hasMoreElements()) {
        const file = files.getNext().QueryInterface(Components.interfaces.nsIFile);
        if ((file.leafName as string).startsWith(key)) {
          targetFile = OS.Path.join(dataDir, file.leafName)
          break
        }
      }
      return targetFile
    }
    let targetFile: string | undefined = getTargetFile();
    if (!targetFile) {
      popupWin.createLine({ text: "Parsing figures...", type: "default" })
      await Zotero.Utilities.Internal.exec(javaPath, args);
    }
    popupWin.createLine({ text: "Searching json...", type: "default" })
    // 等待写入生成json
    let count = 0
    while (!(targetFile = getTargetFile()) && count < 10) {
      await Zotero.Promise.delay(1000)
      count += 1
    }
    if (targetFile) {
      popupWin.createLine({ text: "Reading json...", type: "success" })
      const charset = Zotero.Prefs.get(`${config.addonRef}.charset`) as string
      const figures = JSON.parse(await Zotero.File.getContentsAsync(targetFile, charset) as string) as Figure[]
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

  private async renderToContainer(container: HTMLDivElement, figures: Figure[], popupWin: any) {
    figures.sort((a: any, b: any) => Number(a.page) - Number(b.page))
    popupWin.createLine({ text: `[${0}/${figures.length}] Loading Figures`, progress: 0 })
    const idx = popupWin.lines.length - 1
    const tasks = figures.map(async (figure) => {
      const base64data = await Zotero.File.generateDataURI(
        figure.renderURL, 'image/png'
      )
      ztoolkit.UI.appendElement({
        namespace: "html",
        tag: "div",
        classList: ["figure-box"],
        styles: {
          // display: "initial",
          // flexDirection: "column",
        },
        children: [
          {
            tag: "span",
            classList: ["caption"],
            properties: {
              innerText: figure.caption,
            },
            styles: {
              display: "inline-block",
              wordWrap: "break-word",
              width: "100%",
              textAlign: "justify",
              color: "#323B4C"
            },
            listeners: [
              {
                type: "click",
                listener: async () => {
                  ztoolkit.log(figure)
                  const reader = await ztoolkit.Reader.getReader()
                  const pdfWin = (reader!._iframeWindow as any).wrappedJSObject
                  const height = pdfWin.PDFViewerApplication.pdfViewer._pages[0].viewport.viewBox[3]
                  pdfWin.eval(`
                      PDFViewerApplication.pdfViewer.scrollPageIntoView({
                        pageNumber: ${figure.page + 1},
                        destArray: ${JSON.stringify([null, { name: "XYZ" }, figure.regionBoundary.x1, height - figure.regionBoundary.y1, pdfWin.PDFViewerApplication.pdfViewer._pages[0].scale])},
                        allowNegativeOffset: false,
                        ignoreDestinationZoom: false
                      })
                    `);
                  new ztoolkit.ProgressWindow(`To ${figure.figType}`, { closeOtherProgressWindows: true, closeTime: 1000 })
                    .createLine({ text: figure.caption.slice(0, 30) + "...", type: "success" })
                    .show()
                }
              }
            ]
          },
          {
            tag: "img",
            classList: ["figure"],
            styles: {
              maxHeight: "100%",
              maxWidth: `100%`
            },
            attributes: {
              src: base64data
            },
            listeners: [
              {
                type: "click",
                listener: () => {
                  new ztoolkit.Clipboard()
                    .addImage(base64data)
                    .copy()
                  new ztoolkit.ProgressWindow(`Copy ${figure.figType}`, { closeOtherProgressWindows: true, closeTime: 1000 })
                    .createLine({ text: figure.caption.slice(0, 30) + "...", type: "success" })
                    .show()
                }
              },
              {
                type: "dblclick",
                listener: () => {
                  if (Zotero.BetterNotes?.hooks?.onShowImageViewer) {
                    Zotero.BetterNotes?.hooks?.onShowImageViewer(
                      [...container.querySelectorAll(".figure-box .figure")].map(e => e.src),
                      figures.indexOf(figure),
                      "Figure"
                    )
                  }
                }
              }
            ]
          },

        ]

      }, container)
    })
    // 逐个等待
    for (let i = 0; i < tasks.length;i++) {
      const progress = 100 * i / figures.length
      popupWin.changeLine({ text: `[${i}/${figures.length}] ${(progress).toFixed(2)}%`, progress: progress, idx })
      await tasks[i]
    }
    popupWin.changeLine({ text: `[${figures.length}/${figures.length}] Done`, type: "success", idx })
    popupWin.startCloseTimer(3000)
    popupWin.createLine({ text: "Finished", type: "default" })
  }

  private async loading(reader: _ZoteroTypes.ReaderInstance, container: HTMLDivElement) {
    const popupWin = new ztoolkit.ProgressWindow(config.addonName, { closeOtherProgressWindows: true, closeTime: -1 })
      .createLine({ text: "Start", type: "default" })
      .show()
    const figures = await this.getFigures(reader, popupWin)
    if (figures.length) {
      await this.renderToContainer(container, figures, popupWin)
    }
  }

  public async registerReaderSideBar(): Promise<void>{
    const reader = await ztoolkit.Reader.getReader(10e3) as _ZoteroTypes.ReaderInstance
    const win = (reader?._iframeWindow! as any).wrappedJSObject
    const doc = win.document! as Document
    this.addStyle(doc.documentElement as any, "sidebarContainer")
    const sideBarContainer = doc.querySelector("#sidebarContainer") as HTMLDivElement
    const buttonContainer = sideBarContainer.querySelector(".splitToolbarButton") as HTMLDivElement
    const buttonID = "figureView"
    if (buttonContainer.querySelector(`#${buttonID}`)) { return }
    const button = buttonContainer.querySelector("button")!.cloneNode(true) as HTMLButtonElement
    buttonContainer.append(button)
    button.setAttribute("title", "Display all figures and tables in the document")
    button.setAttribute("id", buttonID)

    const sidebarContent = sideBarContainer.querySelector("#sidebarContent") as HTMLDivElement
    const container = ztoolkit.UI.appendElement({
      tag: "div",
      id: "viewFigure",
      classList: ["hide"],
    }, sidebarContent)  as HTMLDivElement
    
    // 参考Chartero
    const btns = [...doc.getElementById('toolbarSidebarLeft')!.getElementsByTagName('button')];
    const ctns = [...sidebarContent.children];

    const that = this
    let isRendered = false
    for (const btn of btns) {
      btn.addEventListener("click", async function () {
        window.setTimeout(async () => {
          if (btn.id == buttonID) {
            if (!isRendered) {
              isRendered = true
              window.setTimeout(async () => { await that.loading(reader, container) }, 100)
            }
            win.PDFViewerApplication.pdfSidebar.active = 7;
            btns.forEach(e => e.classList.toggle('toggled', false));
            ctns.forEach(e =>e.classList.toggle('hidden', true))
            btn.classList.toggle('toggled', true);
            container.classList.toggle('hidden', false);
          } else {
            button.classList.toggle('toggled', false);
            container.classList.toggle('hidden', true);
          }
        })
      })
    }
  }
}


interface Boundary{
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
  captionBoundary: Boundary;
  figType: "Figure" | "Table"
}