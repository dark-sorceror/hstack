#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Native CLI eval responses can cross between simultaneous CLI processes.
// Serialize this client's requests per vault, including separate agent shells.
async function acquireLock(key, options = {}) {
  const directory = path.join(options.root || os.tmpdir(), "notes-agent-" + createHash("sha256").update(key).digest("hex").slice(0, 24) + ".lock");
  const ownerPath = path.join(directory, "owner.json"), token = randomUUID(), started = Date.now();
  for (;;) {
    let created = false;
    try {
      fs.mkdirSync(directory, { mode: 0o700 }); created = true;
      fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(ownerPath, "utf8")).token === token) fs.rmSync(directory, { recursive: true, force: true });
        } catch { /* Another process may already have recovered the lock. */ }
      };
    } catch (error) {
      if (created) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw Error("Invalid lock owner");
        try { process.kill(owner.pid, 0); }
        catch (probe) { if (probe.code === "ESRCH") { fs.rmSync(directory, { recursive: true, force: true }); continue; } }
      } catch {
        // mkdir and writing the owner are synchronous, but allow a grace period
        // if a process was interrupted between them.
        try { if (Date.now() - fs.statSync(directory).mtimeMs > 2000) fs.rmSync(directory, { recursive: true, force: true }); } catch {}
      }
      if (Date.now() - started > (options.timeout || 10000)) throw Error("Notes bridge is busy; retry the request.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

function buildEval(request, marker) {
  if (Buffer.byteLength(JSON.stringify(request)) > 48 * 1024) throw new Error("Request exceeds 48 KiB; use smaller note patches.");
  return `(async()=>{let reply;try{const p=(app.plugins.plugins["hstack"]||app.plugins.plugins["notes-typing-helpers"]);if(!p?.agent?.request)throw Error("Notes agent bridge is not loaded");reply=await p.agent.request(JSON.parse(${JSON.stringify(JSON.stringify(request))}));}catch(error){reply={apiVersion:1,id:${JSON.stringify(request.id ?? null)},ok:false,error:{code:"BRIDGE_UNAVAILABLE",message:String(error.message)}};}console.log(${JSON.stringify(marker)}+JSON.stringify(reply));})()`;
}
function parseOutput(output, marker) {
  const lines = output.split(/\r?\n/).filter(line => line.includes(marker));
  if (lines.length !== 1) throw new Error("Obsidian did not return one structured bridge response.");
  const value = JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length));
  if (value.apiVersion !== 1 || typeof value.ok !== "boolean") throw new Error("Invalid notes bridge response.");
  return value;
}
function parseRequest(args, input = "") {
  let request;
  if (!args.length) request = JSON.parse(input);
  else if (args[0].startsWith("{")) request = JSON.parse(args[0]);
  else request = { method: args[0], params: args[1] ? JSON.parse(args[1]) : {} };
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("A JSON request object is required.");
  return { apiVersion: 1, id: randomUUID(), ...request };
}
async function callBridge(request, options = {}) {
  const executable = options.cli || process.env.OBSIDIAN_CLI || (process.platform === "darwin" ? "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli" : "obsidian");
  const vault = options.vault || process.env.NOTES_VAULT;
  const marker = "__NOTES_AGENT_" + randomUUID() + "__";
  const code = buildEval(request, marker);
  const release = await acquireLock(executable, options.lockOptions);
  try { return await new Promise((resolve, reject) => {
    const child = spawn(executable, [...(vault ? ["vault=" + vault] : []), "eval", "code=" + code], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "", settled = false;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); } else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("Obsidian bridge request timed out.")), options.timeout || 10000);
    child.on("error", error => finish(error));
    child.stdout.on("data", chunk => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > 1024 * 1024) finish(new Error("Obsidian CLI output exceeded 1 MiB."));
    });
    child.stderr.on("data", chunk => { if (errors.length < 2000) errors += chunk.toString("utf8"); });
    child.on("close", code => {
      if (settled) return;
      try {
        const response = parseOutput(output, marker);
        if (response.id !== request.id) throw new Error("Bridge response ID does not match request.");
        finish(null, response);
      } catch (error) {
        error.message += ` CLI exit: ${code}. ` + (errors || output).slice(0, 1000);
        finish(error);
      }
    });
  }); } finally { release(); }
}
async function main(args = process.argv.slice(2)) {
  if (args[0] === "--help") {
    process.stdout.write("Usage: node bin/hstack.cjs <method> '<JSON params>'\nSet NOTES_VAULT to choose a vault. Or pipe a JSON request on stdin. Methods: capabilities, context, query, readSection, sql, patch, reveal.\n");
    return;
  }
  let input = "";
  if (!args.length) {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error("Input exceeds 4 MiB.");
    }
  }
  const response = await callBridge(parseRequest(args, input));
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  if (!response.ok) process.exitCode = 1;
}
if (require.main === module) main().catch(error => {
  process.stderr.write(JSON.stringify({ apiVersion: 1, ok: false, error: { code: "CLI_ERROR", message: error.message } }) + "\n");
  process.exitCode = 1;
});
module.exports = { buildEval, parseOutput, parseRequest, callBridge, acquireLock };
