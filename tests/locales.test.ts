import * as assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";
import modelManifest = require("../model-manifest.json");

const locales = ["en-US", "it-IT", "ru-RU", "zh-CN"];
const files = ["addon.ftl", "preferences.ftl"];

test("all runtime locales expose the same Fluent message keys", () => {
  for (const file of files) {
    const reference = readKeys(`addon/locale/en-US/${file}`);
    for (const locale of locales.slice(1)) {
      assert.deepEqual(
        readKeys(`addon/locale/${locale}/${file}`),
        reference,
        `${locale}/${file} does not match en-US`,
      );
    }
  }
});

test("translated Fluent messages preserve the same variables", () => {
  for (const file of files) {
    const reference = readVariables(`addon/locale/en-US/${file}`);
    for (const locale of locales.slice(1)) {
      assert.deepEqual(
        readVariables(`addon/locale/${locale}/${file}`),
        reference,
        `${locale}/${file} does not preserve Fluent variables`,
      );
    }
  }
});

test("runtime Fluent contains every message requested by source code", () => {
  const runtimeKeys = new Set(readKeys("addon/locale/en-US/addon.ftl"));
  const requestedKeys = findTypeScriptFiles("src")
    .filter((file) => file !== "src/utils/locale.ts")
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/getString\(\s*"([\w-]+)"/g)].map(
        (match) => match[1],
      ),
    );
  requestedKeys.push(...modelManifest.variants.map(({ labelKey }) => labelKey));
  requestedKeys.push(...readGalleryMessageKeys());

  assert.deepEqual(
    [...new Set(requestedKeys)].filter((key) => !runtimeKeys.has(key)).sort(),
    [],
  );
});

function readGalleryMessageKeys(): string[] {
  const source = readFileSync(
    "src/features/gallery/figureGalleryView.ts",
    "utf8",
  );
  const keys = [
    ...source.matchAll(
      /setLocalizedText\(\s*[^,]+,\s*["`](gallery-[\w-]+)["`]/g,
    ),
    ...source.matchAll(/localize\(\s*["`](gallery-[\w-]+)["`]/g),
    ...source.matchAll(/showState\(\s*[^,]+,\s*["`](gallery-[\w-]+)["`]/g),
    ...source.matchAll(
      /populateSelect\([\s\S]*?\n\s*["`](gallery-filter-all-[\w-]+)["`]/g,
    ),
  ].map((match) => match[1]);
  keys.push("gallery-empty-filtered", "gallery-empty-library");
  return [...new Set(keys.filter((key) => !key.endsWith("-")))];
}

function readKeys(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line) => line.match(/^([a-zA-Z][\w-]*)\s*=/)?.[1] ?? [])
    .sort();
}

function readVariables(path: string): Record<string, string[]> {
  const messages: Record<string, string> = {};
  let currentKey: string | undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const key = line.match(/^([a-zA-Z][\w-]*)\s*=/)?.[1];
    if (key) {
      currentKey = key;
      messages[key] = line;
    } else if (currentKey && /^\s+/.test(line)) {
      messages[currentKey] += `\n${line}`;
    } else if (line.trim()) {
      currentKey = undefined;
    }
  }

  const entries = Object.entries(messages).map(
    ([key, message]): [string, string[]] => [
      key,
      [...message.matchAll(/\{\s*\$([\w-]+)/g)]
        .map((match) => match[1])
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort(),
    ],
  );
  entries.sort(([first], [second]) => first.localeCompare(second));
  return Object.fromEntries(entries);
}

function findTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTypeScriptFiles(entryPath);
    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}
