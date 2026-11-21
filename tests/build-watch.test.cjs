"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

async function waitFor(read, predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Error("Timed out waiting for watch rebuild");
}

test(
  "watch rebuilds embedded SQL when child entry or its dependencies change",
  { timeout: 20000 },
  async () => {
    const root = path.resolve(__dirname, "..");
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hstack-watch-test-"));
    let child;
    try {
      for (const name of ["esbuild.config.mjs", "LICENSE", "licenses", "src/agent"])
        await fs.cp(path.join(root, name), path.join(folder, name), { recursive: true });
      await fs.symlink(
        path.join(root, "node_modules"),
        path.join(folder, "node_modules"),
        process.platform === "win32" ? "junction" : "dir"
      );
      await fs.writeFile(path.join(folder, "src/main.ts"), "console.log(HSTACK_SQL_WORKER);\n");
      const output = path.join(folder, "main.js");
      child = spawn(process.execPath, ["esbuild.config.mjs", "--watch"], {
        cwd: folder,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let logs = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (text) => {
        logs = (logs + text).slice(-2000);
      });
      await waitFor(
        () => fs.readFile(output, "utf8"),
        (text) => text.includes("DatabaseSync")
      );
      const runner = path.join(folder, "src/agent/agent-sql-runner.cjs");
      await fs.appendFile(runner, '\nconsole.error("WORKER_ENTRY_CHANGED");\n');
      await waitFor(
        () => fs.readFile(output, "utf8"),
        (text) => text.includes("WORKER_ENTRY_CHANGED")
      );
      const dependency = path.join(folder, "src/agent/sqlite-capabilities.js");
      await fs.appendFile(dependency, '\nconsole.error("WORKER_DEPENDENCY_CHANGED");\n');
      const rebuilt = await waitFor(
        () => fs.readFile(output, "utf8"),
        (text) => text.includes("WORKER_DEPENDENCY_CHANGED")
      );
      assert.ok(rebuilt.includes("WORKER_ENTRY_CHANGED"), logs);
    } finally {
      if (child && child.exitCode === null) {
        const closed = new Promise((resolve) => child.once("close", resolve));
        child.kill();
        await closed;
      }
      await fs.rm(folder, { recursive: true, force: true });
    }
  }
);
