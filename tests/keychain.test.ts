import { access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { helperPath } from '../src/keychain.js';

describe('keychain helper packaging', () => {
  it('resolves to the compiled helper without placing secrets in arguments', async () => {
    expect(helperPath().endsWith('/bin/tr-keychain-helper')).toBe(true);
    await expect(access(helperPath())).resolves.toBeUndefined();
  });
});
