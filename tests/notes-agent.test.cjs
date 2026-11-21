"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { buildEval, parseOutput, parseRequest, acquireLock } = require("../bin/hstack.cjs");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");

test("CLI accepts concise commands and structured stdin requests", () => {
  const short = parseRequest(["context"]);
  assert.equal(short.method, "context");
  assert.equal(short.apiVersion, 1);
  assert.ok(short.id);
  assert.deepEqual(parseRequest([], '{"id":"r1","method":"query","params":{"text":"reset"}}'), {
    apiVersion: 1,
    id: "r1",
    method: "query",
    params: { text: "reset" },
  });
  assert.throws(() => parseRequest([], "[]"));
});
test("request content is encoded as JSON data, including quotes, Unicode and JavaScript-looking text", async () => {
  const attack = '");globalThis.pwned=true;// 🌱\n$HOME `not a command`';
  const request = { apiVersion: 1, id: "one", method: "patch", params: { text: attack } };
  for (const pluginId of ["hstack", "notes-typing-helpers"]) {
    const calls = [],
      logs = [];
    const context = {
      app: {
        plugins: {
          plugins: {
            [pluginId]: {
              agent: {
                request: async (value) => {
                  calls.push(value);
                  return {
                    apiVersion: 1,
                    id: value.id,
                    ok: true,
                    result: { text: value.params.text },
                  };
                },
              },
            },
          },
        },
      },
      console: { log: (value) => logs.push(value) },
    };
    await vm.runInNewContext(buildEval(request, "MARK:"), context);
    assert.equal(calls[0].params.text, attack);
    assert.equal(context.pwned, undefined);
    assert.equal(parseOutput(logs.join("\n"), "MARK:").result.text, attack);
  }
});
test("bridge errors remain structured and startup failure is explicit", async () => {
  const logs = [];
  await vm.runInNewContext(buildEval({ id: "missing", method: "context" }, "MARK:"), {
    app: { plugins: { plugins: {} } },
    console: { log: (value) => logs.push(value) },
  });
  const response = parseOutput(logs[0], "MARK:");
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "BRIDGE_UNAVAILABLE");
  assert.equal(response.id, "missing");
});
test("only the unique response marker is parsed and ambiguous or malformed output fails", () => {
  const reply = { apiVersion: 1, id: "one", ok: true, result: { value: "a\nb" } };
  assert.deepEqual(
    parseOutput("plugin log\n=> MARK:" + JSON.stringify(reply) + "\n", "MARK:"),
    reply
  );
  assert.throws(() => parseOutput("Error: missing plugin", "MARK:"));
  assert.throws(() => parseOutput('MARK:{"ok":true}\nMARK:{"ok":true}', "MARK:"));
  assert.throws(() => parseOutput("MARK:garbage", "MARK:"));
  assert.throws(
    () => buildEval({ method: "patch", params: { text: "x".repeat(50000) } }, "MARK:"),
    /48 KiB/
  );
});
test("native CLI requests queue until the previous client releases its vault lock", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notes-agent-lock-test-"));
  let releaseFirst, releaseSecond;
  try {
    releaseFirst = await acquireLock("same vault", { root });
    let acquired = false;
    const second = acquireLock("same vault", { root }).then((release) => {
      acquired = true;
      return release;
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(acquired, false);
    releaseFirst();
    releaseSecond = await second;
    assert.equal(acquired, true);
    releaseSecond();
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    releaseFirst?.();
    releaseSecond?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
