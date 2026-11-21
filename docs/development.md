# Development

Keep this Git repository outside any personal vault. The installed plugin
folder is a build target, not the source of truth. Use Node.js 22.13+ and npm.

```sh
npm ci
npm run check
npm run dev
```

`npm run check` checks the typed API/entry, builds, runs tests and verifies that
a three-file install can load emoji/Wasm/dictionary/SQLite without sidecars.
The smoke test supplies mocked Obsidian APIs and real CodeMirror/Node modules;
it complements, rather than replaces, native editor testing.

`npm run dev` watches and creates a readable bundle with inline source maps.
`npm run build` creates the release bundle with no source map. Build before
packaging so a debug map cannot accidentally ship. Watch does not deploy.

```sh
mkdir -p /absolute/path/to/test-vault
npm run deploy -- /absolute/path/to/test-vault
# Custom Obsidian config directory:
npm run deploy -- /absolute/path/to/test-vault --config-dir=.config
```

Enable/reload hstack in that vault. An official CLI can run
`vault=TestVault plugin:reload id=hstack`. Never enable the legacy helper at the
same time. Native internals such as editor.cm require compatibility testing.

## Optional Rust rebuild

The compiled Wasm is checked into source; normal JS builds do not require Rust.
To change the engine, install Rust yourself, add `wasm32-unknown-unknown`, then:

```sh
npm run build:wasm
npm run check
```

`RUSTC=/absolute/path/to/rustc npm run build:wasm` selects an isolated compiler.
The build script never installs a toolchain or modifies shell setup.
