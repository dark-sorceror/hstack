import { build } from "esbuild";

await build({
  entryPoints: ["bin/hstack.ts"],
  outfile: "bin/hstack.cjs",
  platform: "node",
  format: "cjs",
  target: "node22",
  logLevel: "info",
});
