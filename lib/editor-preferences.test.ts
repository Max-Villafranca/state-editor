import { describe, expect, it } from 'vitest';

import {
  MINIMAP_VISIBILITY_KEY,
  readMinimapVisibility,
  writeMinimapVisibility,
} from './editor-preferences';

function preferenceStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(MINIMAP_VISIBILITY_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('minimap preference', () => {
  it('defaults to hidden until the user explicitly enables it', () => {
    expect(readMinimapVisibility(preferenceStorage())).toBe(false);
  });

  it('round-trips both explicit visibility choices', () => {
    const storage = preferenceStorage();
    writeMinimapVisibility(storage, true);
    expect(readMinimapVisibility(storage)).toBe(true);
    writeMinimapVisibility(storage, false);
    expect(readMinimapVisibility(storage)).toBe(false);
  });
});
