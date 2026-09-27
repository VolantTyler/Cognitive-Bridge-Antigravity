import { describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { APP_VERSION_LABEL } from './appVersion';

describe('APP_VERSION_LABEL', () => {
  it('prefixes the package.json version', () => {
    expect(APP_VERSION_LABEL).toBe(`v${version}`);
  });
});
