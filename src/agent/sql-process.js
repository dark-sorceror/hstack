"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const { LIMITS, fail } = require("./contracts.js");

function runSQL(snapshot, request, { nodePath, directory, timeout = LIMITS.sqlMs } = {}) {
  if (!nodePath)
    fail("SQL_UNAVAILABLE", "A local Node.js 22+ executable is needed for SQL queries.");
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_OPTIONS;
    const workerCode = typeof HSTACK_SQL_WORKER === "string" ? HSTACK_SQL_WORKER : null;
    const args = workerCode ? ["-e", workerCode] : [path.join(directory, "agent-sql-runner.cjs")];
    const child = spawn(nodePath, args, { shell: false, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = [],
      bytes = 0,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(result);
    };
    const timer = setTimeout(() => {
      const error = new Error("SQL query exceeded the execution budget.");
      error.code = "SQL_TIMEOUT";
      finish(error);
    }, timeout);
    child.on("error", (error) => {
      error.code = "SQL_UNAVAILABLE";
      finish(error);
    });
    child.stdin.on("error", (error) => {
      if (!settled) {
        error.code = "SQL_PROCESS_ERROR";
        finish(error);
      }
    });
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMITS.sqlOutputBytes) {
        const error = new Error("SQL output exceeds 512 KiB; select fewer or shorter columns.");
        error.code = "RESULT_TOO_LARGE";
        finish(error);
      } else output.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0) fail("SQL_PROCESS_ERROR", "SQL subprocess did not complete successfully.");
        const value = JSON.parse(Buffer.concat(output).toString("utf8"));
        if (!value.ok)
          fail(value.error?.code || "SQL_ERROR", value.error?.message || "SQL failed.");
        finish(null, value.result);
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.end(JSON.stringify({ snapshot, request }));
  });
}

const fs = require("node:fs");
const { assertSQLiteCapabilities } = require("./sqlite-capabilities.js");
const runtimeCache = new Map();

function probeNode(nodePath) {
  if (runtimeCache.has(nodePath)) return runtimeCache.get(nodePath);
  const pending = new Promise((resolve) => {
    const env = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_OPTIONS;
    const code = `const {DatabaseSync}=require('node:sqlite');const assertSQLiteCapabilities=${assertSQLiteCapabilities.toString()};const db=new DatabaseSync(':memory:',{allowExtension:false});try{assertSQLiteCapabilities(db);process.stdout.write(JSON.stringify({version:process.version}));}finally{db.close();}`;
    const child = spawn(nodePath, ["-e", code], {
      shell: false,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "",
      settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 1000);
    child.on("error", () => finish(null));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (value) => {
      output += value;
      if (output.length > 2048) finish(null);
    });
    child.on("close", (code) => {
      try {
        finish(code === 0 ? JSON.parse(output) : null);
      } catch {
        finish(null);
      }
    });
  });
  runtimeCache.set(nodePath, pending);
  return pending;
}

function createSQLRuntime(dependencies = {}) {
  const candidates = [
    ...new Set([
      ...(dependencies.nodePath ? [dependencies.nodePath] : []),
      ...(process.env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((folder) => path.join(folder, process.platform === "win32" ? "node.exe" : "node")),
      "/opt/homebrew/opt/node@22/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
    ]),
  ].filter((candidate) => fs.existsSync(candidate));

  async function capabilities() {
    const configured = dependencies.getNodePath?.();
    const paths = configured
      ? [configured]
      : dependencies.nodePath
        ? [dependencies.nodePath]
        : candidates;
    for (const nodePath of paths) {
      if (!path.isAbsolute(nodePath)) continue;
      const result = await probeNode(nodePath);
      if (result) return { available: true, version: result.version, nodePath };
    }
    return {
      available: false,
      reason:
        "Install a compatible Node.js runtime (22.16+ on 22.x), or configure its absolute executable path.",
    };
  }
  return {
    capabilities,
    async requireNode() {
      const result = await capabilities();
      if (!result.available) fail("SQL_UNAVAILABLE", result.reason);
      return result.nodePath;
    },
  };
}

module.exports = { runSQL, createSQLRuntime, probeNode };
