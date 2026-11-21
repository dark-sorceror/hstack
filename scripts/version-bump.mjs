import { readFile, writeFile } from "node:fs/promises";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw Error("Obsidian release versions must be x.y.z without v prefix.");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.version = version;
const versions = JSON.parse(await readFile("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
await writeFile("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
await writeFile("versions.json", JSON.stringify(versions, null, 2) + "\n");
