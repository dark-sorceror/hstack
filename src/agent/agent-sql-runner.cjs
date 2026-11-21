"use strict";
// Fixed child entry point. No SQL or note text is evaluated as JavaScript.
const { DatabaseSync } = require("node:sqlite");
const { executeSQL } = require("./agent-sql.js");
let input = "",
  size = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  size += Buffer.byteLength(chunk);
  if (size > 64 * 1024 * 1024) process.exit(2);
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const { snapshot, request } = JSON.parse(input);
    process.stdout.write(
      JSON.stringify({ ok: true, result: executeSQL(DatabaseSync, snapshot, request) })
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: { code: error.code || "SQL_ERROR", message: error.message },
      })
    );
  }
});
