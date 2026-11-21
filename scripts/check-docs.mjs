import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const docs = path.join(root, "docs");
const config = JSON.parse(await readFile(path.join(docs, "docs.json"), "utf8"));
const pages = [];
function navigation(value) {
  if (typeof value === "string") pages.push(value);
  else if (Array.isArray(value)) value.forEach(navigation);
  else if (value && typeof value === "object") {
    for (const key of ["tabs", "groups", "pages"]) if (value[key]) navigation(value[key]);
  }
}
navigation(config.navigation);
assert.equal(new Set(pages).size, pages.length, "Duplicate navigation page");
assert.ok(pages.length, "Navigation must include pages");
const files = [];
const assets = new Set();
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(filename);
    else if (/\.mdx?$/.test(entry.name)) files.push(filename);
    else assets.add(path.relative(docs, filename));
  }
}
await walk(docs);
const routes = new Map(
  files.map((file) => [path.relative(docs, file).replace(/\.mdx?$/, ""), file])
);
assert.deepEqual(new Set(pages), new Set(routes.keys()), "Navigation and canonical pages differ");
const rootFiles = ["README.md", "CONTRIBUTING.md", "SECURITY.md"];
let links = 0;
for (const filename of [...files, ...rootFiles.map((file) => path.join(root, file))]) {
  const text = await readFile(filename, "utf8");
  if (filename.startsWith(docs + path.sep)) {
    assert.match(
      text,
      /^---\ntitle: .+\ndescription: .+\n---\n/,
      `Missing page metadata: ${filename}`
    );
  }
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const targets = [
    ...[...prose.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)\)/g)].map((match) => match[1]),
    ...[...prose.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]),
  ];
  for (const target of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    const destination = decodeURIComponent(target.split(/[?#]/)[0]);
    if (destination.startsWith("/")) {
      assert.ok(
        routes.has(destination.slice(1)) || assets.has(destination.slice(1)),
        `Unknown site route or asset ${target} in ${filename}`
      );
    } else {
      const resolved = path.resolve(path.dirname(filename), destination);
      assert.ok(resolved.startsWith(root + path.sep), `Link escapes repository: ${target}`);
      await access(resolved).catch(() => {
        throw new Error(`Missing local link ${target} in ${path.relative(root, filename)}`);
      });
    }
    links++;
  }
}
for (const key of ["logo", "favicon"]) {
  const value = config[key];
  const targets = typeof value === "string" ? [value] : [value?.light, value?.dark].filter(Boolean);
  for (const target of targets) {
    if (/^https?:/.test(target)) continue;
    assert.ok(assets.has(target.replace(/^\//, "")), `Missing ${key} asset: ${target}`);
  }
}
console.log(
  `Documentation checked: ${pages.length} canonical pages, ${links} local links, README and contributor entry points.`
);
