import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

const documents = [
  "AGENTS.md",
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/KNOWN_LIMITATIONS.md",
  "docs/MODEL_DISTRIBUTION.md",
  "docs/PERFORMANCE.md",
  "docs/README.es-ES.md",
  "docs/README.it-IT.md",
  "docs/README.ja-JP.md",
  "docs/README.ru-RU.md",
  "docs/README.zh-CN.md",
];

const readmeContracts = [
  {
    batch: /main-window batch workflows/,
    file: "README.md",
    rollback: /rolled back; uncommitted PNG/,
  },
  {
    batch: /flujos por lotes de la ventana principal/,
    file: "docs/README.es-ES.md",
    rollback: /se revierten.*PNG no confirmadas/,
  },
  {
    batch: /flussi batch della finestra principale/,
    file: "docs/README.it-IT.md",
    rollback: /vengono annullate.*PNG non confermate/,
  },
  {
    batch: /メイン画面のバッチ処理/,
    file: "docs/README.ja-JP.md",
    rollback: /ロールバック.*未コミットの PNG/,
  },
  {
    batch: /пакетная обработка в главном окне/,
    file: "docs/README.ru-RU.md",
    rollback: /откатываются.*незафиксированные записи PNG/,
  },
  {
    batch: /主界面批量处理/,
    file: "docs/README.zh-CN.md",
    rollback: /回滚.*未提交的 PNG/,
  },
];

test("all documented local links resolve", () => {
  for (const document of documents) {
    const content = readFileSync(document, "utf8");
    const links = [...content.matchAll(/\]\(([^)]+)\)/g)].map(
      (match) => match[1],
    );
    for (const link of links) {
      if (/^(?:https?:|#)/.test(link)) continue;
      const target = path.resolve(
        path.dirname(document),
        link.split("#", 1)[0],
      );
      assert.equal(existsSync(target), true, `${document} -> ${link}`);
    }
  }
});

test("all README translations document the same runtime contracts", () => {
  for (const { batch, file, rollback } of readmeContracts) {
    const content = readFileSync(file, "utf8");
    for (const token of [
      "Figure N",
      "Table N",
      "Formula N",
      "PDF Figure >",
      "Zotero 9",
    ]) {
      assert.ok(content.includes(token), `${file} -> ${token}`);
    }
    assert.match(content, batch, `${file} -> implemented batch workflow`);
    assert.match(content, rollback, `${file} -> rollback behavior`);
  }
});

test("model comparison sources and reports do not expose user directories", () => {
  for (const file of [
    "scripts/compare-layout-models.mjs",
    "scripts/model-comparison-report.mjs",
    "docs/model-comparison/bilal-2015/index.html",
    "docs/model-comparison/bilal-2015/results.json",
  ]) {
    const content = readFileSync(file, "utf8");
    assert.doesNotMatch(content, /\/Users\//, file);
    assert.doesNotMatch(content, /[A-Za-z]:\\Users\\/, file);
  }
});
