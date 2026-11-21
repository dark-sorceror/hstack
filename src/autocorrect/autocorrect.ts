import { protectedContext } from "../features/logic.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The exported ABI of native/autocorrect, kept separate from arbitrary Wasm exports. */
export interface AutocorrectCore {
  memory: WebAssembly.Memory;
  reset(): void;
  input_ptr(): number;
  input_capacity(): number;
  word_ptr(id: number): number;
  word_len(id: number): number;
  lookup(pointer: number, length: number): number;
  lookup_with_limit(pointer: number, length: number, limit: number): number;
  lookup_distance(): number;
  word_frequency(id: number): number;
  second_frequency(): number;
  candidate_count(): number;
  add_word(pointer: number, length: number, frequency: number): number;
  build_index(): number;
}
export interface BundledAutocorrectAssets {
  wasmBase64: string;
  dictionary: string;
  typos: Record<string, string>;
  technical: string[];
}
interface CorrectorOptions {
  typos?: Record<string, string>;
  technical?: string[];
  personal?: string[];
}
export interface Corrector {
  core: AutocorrectCore;
  setPersonalWords(words: string[]): void;
  reject(word: string): void;
  correctWord(word: string, options?: { sentenceStart?: boolean }): string | null;
  stats?: {
    backend: string;
    words: number;
    signatures: number;
    wasmBytes: number;
    startupMs: number;
  };
}

const MIN_FREQUENCY = 1_000_000;
const MIN_RATIO = 1.5;

function preserveCase(original: string, replacement: string) {
  return /^[A-Z][a-z]+$/.test(original)
    ? replacement[0]!.toUpperCase() + replacement.slice(1)
    : replacement;
}

function makeCorrector(
  core: AutocorrectCore,
  { typos = {}, technical = [], personal = [] }: CorrectorOptions = {}
): Corrector {
  const decoder = new TextDecoder();
  const ignored = new Set<string>();
  const technicalWords = new Set(technical.map((word) => word.toLowerCase()));
  const cache = new Map<string, string | null>();
  let personalWords = new Set(personal.map((word) => String(word).toLowerCase()));
  const input = core.input_ptr();
  const write = (word: string) => {
    const buffer = new Uint8Array(core.memory.buffer, input, core.input_capacity());
    for (let index = 0; index < word.length; index++) buffer[index] = word.charCodeAt(index);
  };
  const read = (id: number) =>
    decoder.decode(new Uint8Array(core.memory.buffer, core.word_ptr(id), core.word_len(id)));
  const corrector: Corrector = {
    core,
    setPersonalWords(words) {
      personalWords = new Set(
        words.map((word) => String(word).trim().toLowerCase()).filter(Boolean)
      );
      cache.clear();
    },
    reject(word) {
      ignored.add(word.toLowerCase());
    },
    correctWord(word, { sentenceStart = false } = {}) {
      if (
        !/^[a-z]{3,32}$/i.test(word) ||
        /^[A-Z]+$/.test(word) ||
        !/^(?:[a-z]+|[A-Z][a-z]+)$/.test(word)
      )
        return null;
      const lower = word.toLowerCase();
      if (technicalWords.has(lower) || personalWords.has(lower) || ignored.has(lower)) return null;
      if (Object.hasOwn(typos, lower)) return preserveCase(word, typos[lower]!);
      const capitalized = word !== lower;
      // Sentence-initial typos may be capitalized; names within prose stay literal.
      if ((capitalized && !sentenceStart) || lower.length < 4) return null;
      const key = lower + (capitalized ? ":title" : ":lower");
      if (cache.has(key)) {
        const cached = cache.get(key);
        return cached ? preserveCase(word, cached) : null;
      }
      write(lower);
      let id = core.lookup(input, lower.length);
      let result: string | null = null;
      if (id >= 0 && core.lookup_distance() === 1) {
        const frequency = core.word_frequency(id);
        const runnerUp = core.second_frequency();
        const uniqueLongWord = lower.length >= 7 && core.candidate_count() === 1 && !capitalized;
        const minimum = uniqueLongWord
          ? 10_000
          : capitalized || lower.length === 4
            ? 5_000_000
            : MIN_FREQUENCY;
        const ratio = capitalized || lower.length === 4 ? 3 : MIN_RATIO;
        if (frequency >= minimum && (!runnerUp || frequency >= runnerUp * ratio)) result = read(id);
      } else if (id < 0 && core.lookup_distance() !== 0 && lower.length >= 6) {
        id = core.lookup_with_limit(input, lower.length, 2);
        if (id >= 0 && core.lookup_distance() === 2) {
          const frequency = core.word_frequency(id),
            runnerUp = core.second_frequency();
          const minimum = !runnerUp && !capitalized ? 1_000_000 : 5_000_000;
          if (frequency >= minimum && (!runnerUp || frequency >= runnerUp * 3)) result = read(id);
        }
      }
      if (cache.size >= 4096) cache.clear();
      cache.set(key, result);
      return result ? preserveCase(word, result) : null;
    },
  };
  return corrector;
}

