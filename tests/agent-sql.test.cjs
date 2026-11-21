"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("node:child_process");
const { executeSQL, validateSQL, SCHEMA, LIMITS } = require("../src/agent/agent-sql");

const snapshot = {
  notes: [
    {
      path: "CS/Python.md",
      title: "Python",
      folder: "CS",
      revision: "buffer:a",
      source: "editor",
      content: "# Python\nCurrent unsaved text",
      modified: 123,
    },
    {
      path: "SQL.md",
      title: "SQL",
      folder: "",
      revision: "vault:b",
      source: "vault",
      content: "# SQL\nSELECT a;",
      modified: 456,
    },
    {
      path: "Other.md",
      title: "Other",
      folder: "",
      revision: "vault:c",
      source: "vault",
      content: "",
      modified: 789,
    },
  ],
  headings: [{ path: "CS/Python.md", heading: "Python", level: 1, line: 0, start: 0, end: 28 }],
  tags: [
    { path: "CS/Python.md", tag: "#code" },
    { path: "SQL.md", tag: "#code" },
  ],
  links: [{ source: "SQL.md", target: "CS/Python.md", resolved: true, heading: null, line: 2 }],
  properties: [{ path: "SQL.md", key: "status", value_json: '"active"' }],
};
const run = (sql, params, limit) => executeSQL(DatabaseSync, snapshot, { sql, params, limit });

test("real SQL joins, metadata, live content, CTE, grouping and parameters", () => {
  assert.deepEqual(
    run(
      "SELECT n.path,n.source,n.content FROM notes n JOIN tags t ON t.path=n.path WHERE t.tag=? AND n.folder=?",
      ["#code", "CS"]
    ).rows,
    [["CS/Python.md", "editor", "# Python\nCurrent unsaved text"]]
  );
  assert.deepEqual(
    run("WITH hits AS (SELECT path FROM tags WHERE tag=:tag) SELECT count(*) AS total FROM hits", {
      tag: "#code",
    }).rows,
    [[2]]
  );
  assert.deepEqual(run("SELECT source,target,resolved FROM links").rows, [
    ["SQL.md", "CS/Python.md", 1],
  ]);
  assert.deepEqual(run("SELECT key,json_extract(value_json,'$') FROM properties").rows, [
    ["status", "active"],
  ]);
  assert.deepEqual(run("SELECT h.heading,h.line,h.start,h.end FROM headings h").rows, [
    ["Python", 0, 0, 28],
  ]);
  assert.deepEqual(Object.keys(SCHEMA), ["notes", "headings", "links", "tags", "properties"]);
});

test("single-statement scanner handles comments, quotes and bound injection literally", () => {
  assert.deepEqual(
    run("/* ; DELETE */ SELECT ';' AS marker, 'it''s; fine' AS text; -- SELECT 2").rows,
    [[";", "it's; fine"]]
  );
  assert.deepEqual(run('SELECT 1 AS [semi;column],2 AS `other;column`,3 AS "x;column"').rows, [
    [1, 2, 3],
  ]);
  assert.deepEqual(
    run("SELECT path FROM notes WHERE title=?", ["'; ATTACH DATABASE '/tmp/x' AS x; --"]).rows,
    []
  );
  for (const sql of [
    "SELECT 1; SELECT 2",
    "SELECT 1;;",
    "SELECT 1; ATTACH ':memory:' AS x",
    "SELECT 1 /* unclosed",
    "SELECT 'unclosed",
  ])
    assert.throws(() => run(sql));
});

test("rejects writes, WITH writes, pragmas, attached databases, extension/file functions", () => {
  for (const sql of [
    "DELETE FROM notes",
    "WITH x AS (SELECT 1) DELETE FROM notes RETURNING path",
    "WITH x AS (SELECT 1) UPDATE notes SET title='x' RETURNING path",
    "ATTACH DATABASE ':memory:' AS extra",
    "PRAGMA query_only=OFF",
    "SELECT * FROM pragma_table_info('notes')",
    "SELECT * FROM \"pragma_table_info\"('notes')",
    "SELECT * FROM [pragma_table_info]('notes')",
    "SELECT load_extension('/tmp/x')",
    "SELECT \"load_extension\"('/tmp/x')",
    "SELECT readfile('/etc/passwd')",
    "SELECT writefile('/tmp/x','x')",
    "SELECT * FROM sqlite_master",
    "SELECT randomblob(1000000000)",
    "SELECT zeroblob(1000000000)",
    "VACUUM INTO '/tmp/x'",
    "BEGIN",
    "EXPLAIN SELECT 1",
  ])
    assert.throws(() => run(sql), { code: "READ_ONLY_SQL" }, sql);
  assert.throws(() => run("SELECT unknown_function('x')"), { code: "SQL_ERROR" });
  assert.equal(run("SELECT count(*) FROM notes").rows[0][0], 3);
});

