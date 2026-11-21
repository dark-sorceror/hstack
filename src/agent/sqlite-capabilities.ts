/** This function is serialized into the Node probe; keep it self-contained. */
function assertSQLiteCapabilities(database: { prepare(sql: string): unknown }) {
  const statement = database.prepare("SELECT 1 AS capability") as Record<string, unknown>;
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

export { assertSQLiteCapabilities };
