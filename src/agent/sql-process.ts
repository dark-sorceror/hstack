import type { AgentDependencies, BridgeFault } from "./types.js";
import type { SQLResult } from "./agent-sql.js";

declare const HSTACK_SQL_WORKER: string | undefined;
interface RunSQLOptions {
  nodePath?: string;
  directory?: string;
  timeout?: number;
}
interface ProbeResult {
  version: string;
}
type NodeCapabilities =
  { available: true; version: string; nodePath: string } | { available: false; reason: string };
type WorkerReply =
  { ok: true; result: SQLResult } | { ok: false; error?: { code?: string; message?: string } };

import { spawn } from "node:child_process";
import * as path from "node:path";
import { LIMITS, fail } from "./contracts.js";

function runSQL(
  snapshot: unknown,
  request: unknown,
  { nodePath, directory, timeout = LIMITS.sqlMs }: RunSQLOptions = {}
): Promise<SQLResult> {
  if (!nodePath)
    fail("SQL_UNAVAILABLE", "A local Node.js 22+ executable is needed for SQL queries.");
  return new Promise<SQLResult>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_OPTIONS;
    const workerCode = typeof HSTACK_SQL_WORKER === "string" ? HSTACK_SQL_WORKER : null;
    const args = workerCode
      ? ["-e", workerCode]
      : [path.join(directory as string, "agent-sql-runner.js")];
    const child = spawn(nodePath, args, { shell: false, env, stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let bytes = 0,
      settled = false;
    const finish = (error: unknown, result?: SQLResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(result!);
    };
    const timer = setTimeout(() => {
      const error = Object.assign(new Error("SQL query exceeded the execution budget."), {
        code: "SQL_TIMEOUT",
      });
      finish(error);
    }, timeout);
    child.on("error", (error: BridgeFault) => {
      error.code = "SQL_UNAVAILABLE";
      finish(error);
    });
    child.stdin.on("error", (error: BridgeFault) => {
      if (!settled) {
        error.code = "SQL_PROCESS_ERROR";
        finish(error);
      }
    });
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMITS.sqlOutputBytes) {
        const error = Object.assign(
          new Error("SQL output exceeds 512 KiB; select fewer or shorter columns."),
          { code: "RESULT_TOO_LARGE" }
        );
        finish(error);
      } else output.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0) fail("SQL_PROCESS_ERROR", "SQL subprocess did not complete successfully.");
        const value = JSON.parse(Buffer.concat(output).toString("utf8")) as WorkerReply;
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

import * as fs from "node:fs";
import { assertSQLiteCapabilities } from "./sqlite-capabilities.js";
const runtimeCache = new Map<string, Promise<ProbeResult | null>>();

function probeNode(nodePath: string): Promise<ProbeResult | null> {
  if (runtimeCache.has(nodePath)) return runtimeCache.get(nodePath)!;
  const pending = new Promise<ProbeResult | null>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_OPTIONS;
    const code = `const {DatabaseSync}=require('node:sqlite');const assertSQLiteCapabilities=${assertSQLiteCapabilities.toString()};const db=new DatabaseSync(':memory:',{allowExtension:false});try{assertSQLiteCapabilities(db);process.stdout.write(JSON.stringify({version:process.version}));}finally{db.close();}`;
    const child = spawn(nodePath, ["-e", code], {
      shell: false,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "",
      settled = false;
    const finish = (result: ProbeResult | null) => {
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

function createSQLRuntime(dependencies: AgentDependencies = {}) {
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

  async function capabilities(): Promise<NodeCapabilities> {
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

export { runSQL, createSQLRuntime, probeNode };