test("query_only independently rejects writes and extension loading is disabled", () => {
  let closed = false;
  class InspectedDatabase extends DatabaseSync {
    setAuthorizer() {} // Simulate Obsidian's older API; query_only must stand alone.
    prepare(sql) {
      if (sql.startsWith("SELECT probe")) {
        assert.throws(() => super.prepare("UPDATE notes SET title='changed'").run(), /readonly/i);
        assert.throws(
          () => super.prepare("SELECT load_extension('/tmp/nonexistent')").get(),
          /authorized|extension/i
        );
        return super.prepare("SELECT count(*) FROM notes");
      }
      return super.prepare(sql);
    }
    close() {
      closed = true;
      return super.close();
    }
  }
  assert.equal(executeSQL(InspectedDatabase, snapshot, { sql: "SELECT probe" }).rows[0][0], 3);
  assert.equal(closed, true);
});

test("bounds rows, reports exact truncation, preserves duplicate columns and bigint", () => {
  const result = run("SELECT path FROM notes ORDER BY path", [], 2);
  assert.equal(result.rowCount, 2);
  assert.equal(result.truncated, true);
  assert.equal(run("SELECT path FROM notes LIMIT 2", [], 2).truncated, false);
  assert.equal(run("SELECT path FROM notes").limit, 50);
  assert.deepEqual(run("SELECT 1 AS x,2 AS x,9223372036854775807 AS large").rows, [
    [1, 2, "9223372036854775807"],
  ]);
  assert.deepEqual(run("SELECT 1 AS x,2 AS x").columns, ["x", "x"]);
  for (const limit of [0, -1, 201, 1.1, "2"])
    assert.throws(() => run("SELECT 1", [], limit), { code: "INVALID_LIMIT" });
});

test("caps cells and snapshot size; returns provenance counts without changing source", () => {
  const large = "a".repeat(5000);
  const copy = structuredClone(snapshot);
  copy.notes[0].content = large;
  const result = executeSQL(DatabaseSync, copy, {
    sql: "SELECT content FROM notes WHERE source='editor'",
  });
  assert.equal(result.rows[0][0].length, LIMITS.cellChars);
  assert.deepEqual(result.cellTruncations, [{ row: 0, column: 0, originalChars: 5000 }]);
  assert.equal(copy.notes[0].content, large);
  assert.equal(result.snapshot.notes, 3);
  assert.equal(result.snapshot.links, 1);
  assert.equal(result.readOnly, true);
  assert.throws(
    () =>
      executeSQL(
        DatabaseSync,
        { notes: [{ content: "x".repeat(LIMITS.snapshotBytes) }] },
        { sql: "SELECT 1" }
      ),
    { code: "SNAPSHOT_TOO_LARGE" }
  );
});

test("invalid requests fail predictably and connections close on SQL errors", () => {
  for (const sql of [null, "", " ", "SELECT 1\0", "SELECT " + "x".repeat(8192)])
    assert.throws(() => validateSQL(sql), { code: "INVALID_SQL" });
  for (const params of [[NaN], [Infinity], [{}], [undefined], { "bad key": 1 }, "text", new Date()])
    assert.throws(() => run("SELECT ?", params), { code: "INVALID_PARAMS" });
  assert.throws(
    () => executeSQL(DatabaseSync, { notes: [{ modified: "today" }] }, { sql: "SELECT 1" }),
    { code: "INVALID_SNAPSHOT" }
  );
  let closed = false;
  class Tracked extends DatabaseSync {
    close() {
      closed = true;
      return super.close();
    }
  }
  assert.throws(() => executeSQL(Tracked, snapshot, { sql: "SELECT missing FROM notes" }), {
    code: "SQL_ERROR",
  });
  assert.equal(closed, true);
});

test("host process timeout can stop an unbounded native recursive query", () => {
  const code = `const {DatabaseSync}=require('node:sqlite'); const {executeSQL}=require(process.argv[1]); console.log('started'); executeSQL(DatabaseSync,{}, {sql:'WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers) SELECT max(n) FROM numbers'});`;
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    ["-e", code, require.resolve("../src/agent/agent-sql")],
    { encoding: "utf8", timeout: 150, killSignal: "SIGKILL" }
  );
  assert.equal(result.error.code, "ETIMEDOUT");
  assert.equal(result.signal, "SIGKILL");
  assert.match(result.stdout, /started/);
  assert.ok(Date.now() - started < 2000);
});
