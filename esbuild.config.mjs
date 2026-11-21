import * as esbuild from "esbuild";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const external = [
  "obsidian",
  "electron",
  "@codemirror/*",
  "@lezer/*",
  ...builtinModules,
  ...builtinModules.map((module) => "node:" + module),
];
const workerEntry = "src/agent/agent-sql-runner.cjs";
const workerPlugin = {
  name: "embedded-sql-worker",
  setup(build) {
    build.onResolve({ filter: /^hstack:sql-worker$/ }, () => ({
      path: "sql-worker",
      namespace: "hstack",
    }));
    build.onLoad({ filter: /.*/, namespace: "hstack" }, async () => {
      const worker = await esbuild.build({
        entryPoints: [workerEntry],
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        write: false,
        minify: false,
        metafile: true,
        external,
      });
      return {
        contents:
          "export const HSTACK_SQL_WORKER = " + JSON.stringify(worker.outputFiles[0].text) + ";",
        loader: "js",
        // Parent watch tracks every worker dependency and recompiles the embedded
        // code on changes, including changes to the child-only entry point.
        watchFiles: Object.keys(worker.metafile.inputs).map((input) => path.resolve(input)),
      };
    });
  },
};
const notices = await Promise.all(
  ["LICENSE", "licenses/LICENSE.gemoji", "licenses/LICENSE.autocorrect-data"].map((file) =>
    readFile(file, "utf8")
  )
);
const watching = process.argv.includes("--watch");
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2021",
  external,
  loader: { ".txt": "text", ".wasm": "base64" },
  plugins: [workerPlugin],
  inject: ["hstack:sql-worker"],
  banner: {
    js:
      "/* hstack — generated bundle. Source: src/.\n" +
      notices.join("\n\n").replaceAll("*/", "* /") +
      "\n*/",
  },
  outfile: process.env.HSTACK_BUILD_OUTFILE || "main.js",
  minify: !watching,
  sourcemap: watching ? "inline" : false,
  logLevel: "info",
  legalComments: "inline",
};
if (watching) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
