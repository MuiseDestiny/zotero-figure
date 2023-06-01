import { config } from "../../package.json";

export default class Views {
  constructor() {
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
        const wtPath = "C:\\Users\\polygon\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe"
        const javaPath = "C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe"
        const key = pdfItem.key
        const args = [
          javaPath,
          "-jar",
          OS.Path.join(zoteroDir, "pdffigures2-assembly-0.0.12-SNAPSHOT.jar"),
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
            await Zotero.Utilities.Internal.exec(wtPath, args);
          }
          let count = 0
          while (!(targetFile = getTargetFile()) && count < 10) {
            await Zotero.Promise.delay(1000)
          }
          if (targetFile) {
            const figures = JSON.parse(await Zotero.File.getContentsAsync(targetFile) as string) as Figure[]
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
    const maxWidth = 300
    const vbox = ztoolkit.UI.appendElement({
      namespace: "xul",
      tag: "vbox",
      styles: {
        margin: "10px"
      }
    }, panel)
    figures.sort((a: any, b: any) => Number(a.page) - Number(b.page))
    for (let figure of figures) {
      const imageData = await Zotero.File.getBinaryContentsAsync(figure.renderURL);
      const array = new window.Uint8Array(imageData.length);
      for (let i = 0; i < imageData.length; i++) {
        array[i] = imageData.charCodeAt(i);
      }
      const blob = new window.Blob([array], { type: "image/png" });
      const reader = new window.FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = function () {
        const base64data = reader.result;
        ztoolkit.UI.appendElement({
          namespace: "html",
          tag: "div",
          styles: {
            display: "flex",
            flexDirection: "column",
          },
          children: [
            {
              tag: "span",
              properties: {
                innerText: figure.caption,
              },
              styles: {
                display: "inline-block", 
                wordWrap: "break-word",
                width: `${maxWidth}px`
              }
            },
            {
              tag: "img",
              styles: {
                maxHeight: "100%",
                maxWidth: `${maxWidth}px`
              },
              attributes: {
                src: base64data as string
              }
            },
            
          ]

        }, vbox)
      };
      
    }
  }

}


interface Figure {
  caption: string;
  name: string;
  page: number;
  renderURL: string
}