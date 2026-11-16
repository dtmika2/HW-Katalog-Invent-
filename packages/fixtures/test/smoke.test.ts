import { describe, expect, it } from 'vitest';
import { FIXTURES_SEED } from '../src/index';

describe('fixtures', () => {
  it('uses seed 2027', () => {
    expect(FIXTURES_SEED).toBe(2027);
  });
});
