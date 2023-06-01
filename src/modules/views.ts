import { config } from "../../package.json";

export default class Views {
  private id = config.addonRef
  constructor() {
    this.addStyle()
  }

  private addStyle(parentNode?: HTMLElement) {
    ztoolkit.UI.appendElement({
      tag: "style",
      id: `${config.addonRef}-style`,
      namespace: "html",
      properties: {
        innerHTML: `
          #${this.id} {
          }
          #${this.id} .figure-box {
            padding: 10px;
            transition: background-color .23s;
          }
          #${this.id} .figure-box:hover {
            background-color: rgba(0,0,0, 0.05);
          }
          #${this.id} .figure-box .caption {
            margin-bottom: 5px;
          }
          #${this.id} .figure-box .figure, #${this.id} .figure-box .caption {
            cursor: pointer;
          }
        `
      },
      // #output-container div.streaming span:after,  
    }, parentNode || document.documentElement);
  }

  /**
   * 注册阅读侧边栏
   */
  public async onInit() {
    ztoolkit.ReaderTabPanel.register(
      "Figure",
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

        // 运行
        const pdfItem = Zotero.Items.get(reader._itemID)
        const filename = pdfItem.getFilePath()
        /**
         * java -jar pdffigures2-assembly-0.0.12-SNAPSHOT.jar "E:\OneDrive\OneDrive - junblue\Zotero\JRST\人工智能前沿\Zhong et al_2023_Can ChatGPT Understand Too.pdf" -d E:\Github\scipdf_parser\build\lib\scipdf\pdf\pdffigures2\ -m  E:\Github\scipdf_parser\build\lib\scipdf\pdf\pdffigures2\ -i 300
         */
        // @ts-ignore
        const OS = window.OS
        const zoteroDir = Zotero.DataDirectory._dir
        const addonDir = OS.Path.join(zoteroDir, config.addonRef)
        const dataDir = OS.Path.join(addonDir, "data")
        const figureDir = OS.Path.join(addonDir, "figure")

        const cmdPath = Zotero.Prefs.get(`${config.addonRef}.path.cmd`) as string
        const javaPath = Zotero.Prefs.get(`${config.addonRef}.path.java`) as string

        const key = pdfItem.key
        const args = [
          javaPath,
          "-jar",
          OS.Path.join(zoteroDir, "pdffigures2.jar"),
          filename,
          "-d",
          OS.Path.join(dataDir, key),
          "-m",
          figureDir + "/",
          "-i",
          "300"
        ]
        ztoolkit.log(args)
        window.setTimeout(async () => {
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
              ztoolkit.log(file.leafName, key)
              if ((file.leafName as string).startsWith(key)) {
                targetFile = file.target as string
                break
              }
            }
            return targetFile
          }
          let targetFile: string | undefined = getTargetFile();
          if (!targetFile) {
            await Zotero.Utilities.Internal.exec(cmdPath, args);
          }
          let count = 0
          while (!(targetFile = getTargetFile()) && count < 10) {
            await Zotero.Promise.delay(1000)
          }
          if (targetFile) {
            const figures = window.eval(await Zotero.File.getContentsAsync(targetFile, "gbk") as string) as Figure[]
            ztoolkit.log(figures)
            await this.renderPanel(panel, figures)
          } else {
            ztoolkit.log("未检测到生成数据文件")
          }
        })
      },
      {
        tabId: "zotero-figure",
      }
    )
  }

  private async renderPanel(panel: XUL.TabPanel, figures: Figure[]) {
    // const maxWidth = 300
    const container = ztoolkit.UI.appendElement(
      {
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
            namespace: "xul",
            classList: ["container"],
            styles: {
              display: "inline",
            },
            children: []
          }
        ]
      }, panel).querySelector("div.container") as XUL.Box
    figures.sort((a: any, b: any) => Number(a.page) - Number(b.page))
    const popupWin = new ztoolkit.ProgressWindow("Loading Figures", { closeOtherProgressWindows: true, closeTime: -1})
      .createLine({ text: `[${0}/${figures.length}] 0%`, progress: 0 })
    .show()
    figures.forEach(async (figure) => {
      ztoolkit.log(figure.caption)
      const imageData = await Zotero.File.getBinaryContentsAsync(figure.renderURL);
      const array = new window.Uint8Array(imageData.length);
      for (let i = 0; i < imageData.length; i++) {
        array[i] = imageData.charCodeAt(i);
      }
      const blob = new window.Blob([array], { type: "image/png" });
      const reader = new window.FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = function () {
        const base64data = reader.result as string;
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
                textAlign: "justify"
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
                    new ztoolkit.ProgressWindow(`To ${figure.figType}`, { closeOtherProgressWindows: true, closeTime: 500 })
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
                    new ztoolkit.ProgressWindow(`Copy ${figure.figType}`, { closeOtherProgressWindows: true, closeTime: 500 })
                      .createLine({ text: figure.caption.slice(0, 30) + "...", type: "success" })
                      .show()
                  }
                }
              ]
            },
            
          ]

        }, container)
        const i = figures.indexOf(figure) + 1
        const progress = 100 * i / figures.length
        popupWin.changeLine({ text: `[${i}/${figures.length}] ${(progress).toFixed(2)}%`, progress: progress })
        if (i == figures.length - 1) {
          popupWin.changeLine({ text: `[${i}/${figures.length}] 100%`, type: "success" })
          popupWin.startCloseTimer(3000)
        }
      }
    })
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