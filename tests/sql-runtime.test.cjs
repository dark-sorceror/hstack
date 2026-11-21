"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertSQLiteCapabilities } = require("../src/agent/sqlite-capabilities.js");
const { createSQLRuntime } = require("../src/agent/sql-process.js");

test("older SQLite APIs fail with an actionable capability error", () => {
  for (const missing of ["iterate", "columns", "setReturnArrays", "setReadBigInts"]) {
    const statement = { iterate() {}, columns() {}, setReturnArrays() {}, setReadBigInts() {} };
    delete statement[missing];
    assert.throws(
      () => assertSQLiteCapabilities({ prepare: () => statement }),
      (error) => error.code === "SQL_UNAVAILABLE" && error.message.includes(missing)
    );
  }
});

test("runtime discovery verifies SQLite capabilities and responds to configured-path changes", async () => {
  let configured = process.execPath;
  const runtime = createSQLRuntime({ getNodePath: () => configured });
  assert.equal((await runtime.capabilities()).available, true);
  configured = "relative-node-path";
  assert.equal((await runtime.capabilities()).available, false);
  await assert.rejects(runtime.requireNode(), (error) => error.code === "SQL_UNAVAILABLE");
  configured = process.execPath;
  assert.equal(await runtime.requireNode(), process.execPath);
});
