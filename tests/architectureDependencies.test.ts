import * as assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";
import * as ts from "typescript";

type Layer = "domain" | "features" | "platform/zotero" | "services" | "utils";

const sourceRoot = path.resolve("src");
const allowedDependencies: Record<Layer, ReadonlySet<Layer>> = {
  domain: new Set(["domain"]),
  features: new Set([
    "domain",
    "features",
    "platform/zotero",
    "services",
    "utils",
  ]),
  "platform/zotero": new Set(["domain", "platform/zotero", "utils"]),
  services: new Set(["domain", "platform/zotero", "services", "utils"]),
  utils: new Set(["utils"]),
};

test("keeps source dependencies flowing toward documented boundaries", () => {
  const violations: string[] = [];
  for (const file of listTypeScriptFiles(sourceRoot)) {
    const sourceLayer = getLayer(file);
    if (!sourceLayer) continue;
    const sourceFile = parseSourceFile(file);
    for (const specifier of getModuleSpecifiers(sourceFile)) {
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), specifier);
      const targetLayer = getLayer(target);
      if (targetLayer && allowedDependencies[sourceLayer].has(targetLayer)) {
        continue;
      }
      if (!targetLayer && !isWithinSource(target)) continue;
      violations.push(
        `${path.relative(sourceRoot, file)}: ${sourceLayer} -> ${targetLayer ?? "composition root"} (${specifier})`,
      );
    }
  }

  assert.deepEqual(violations, []);
});

test("keeps domain modules independent of Zotero and browser globals", () => {
  const forbiddenGlobals = new Set([
    "AbortController",
    "AbortSignal",
    "Blob",
    "ChromeUtils",
    "Components",
    "DOMException",
    "Document",
    "Element",
    "File",
    "HTMLElement",
    "IOUtils",
    "MutationObserver",
    "PathUtils",
    "Response",
    "Services",
    "URL",
    "Window",
    "Worker",
    "Zotero",
    "document",
    "window",
    "ztoolkit",
  ]);
  const violations: string[] = [];
  for (const file of listTypeScriptFiles(path.join(sourceRoot, "domain"))) {
    const sourceFile = parseSourceFile(file);
    const names = new Set<string>();
    visitIdentifiers(sourceFile, (identifier) => {
      if (forbiddenGlobals.has(identifier.text)) names.add(identifier.text);
    });
    if (names.size > 0) {
      violations.push(
        `${path.relative(sourceRoot, file)}: ${[...names].sort().join(", ")}`,
      );
    }
  }

  assert.deepEqual(violations, []);
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(candidate);
    return entry.isFile() && entry.name.endsWith(".ts") ? [candidate] : [];
  });
}

function parseSourceFile(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    ts.sys.readFile(file) ?? "",
    ts.ScriptTarget.Latest,
    true,
  );
}

function getLayer(file: string): Layer | undefined {
  const relative = path.relative(sourceRoot, file);
  if (!isWithinSource(file)) return undefined;
  const [first, second] = relative.split(path.sep);
  if (first === "platform" && second === "zotero") return "platform/zotero";
  if (
    first === "domain" ||
    first === "features" ||
    first === "services" ||
    first === "utils"
  ) {
    return first;
  }
  return undefined;
}

function isWithinSource(file: string): boolean {
  const relative = path.relative(sourceRoot, file);
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function getModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function visitIdentifiers(
  sourceFile: ts.SourceFile,
  visitor: (identifier: ts.Identifier) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
