import type { HstackAPI } from "../../src/api";
declare const api: HstackAPI;
async function contracts() {
  const read = await api.request({
    method: "readSection",
    params: { path: "Note.md", heading: "Title" },
  });
  if (read.ok) read.result.revision.toUpperCase();
  const sql = await api.request({ method: "sql", params: { sql: "SELECT ?", params: ["bound"] } });
  if (sql.ok) sql.result.columns.map((column) => column.toUpperCase());
  // @ts-expect-error patches require the exact read revision
  api.request({ method: "patch", params: { path: "Note.md", edits: [] } });
  // @ts-expect-error SQL parameters cannot contain arbitrary nested objects
  api.request({ method: "sql", params: { sql: "SELECT ?", params: [{ nested: true }] } });
  // @ts-expect-error section reads require an explicit path
  api.request({ method: "readSection", params: { heading: "Title" } });
  // @ts-expect-error method-specific results are not interchangeable
  if (read.ok) read.result.columns;
}
void contracts;
