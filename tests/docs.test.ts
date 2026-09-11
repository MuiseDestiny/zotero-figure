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
    batchEntry: /Batch Processing:/,
    file: "README.md",
    formulaBackfill: /Convert existing formulae/,
    galleryEntry: /Figure Library:/,
    preferencesEntry: /Preferences:/,
  },
  {
    batchEntry: /Procesamiento por lotes:/,
    file: "docs/README.es-ES.md",
    formulaBackfill: /Convertir fórmulas existentes/,
    galleryEntry: /Biblioteca de figuras:/,
    preferencesEntry: /Preferencias:/,
  },
  {
    batchEntry: /Elaborazione batch:/,
    file: "docs/README.it-IT.md",
    formulaBackfill: /Converti formule esistenti/,
    galleryEntry: /Libreria di figure:/,
    preferencesEntry: /Preferenze:/,
  },
  {
    batchEntry: /一括処理:/,
    file: "docs/README.ja-JP.md",
    formulaBackfill: /既存の数式を変換/,
    galleryEntry: /Figure Library:/,
    preferencesEntry: /設定:/,
  },
  {
    batchEntry: /Пакетная обработка:/,
    file: "docs/README.ru-RU.md",
    formulaBackfill: /Преобразовать существующие формулы/,
    galleryEntry: /Библиотека иллюстраций:/,
    preferencesEntry: /Настройки:/,
  },
  {
    batchEntry: /批量处理：/,
    file: "docs/README.zh-CN.md",
    formulaBackfill: /转换已有公式/,
    galleryEntry: /图表库：/,
    preferencesEntry: /设置：/,
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

test("all README translations document the same user entry points", () => {
  for (const {
    batchEntry,
    file,
    formulaBackfill,
    galleryEntry,
    preferencesEntry,
  } of readmeContracts) {
    const content = readFileSync(file, "utf8");
    for (const token of [
      "PDF Figure >",
      "Zotero 10",
      "SiliconFlow",
      "Qwen/Qwen3.6-35B-A3B",
      "KaTeX",
      "LaTeX",
      "CodeMirror",
    ]) {
      assert.ok(content.includes(token), `${file} -> ${token}`);
    }
    assert.match(content, batchEntry, `${file} -> batch entry point`);
    assert.match(
      content,
      formulaBackfill,
      `${file} -> formula backfill action`,
    );
    assert.match(content, galleryEntry, `${file} -> gallery entry point`);
    assert.match(
      content,
      preferencesEntry,
      `${file} -> preferences entry point`,
    );
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
