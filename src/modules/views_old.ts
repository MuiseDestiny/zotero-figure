/* eslint-disable @typescript-eslint/no-this-alias */
/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
import { config } from "../../package.json";

export default class Views {
  private id = config.addonRef
  private dataDir: string;
  private figureDir: string;
  private zoteroDir: string;
  private addonDir: string;
  private buttonID = "figureView";
  private containerID = "annotationsView"
  private figureBoxContainerID = "figure-box-container"
  private cache: { [key: string]: string } = { } ;
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
    // @ts-ignore
    const OS = window.OS
    this.zoteroDir = Zotero.DataDirectory._dir
    this.addonDir = OS.Path.join(this.zoteroDir, config.addonRef)
    this.dataDir = OS.Path.join(this.addonDir, "data")
    this.figureDir = OS.Path.join(this.addonDir, "figure")
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

  private async getFigures(reader: _ZoteroTypes.ReaderInstance, local: boolean, popupWin: any) {
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
      "-m",
      this.figureDir + "/",
      "-i",
      "300",
      "-t",
      "8"
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
    let targetFile: string | undefined = this.getJsonFilepath(pdfItem);
    if (!targetFile || local == false) {
      popupWin.createLine({ text: "Parsing figures...", type: "default" })
      await Zotero.Utilities.Internal.exec(javaPath, args);
    }
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

  private getShortString(s: string, maxLength = 30) {
    return s.length > maxLength ? s.slice(0, maxLength) + "..." : s
  }

  private async renderToContainer(container: HTMLDivElement, figures: Figure[], popupWin: any) {
    figures.sort((a: any, b: any) => Number(a.page) - Number(b.page))
    popupWin.createLine({ text: `[${0}/${figures.length}] Loading Figures`, progress: 0 })
    const idx = popupWin.lines.length - 1
    const tasks = figures.map(async (figure) => {
      let base64data: string
      if (figure.renderURL.startsWith("data:image/png")) {
        base64data = figure.renderURL;
      } else {
        base64data = this.cache[figure.renderURL] ??= await Zotero.File.generateDataURI(
          figure.renderURL, 'image/png'
        )
      }
      let timer: undefined | number
      const figureBox = ztoolkit.UI.appendElement({
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
              color: "#323B4C",
              fontFamily: "initial"
            },
            listeners: [
              {
                type: "click",
                listener: async () => {
                  ztoolkit.log(figure)
                  const reader = await ztoolkit.Reader.getReader()
                  const pdfWin = (reader!._iframeWindow as any).wrappedJSObject.document.querySelector("iframe").contentWindow
                  const height = pdfWin.PDFViewerApplication.pdfViewer._pages[0].viewport.viewBox[3]
                  const codeString = `
                      PDFViewerApplication.pdfViewer.scrollPageIntoView({
                        pageNumber: ${figure.page + 1},
                        destArray: [null, { name: "XYZ" }, ${figure.regionBoundary.x1}, ${height - figure.regionBoundary.y1}, ${pdfWin.PDFViewerApplication.pdfViewer._pages[0].scale}],
                        allowNegativeOffset: false,
                        ignoreDestinationZoom: false
                      })
                    `
                  pdfWin.eval(codeString);
                  ztoolkit.log(codeString)
                  new ztoolkit.ProgressWindow(`To ${figure.figType}`, { closeOtherProgressWindows: true, closeTime: 1000 })
                    .createLine({ text: this.getShortString(figure.caption), type: "success" })
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
                    .createLine({ text: this.getShortString(figure.caption), type: "success" })
                    .show()
                }
              },
              {
                type: "dblclick",
                listener: () => {
                  if (Zotero.BetterNotes?.hooks?.onShowImageViewer) {
                    // @ts-ignore
                    const srcs = [...container.querySelectorAll(".figure-box .figure")].map(e => e.src)
                    Zotero.BetterNotes?.hooks?.onShowImageViewer(
                      srcs,
                      srcs.indexOf(base64data),
                      "Figure"
                    )
                  }
                }
              }
            ]
          },

        ],
        listeners: [
          {
            type: "mousedown",
            listener: () => {
              timer = window.setTimeout(async () => {
                const dialogData: { [key: string | number]: any } = {
                  caption: figure.caption || ""
                }
                // 触发编辑
                const dialog = new ztoolkit.Dialog(1, 1)
                  .setDialogData(dialogData)
                  .addCell(0, 0, {
                    tag: "input",
                    id: "caption",
                    attributes: {
                      "data-bind": "caption",
                      "data-prop": "value",
                      type: "text",
                    },
                    styles: {
                      width: "10em",
                      height: "2em"
                    }
                  })
                  .addButton("Update", "update")
                  .addButton("Remove", "remove")
                  .addButton("Cancel", "cancel")
                  .open("Edit")
                await dialogData.unloadLock?.promise;
                ztoolkit.log(dialog, dialogData)
                const reader = await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance
                const pdfItem = reader._item;
                const filepath = await this.getJsonFilepath(pdfItem) as string
                if (dialogData._lastButtonId == "update") {
                  // 更新逻辑
                  (figureBox.querySelector("span.caption")! as HTMLSpanElement).innerText = figure.caption = dialogData.caption
                  // 保存
                  await Zotero.File.putContentsAsync(filepath, JSON.stringify(figures))
                  new ztoolkit.ProgressWindow(config.addonName)
                    .createLine({ text: "Update", type: "success" })
                    .show()
                }
                if (dialogData._lastButtonId == "remove") {
                  // 删除逻辑
                  figureBox.remove()
                  figures = figures.filter(x => x !== figure)
                  await Zotero.File.putContentsAsync(filepath, JSON.stringify(figures))
                  new ztoolkit.ProgressWindow(config.addonName)
                    .createLine({ text: "Remove", type: "success" })
                    .show()
                }
              }, 1000)
            }
          },
          {
            type: "mouseup",
            listener: () => {
              window.clearTimeout(timer)
            }
          }
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

  private async loading(reader: _ZoteroTypes.ReaderInstance, container: HTMLDivElement, local = true) {
    const popupWin = new ztoolkit.ProgressWindow(config.addonName, { closeOtherProgressWindows: true, closeTime: -1 })
      .createLine({ text: "Start", type: "default" })
      .show()
    const figures = await this.getFigures(reader, local, popupWin)
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
    // const buttonID = "figureView"
    // const containerID = "viewFigure"
    if (buttonContainer.querySelector(`#sidebarContainer .splitToolbarButton #${this.buttonID}`)) { return }
    const button = buttonContainer.querySelector("button")!.cloneNode(true) as HTMLButtonElement
    buttonContainer.insertBefore(button, buttonContainer.querySelector("#sidebarContainer .splitToolbarButton #viewOutline")!)
    button.setAttribute("title", "Display all figures and tables in the document")
    button.setAttribute("id", this.buttonID)

    const sidebarContent = sideBarContainer.querySelector("#sidebarContent") as HTMLDivElement
    const container = ztoolkit.UI.appendElement({
      tag: "div",
      classList: ["hide"],
      id: this.containerID,
      styles: {
        display: "flex",
        flexDirection: "column",
      },
      children: [
        {
          tag: "div",
          classList: ["search"],
          children: [
            {
              tag: "div",
              classList: ["icon", "icon-search"],
            },
            {
              tag: "div",
              classList: ["input-group"],
              children: [
                {
                  tag: "input",
                  id: "searchInput",
                  attributes: {
                    tabIndex: "-1",
                    type: "text",
                    placeholder: "搜索图表",
                    value: "",
                  },
                  listeners: [
                    {
                      type: "keyup",
                      listener: () => {
                        if (searchInputNode.value.length > 0) {
                          clearNode.style.display = ""
                        } else {
                          clearNode.style.display = "none"
                        }
                        setFilter(searchInputNode.value)
                      }
                    }
                  ]
                }
              ]
            },
            {
              tag: "button",
              classList: ["clear"],
              styles: {
                display: "none"
              },
              listeners: [
                {
                  type: "click",
                  listener: () => {
                    searchInputNode.value = "";
                    clearNode.style.display = "none"
                    setFilter("")
                  }
                }
              ]
            }
          ]
        },
        {
          tag: "div",
          classList: ["annotations"],
          id: this.figureBoxContainerID,
        }
      ]
    }, sidebarContent)  as HTMLDivElement
    const searchInputNode = container.querySelector("#searchInput") as HTMLInputElement;
    const clearNode = container.querySelector(".clear") as HTMLButtonElement;
    const figureBoxContainer = container.querySelector(`#${this.figureBoxContainerID}`) as HTMLDivElement;
    const setFilter = (keyword: string) => {
      const figureBoxArr = [...figureBoxContainer.querySelectorAll(".figure-box")] as HTMLDivElement[]
      figureBoxArr.forEach(box => {
        if (keyword.length == 0 || box.innerText.match(new RegExp(keyword, "i"))) {
          box.style.display = ""
        } else {
          box.style.display = "none"
        }
      })
    }
    const otherButtons = doc.querySelectorAll(`#sidebarContainer .splitToolbarButton button:not(#${this.buttonID})`)
    let isRendered = false
    button.addEventListener("click", () => {
      if (!isRendered) {
        isRendered = true
        window.setTimeout(async () => {
          await this.loading(reader, container.querySelector(`#${this.figureBoxContainerID}`)!)
          this.addMoreListener()
        }, 100)
        const otherButtons = doc.querySelectorAll(`#sidebarContainer .splitToolbarButton button:not(#${this.buttonID})`)
        otherButtons.forEach(e => e.classList.toggle('toggled', false));
        button.classList.toggle("toggled", true)
      }
      sidebarContent.childNodes.forEach((e: any) => e.style.display = "none")
      container.style.display = "flex"
    })
    otherButtons.forEach(otherButton => {
      otherButton.addEventListener("click", () => {
        otherButtons.forEach(e => e.classList.toggle('toggled', false));
        button.classList.toggle('toggled', false)
        otherButton.classList.toggle("toggled", true)
        sidebarContent.childNodes.forEach((e: any) => e.style.display = "")
        container.style.display = "none"
      })
    })
    // 参考Chartero
    // const btns = [...doc.querySelector('#sidebarContainer .splitToolbarButton')!.getElementsByTagName('button')];
    // const ctns = [...sidebarContent.children];
    // for (const btn of btns) {
    //   btn.addEventListener("click", async function () {
    //     window.setTimeout(async () => {
    //       if (btn.id == that.buttonID) {
    //         if (!isRendered) {
    //           isRendered = true
    //           window.setTimeout(async () => {
    //             await that.loading(reader, container.querySelector(`#${that.figureBoxContainerID}`)!)
    //             that.addMoreListener()
    //           }, 100)
    //         }
    //         win.PDFViewerApplication.pdfSidebar.active = 7;
    //         btns.forEach(e => e.classList.toggle('toggled', false));
    //         ctns.forEach(e =>e.classList.toggle('hidden', true))
    //         btn.classList.toggle('toggled', true);
    //         container.classList.toggle('hidden', false);
    //       } else {
    //         button.classList.toggle('toggled', false);
    //         container.classList.toggle('hidden', true);
    //       }
    //     })
    //   })
    // }
    let timer: number | undefined
    button.addEventListener("mousedown", () => {
      timer = window.setTimeout(async () => {
        figureBoxContainer.querySelectorAll(".figure-box").forEach(e=>e.remove())
        // 执行强制更新
        await this.loading(reader, container.querySelector(`#${this.figureBoxContainerID}`)!, false)
      }, 1000)
    })
    button.addEventListener("mouseup", () => {
      window.clearTimeout(timer)
    })
  }

  private async addMoreListener() {
    const reader = await ztoolkit.Reader.getReader()
    if (!reader) { return }
    const pdfItem = Zotero.Items.get(reader._itemID)
    const that = this
    ztoolkit.patch(
      reader,
      "_openAnnotationPopup",
      "_openAnnotationPopup" + config.addonRef,
      (original) => function (data: any) {
        ztoolkit.log(data)
        // @ts-ignore
        original.call(this, data)
        const annoKey = data.currentID
        const anno = pdfItem.getAnnotations().find(i => i.key === annoKey) as any
        if (anno?.annotationType == "image") {
          const menupopup = reader._popupset.childNodes[0]
          const menuseparator = menupopup.querySelector("menuseparator")
          const menuitem = ztoolkit.UI.insertElementBefore({
            namespace: "xul",
            classList: ["menuitem-iconic"],
            tag: "menuitem",
            attributes: {
              label: "转换为图表",
              image: `chrome://${config.addonRef}/content/icons/favicon.png`
            }
          }, menuseparator) as XUL.MenuItem
          menuitem.addEventListener('command', async () => {
            const caption = anno?.annotationComment || "Untitled Figure/Table"
            const pos = JSON.parse(anno?.annotationPosition)
            const [ll, bb, rr, tt] = pos.rects[0]
            // @ts-ignore
            // anno = reader._iframeWindow.wrappedJSObject.viewerInstance._viewer._annotationsStore._annotations.find(x => data.ids.includes(x.id))! as any
            // json
            const filepath = that.getJsonFilepath(pdfItem) as string;
            // 读取
            const figures = await that.readAsJson(filepath) as Figure[]
            // @ts-ignore
            const height = reader._iframeWindow.wrappedJSObject.PDFViewerApplication.pdfViewer._pages[0].viewport.viewBox[3]
            const figure: Figure = {
              caption,
              name: caption.match(/\d+/)?.[0] || "0",
              page: pos.pageIndex,
              renderURL: data.enableImageOptions.image,
              regionBoundary: {
                x1: ll,
                y1: height - tt,
                x2: rr,
                y2: height - bb,
              },
              // \u56fe: 图
              figType: /(fig|figure|\u56fe)/i.test(caption) ? "Figure" : "Table",
            }
            ztoolkit.log(figure)
            figures.push(figure);
            // 保存
            await Zotero.File.putContentsAsync(filepath, JSON.stringify(figures))
            // 刷新
            const container = reader._iframeWindow?.document.querySelector(`#${that.containerID} #${that.figureBoxContainerID}`) as HTMLDivElement
            container?.childNodes.forEach(e=>e.remove())
            await that.loading(reader, container)
          });
        }
      }
    )
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
  figType: "Figure" | "Table"
}