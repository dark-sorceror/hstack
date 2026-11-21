/** Index inner ranges for containment queries, including overlapping spans.
 */
export function createContainmentIndex(ranges: readonly { innerFrom: number; innerTo: number }[]) {
  let end = -1;
  const spans = [...ranges]
    .sort((a, b) => a.innerFrom - b.innerFrom)
    .map((range) => ({ from: range.innerFrom, to: (end = Math.max(end, range.innerTo)) }));
  return (from: number, to: number) => {
    let low = 0,
      high = spans.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((spans[middle]?.from ?? Infinity) <= from) low = middle + 1;
      else high = middle;
    }
    return low > 0 && (spans[low - 1]?.to ?? -1) >= to;
  };
}
