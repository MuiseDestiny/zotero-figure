# Zotero Figure

Zotero の PDF から図、表、数式を抽出します。

[English](../README.md) | [简体中文](README.zh-CN.md) | [Italiano](README.it-IT.md) | [Русский](README.ru-RU.md) | [日本語](README.ja-JP.md) | [Español](README.es-ES.md)

Zotero Figure は PDF 内の図、表、独立数式、キャプション、表脚注を検出します。PDF の読み込み、描画、レイアウト検出は、プラグインに内蔵されたモデルを使って端末上で実行されます。

## 機能

- PDF ページをアップロードせず、実行時にモデルをダウンロードせずにローカル解析。
- 専用 Reader サイドバーで結果を確認し、結果のない種類を隠す複数選択可能なフィルターで絞り込み、解析進捗を表示。
- 画像のコピー、保存、ピン留め、キャプションの編集、PDF ページの縦横比に合わせた画面での切り抜き補正、PDF ページへの移動、ノートへの追加、結果の削除。
- **PDF Figure Library** で複数文書の結果をまとめて表示し、文書、年、カテゴリ、種類、キャプションで絞り込み。選択を記憶するウォーターフォール表示と文書列表示を切り替えられ、文書列ではページ順を保った結果を比較行に揃え、任意で名前を付けられます。文書ヘッダーをドラッグして列を並べ替え、文書内のカードをドラッグして行を並べ替えたり、画像を右クリックして比較グループに追加したりできます。1 つの文書から同じグループに複数の画像を入れると、セルには主画像と左側のサムネイルが表示され、サムネイルを選ぶと主画像が切り替わります。グループを解散して比較行を削除でき、ツールバーの拡大率コントロールで全プレビューの大きさを変更できます。
- 選択したライブラリアイテムや PDF 添付ファイルを一括解析し、必要に応じてノートや Zotero 注釈を作成。
- Zotero PDF Translate のインストール時にキャプションを翻訳。
- SiliconFlow `Qwen/Qwen3.6-35B-A3B` による任意の LaTeX 認識、KaTeX によるローカル描画、コピー、再認識、CodeMirror ソースエディターと KaTeX ライブプレビューによる編集。
- 元 PDF へ戻れる埋め込み PNG 付き Zotero ノートを作成。
- ローカル結果を Zotero 画像注釈として任意に複製し、同期や他プラグインとの連携に利用。
- 英語、簡体字中国語、イタリア語、ロシア語の UI。

## 必要環境

- Zotero 9。
- [最新リリース](https://github.com/MuiseDestiny/zotero-figure/releases/latest)の Zotero Figure XPI。
- 数式 OCR を使う場合のみ、ネットワーク接続と SiliconFlow API キー。

Java と `pdffigures2.jar` は不要です。

## インストール

1. 最新リリースから `zotero-figure.xpi` をダウンロードします。
2. Zotero の `ツール > プラグイン` でファイルからのインストールを選び、XPI を指定します。
3. 求められた場合は Zotero を再起動します。

## 入口

- **PDF Reader:** PDF を開き、左サイドバーの Zotero Figure アイコンを選択して、図、表、数式の解析を開始します。
- **Figure Library:** `Tools > PDF Figure Library` を開き、複数文書の結果を確認します。カードをダブルクリックすると元 PDF が開きます。
- **一括処理:** ライブラリアイテムまたは PDF 添付ファイルを選択して右クリックし、`PDF Figure >` から解析、ノートへの追加、注釈の作成を実行します。
- **設定:** PDF Figure の設定画面で内蔵モデル、注釈同期、数式 OCR を管理し、Figure Library を直接開くこともできます。**既存の数式を変換**を使うと、全ライブラリの未認識数式を処理できます。

## プライバシー

PDF の解析、描画、レイアウト検出、結果の保存は端末上で行われます。注釈への複製を有効にしない限り、ローカル結果は Zotero Sync を使用しません。

数式 OCR は任意です。API キーの確認では SiliconFlow へテキストだけのリクエストを送信します。数式認識では数式の PNG 切り抜きだけを送信し、PDF ページ全体は送信しません。キーは Zotero のローカル設定に保存されます。SiliconFlow の料金が発生する場合があります。

## リンク

- [リリース](https://github.com/MuiseDestiny/zotero-figure/releases)
- [問題報告](https://github.com/MuiseDestiny/zotero-figure/issues)
- [AGPL-3.0-or-later ライセンス](../LICENSE)
