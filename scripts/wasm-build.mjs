import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "native/autocorrect/core.rs");
const binary = path.join(root, "src/data/autocorrect.wasm");
const recordFile = path.join(root, "native/autocorrect/build.json");
const toolchain = /channel\s*=\s*"([^"]+)"/.exec(
  await readFile(path.join(root, "rust-toolchain.toml"), "utf8")
)[1];
const hash = (data) => createHash("sha256").update(data).digest("hex");
const checkSource = process.argv.includes("--source-only");
const checkBinary = process.argv.includes("--check");

if (checkSource) {
  const record = JSON.parse(await readFile(recordFile, "utf8"));
  if (
    record.sourceSHA256 !== hash(await readFile(source)) ||
    record.wasmSHA256 !== hash(await readFile(binary)) ||
    record.rust !== toolchain
  ) {
    throw Error(
      "Rust source/toolchain/Wasm changed without a matching rebuild. Run npm run build:wasm."
    );
  }
  console.log("Rust source, pinned toolchain and bundled Wasm record agree.");
} else {
  const rustc = process.env.RUSTC || "rustc";
  const version = execFileSync(rustc, ["--version"], { encoding: "utf8" }).trim();
  if (!version.startsWith("rustc " + toolchain + " "))
    throw Error(`Expected Rust ${toolchain}; found ${version}.`);
  const temporary = await mkdtemp(path.join(tmpdir(), "hstack-wasm-"));
  try {
    const output = path.join(temporary, "autocorrect.wasm");
    execFileSync(
      rustc,
      [
        "--edition=2021",
        "--crate-name=hstack_autocorrect",
        "--target=wasm32-unknown-unknown",
        "--crate-type=cdylib",
        "-O",
        "-C",
        "panic=abort",
        "-C",
        "lto=fat",
        "-C",
        "codegen-units=1",
        "-C",
        "strip=symbols",
        "-C",
        "metadata=hstack-autocorrect-v1",
        "-C",
        "link-arg=--initial-memory=67108864",
        "-C",
        "link-arg=--max-memory=100663296",
        "--remap-path-prefix",
        root.replace(/\/$/, "") + "=hstack",
        source,
        "-o",
        output,
      ],
      { stdio: "inherit" }
    );
    const built = await readFile(output);
    const record = {
      rust: toolchain,
      target: "wasm32-unknown-unknown",
      sourceSHA256: hash(await readFile(source)),
      wasmSHA256: hash(built),
    };
    if (checkBinary) {
      if (!built.equals(await readFile(binary)))
        throw Error(
          "Bundled Wasm differs from a fresh pinned-toolchain build. Run npm run build:wasm."
        );
      console.log("Bundled Wasm matches a fresh pinned-toolchain build.");
    } else {
      await writeFile(binary, built);
      await writeFile(recordFile, JSON.stringify(record, null, 2) + "\n");
      console.log(
        "Rebuilt Wasm and recorded source/toolchain provenance. Run npm run build to embed it."
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
