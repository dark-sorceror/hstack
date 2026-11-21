import { readdir, mkdtemp, cp, symlink, realpath, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

// Run the existing Node/CommonJS regressions against transpiled TypeScript.
// The mirror lives outside the checkout and is removed even after a failure.
// Test .js imports resolve to this mirror; the source checkout contains .ts files.
const root = process.cwd();
const directory = await mkdtemp(path.join(tmpdir(), "hstack-tests-"));
async function sources(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(file)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(file);
  }
  return files;
}
try {
  for (const name of ["tests", "src/data"])
    await cp(path.join(root, name), path.join(directory, name), { recursive: true });
  await symlink(
    await realpath("node_modules"),
    path.join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await build({
    entryPoints: await sources("src"),
    outbase: "src",
    outdir: path.join(directory, "src"),
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
  });
  await mkdir(path.join(directory, "bin"));
  await build({
    entryPoints: ["bin/hstack.ts"],
    outfile: path.join(directory, "bin/hstack.cjs"),
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
  });
  const requested = process.argv.slice(2).map((file) => path.basename(file));
  const tests = (await readdir(path.join(directory, "tests")))
    .filter((name) => name.endsWith(".test.cjs") && (!requested.length || requested.includes(name)))
    .sort()
    .map((name) => path.join(directory, "tests", name));
  if (!tests.length || (requested.length && tests.length !== new Set(requested).size))
    throw Error("Unknown test selection");
  const child = spawnSync(process.execPath, ["--test", ...tests], {
    stdio: "inherit",
    env: { ...process.env, HSTACK_SOURCE_ROOT: root },
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
