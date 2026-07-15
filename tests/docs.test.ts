import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

const documents = [
  "AGENTS.md",
  "README.md",
  "docs/KNOWN_LIMITATIONS.md",
  "docs/MODEL_DISTRIBUTION.md",
  "docs/README.es-ES.md",
  "docs/README.it-IT.md",
  "docs/README.ja-JP.md",
  "docs/README.ru-RU.md",
  "docs/README.zh-CN.md",
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
