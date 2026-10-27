import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { APP_VERSION } from '../src/shared/version';

describe('version', () => {
  it('matches package.json', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });
});
