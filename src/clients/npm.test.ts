import { describe, it, expect } from 'vitest';
import { encodePackageName, normalizeRepoUrl } from './npm.js';

describe('encodePackageName', () => {
  it('leaves regular package names unchanged', () => {
    expect(encodePackageName('lodash')).toBe('lodash');
    expect(encodePackageName('react-hook-form')).toBe('react-hook-form');
  });

  it('encodes scoped packages', () => {
    expect(encodePackageName('@tanstack/react-table')).toBe('%40tanstack%2Freact-table');
    expect(encodePackageName('@types/node')).toBe('%40types%2Fnode');
  });
});

describe('normalizeRepoUrl', () => {
  it('returns null for undefined input', () => {
    expect(normalizeRepoUrl(undefined)).toBeNull();
  });

  it('strips git+ prefix', () => {
    const result = normalizeRepoUrl('git+https://github.com/owner/repo');
    expect(result).toBe('https://github.com/owner/repo');
  });

  it('strips .git suffix', () => {
    const result = normalizeRepoUrl('https://github.com/owner/repo.git');
    expect(result).toBe('https://github.com/owner/repo');
  });

  it('handles combined git+ prefix and .git suffix', () => {
    const result = normalizeRepoUrl('git+https://github.com/owner/repo.git');
    expect(result).toBe('https://github.com/owner/repo');
  });

  it('converts git:// to https://', () => {
    const result = normalizeRepoUrl('git://github.com/owner/repo.git');
    expect(result).toBe('https://github.com/owner/repo');
  });

  it('handles github: shorthand', () => {
    const result = normalizeRepoUrl('github:owner/repo');
    expect(result).toBe('https://github.com/owner/repo');
  });

  it('returns null for non-URL strings', () => {
    expect(normalizeRepoUrl('not-a-url')).toBeNull();
  });

  it('passes through already-clean URLs', () => {
    expect(normalizeRepoUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });
});
