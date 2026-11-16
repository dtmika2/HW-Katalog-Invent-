/** Seeded PRNG (mulberry32) so fixtures are deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Pick one element with a PRNG. */
export function pick<T>(rand: () => number, list: readonly T[]): T {
  const v = list[Math.floor(rand() * list.length)];
  if (v === undefined) throw new Error('pick from empty list');
  return v;
}

/** Integer in [min, max]. */
export function intBetween(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
