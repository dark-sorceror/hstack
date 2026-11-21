import * as emphasis from "./emphasis.js";
import * as pairs from "../features/pairs.js";

export function analyzeSource(text: string) {
  const scanned = emphasis.scanSource(text);
  const marks = emphasis.getEmphasis(text, scanned);
  return {
    lists: scanned.lists,
    emphasis: marks,
    nestedAsterisks: pairs.getNestedAsteriskEmphasis(text, marks, scanned.mask),
  };
}
