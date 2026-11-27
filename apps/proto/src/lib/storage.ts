/**
 * Suffix for browser storage names. Empty in normal builds; a preview build of a branch sets
 * VITE_STORAGE_SUFFIX, because it is served from the same origin as the live demo (GitHub Pages)
 * and must not overwrite the live demo's saved data, or the other way round.
 */
export const STORAGE_SUFFIX: string =
  (import.meta.env.VITE_STORAGE_SUFFIX as string | undefined) ?? '';
