// @ts-check
"use strict";

/** @param {{prepare:Function}} database */
function assertSQLiteCapabilities(database) {
  const statement = database.prepare("SELECT 1 AS capability");
  try {
    for (const name of ["iterate", "columns", "setReturnArrays", "setReadBigInts"]) {
      if (typeof statement[name] !== "function") {
        throw Object.assign(
          new Error(
            "SQL needs a Node runtime with SQLite " + name + " (Node 22.16+ on the 22.x line)."
          ),
          { code: "SQL_UNAVAILABLE" }
        );
      }
    }
  } finally {
    if (typeof statement.close === "function") statement.close();
  }
}

module.exports = { assertSQLiteCapabilities };
