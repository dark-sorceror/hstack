import * as esbuild from "esbuild";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
const external = [
  "obsidian",
  "electron",
  "@codemirror/*",
  "@lezer/*",
  ...builtinModules,
  ...builtinModules.map((m) => "node:" + m),
];
const worker = await esbuild.build({
  entryPoints: ["src/agent/agent-sql-runner.cjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  write: false,
  minify: false,
  external,
});
const notices = await Promise.all(
  ["LICENSE", "licenses/LICENSE.gemoji", "licenses/LICENSE.autocorrect-data"].map((p) =>
    readFile(p, "utf8")
  )
);
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2021",
  external,
  loader: { ".txt": "text", ".wasm": "base64" },
  define: { HSTACK_SQL_WORKER: JSON.stringify(worker.outputFiles[0].text) },
  // Required dataset notices travel with the three-file community release.
  banner: {
    js:
      "/* hstack — generated bundle. Source: src/.\n" +
      notices.join("\n\n").replaceAll("*/", "* /") +
      "\n*/",
  },
  outfile: "main.js",
  minify: !process.argv.includes("--watch"),
  sourcemap: process.argv.includes("--watch") ? "inline" : false,
  logLevel: "info",
  legalComments: "inline",
};
if (process.argv.includes("--watch")) {
  const context = await esbuild.context(options);
  await context.watch();
} else await esbuild.build(options);
