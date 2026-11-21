// esbuild embeds these assets; the installed plugin needs no sidecar downloads.
module.exports = {
  wasmBase64: require("./data/autocorrect.wasm"),
  dictionary: require("./data/autocorrect-frequency.txt"),
  typos: require("./data/autocorrect-typos.json"),
  technical: require("./data/autocorrect-technical.json"),
};
