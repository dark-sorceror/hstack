// esbuild embeds these assets; installation needs no sidecar downloads.
import wasmBase64 from "./data/autocorrect.wasm";
import dictionary from "./data/autocorrect-frequency.txt";
import typos from "./data/autocorrect-typos.json";
import technical from "./data/autocorrect-technical.json";
export { wasmBase64, dictionary, typos, technical };