async function loadCorrector(
  directory: string | BundledAutocorrectAssets,
  personal: string[] = []
) {
  const started = performance.now();
  let binary: Buffer, dictionary: string, typos: Record<string, string>, technical: string[];
  if (directory && typeof directory === "object") {
    binary = Buffer.from(directory.wasmBase64, "base64");
    ({ dictionary, typos, technical } = directory);
  } else {
    // Source-test/rebuild path. Production uses the embedded object above.
    const loaded = await Promise.all([
      readFile(path.join(directory, "autocorrect.wasm")),
      readFile(path.join(directory, "autocorrect-frequency.txt"), "utf8"),
      readFile(path.join(directory, "autocorrect-typos.json"), "utf8"),
      readFile(path.join(directory, "autocorrect-technical.json"), "utf8"),
    ]);
    [binary, dictionary] = loaded;
    typos = JSON.parse(loaded[2]);
    technical = JSON.parse(loaded[3]);
  }
  const { instance } = await WebAssembly.instantiate(binary as BufferSource, {});
  // This module is bundled from the pinned, provenance-checked native engine.
  const core = instance.exports as unknown as AutocorrectCore;
  core.reset();
  const pointer = core.input_ptr();
  let loaded = 0;
  for (const line of dictionary.split(/\r?\n/)) {
    const match = /^([a-z]{1,32})\s+(\d+)$/.exec(line);
    if (!match) continue;
    const buffer = new Uint8Array(core.memory.buffer, pointer, core.input_capacity());
    for (let index = 0; index < match[1]!.length; index++)
      buffer[index] = match[1]!.charCodeAt(index);
    const id = core.add_word(pointer, match[1]!.length, Number(match[2]));
    if (id < 0) throw new Error("Autocorrect dictionary exceeds engine capacity: " + id);
    loaded++;
    // Yield during one-time initialization; typing never waits for this loader.
    if (loaded % 4000 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const signatures = core.build_index();
  if (signatures < 0) throw new Error("Autocorrect index could not be initialized");
  const corrector = makeCorrector(core, { typos, technical, personal });
  corrector.stats = {
    backend: "Rust / WebAssembly",
    words: loaded,
    signatures,
    wasmBytes: binary.length,
    startupMs: performance.now() - started,
  };
  return corrector;
}

// Called only for a physical Space key at a single caret. Return one atomic
// word+space edit; no background rewriting or asynchronous caret races.
function boundaryPlan(
  text: string,
  position: number,
  corrector: Pick<Corrector, "correctWord"> | null | undefined
) {
  if (!corrector || position < 1 || position > text.length || /\s/.test(text[position - 1]!))
    return null;
  if (/[\p{L}\p{N}_]/u.test(text[position] || "")) return null;
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  const before = text.slice(lineStart, position);
  const chunk = /\S+$/.exec(before);
  if (!chunk || chunk[0].length > 80) return null;
  const match = /^([*_~({'"“‘]*)([A-Za-z]{3,32})([.,!?;:)\]}'"’”*_~]*)$/.exec(chunk[0]);
  if (!match) return null;
  const from = lineStart + chunk.index + match[1]!.length;
  // Keep URLs, wiki links, HTML, link destinations, and indented code literal.
  if (
    /(?:\[\[|!\[)[^\]]*$/.test(before) ||
    /\[[^\]]*\]\([^)]*$/.test(before) ||
    /<[^>]*$/.test(before) ||
    (/^(?: {4}|\t)/.test(before) && !/^\s*(?:[-+*]|\d+[.)])\s/.test(before)) ||
    protectedContext(text, from)
  )
    return null;
  const preceding = text.slice(lineStart, from);
  const contentBefore = preceding
    .replace(/^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?/, "")
    .replace(/[*_~({'"“‘]+$/, "");
  const sentenceStart = !contentBefore.trim() || /[.!?]\s+(?:[*_~({'"“‘]*)$/.test(preceding);
  const replacement = corrector.correctWord(match[2]!, { sentenceStart });
  if (!replacement || replacement === match[2]) return null;
  return {
    from,
    to: position,
    insert: replacement + match[3] + " ",
    raw: match[2]! + match[3]!,
    original: match[2]!,
  };
}

export { loadCorrector, makeCorrector, boundaryPlan, preserveCase, MIN_FREQUENCY, MIN_RATIO };
