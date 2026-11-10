import * as assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

for (const environment of ["production", "development"]) {
  test(`toolkit startup and cleanup leave protocol bridges inactive (${environment})`, async () => {
    const result = await build({
      bundle: true,
      define: { __env__: JSON.stringify(environment) },
      format: "iife",
      globalName: "ToolkitTest",
      stdin: {
        contents: 'export { createZToolkit } from "./src/utils/ztoolkit";',
        resolveDir: process.cwd(),
      },
      write: false,
    });
    const bridgeAccesses: string[] = [];
    const context = {
      Zotero: new Proxy(
        { getMainWindow: () => ({}), debug: () => {} },
        {
          has(target, property) {
            if (property === "_toolkitGlobal") {
              bridgeAccesses.push(String(property));
              throw new Error(
                "Toolkit global would initialize protocol bridges",
              );
            }
            return Reflect.has(target, property);
          },
        },
      ),
      ToolkitTest: undefined as unknown as {
        createZToolkit: typeof import("../src/utils/ztoolkit").createZToolkit;
      },
    };
    runInNewContext(result.outputFiles[0].text, context);
    const toolkit = context.ToolkitTest.createZToolkit();
    assert.equal("Menu" in toolkit, false);
    assert.equal(typeof toolkit.UI.createElement, "function");
    assert.equal(typeof toolkit.Dialog, "function");
    assert.equal(typeof toolkit.ProgressWindow, "function");
    assert.equal("Prompt" in toolkit, false);
    assert.equal(
      toolkit.basicOptions.log.disableConsole,
      environment === "production",
    );

    let removed = 0;
    const element = { remove: () => removed++ };
    const ui = toolkit.UI as unknown as { elementCache: WeakRef<Element>[] };
    ui.elementCache.push(new WeakRef(element as unknown as Element));
    toolkit.unregisterAll();
    assert.equal(removed, 1);
    assert.deepEqual(bridgeAccesses, []);
  });
}
