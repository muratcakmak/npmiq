import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionCache, TTL } from './cache.js';

describe('SessionCache', () => {
  let cache: SessionCache;

  beforeEach(() => {
    cache = new SessionCache();
  });

  it('stores and retrieves a value', () => {
    cache.set('key', 'value', 5000);
    expect(cache.get('key')).toBe('value');
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns undefined after TTL expires', () => {
    // Use fake timers to control time
    vi.useFakeTimers();
    cache.set('key', 'value', 1000); // 1 second TTL
    expect(cache.get('key')).toBe('value');
    vi.advanceTimersByTime(1001);
    expect(cache.get('key')).toBeUndefined();
    vi.useRealTimers();
  });

  it('increments hit count on cache hit', () => {
    cache.set('key', 42, 5000);
    cache.get('key');
    cache.get('key');
    expect(cache.getHitCount()).toBe(2);
  });

  it('does not increment hit count on cache miss', () => {
    cache.get('nonexistent');
    expect(cache.getHitCount()).toBe(0);
  });

  it('has() returns true for live key', () => {
    cache.set('key', true, 5000);
    expect(cache.has('key')).toBe(true);
  });

  it('has() returns false for missing key', () => {
    expect(cache.has('missing')).toBe(false);
  });

  it('delete() removes a key', () => {
    cache.set('key', 'val', 5000);
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
  });

  it('clear() removes all keys and resets hit count', () => {
    cache.set('a', 1, 5000);
    cache.set('b', 2, 5000);
    cache.get('a');
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.getHitCount()).toBe(0);
  });

  it('stores complex objects', () => {
    const obj = { name: 'react', downloads: 1000000 };
    cache.set('pkg', obj, 5000);
    expect(cache.get('pkg')).toEqual(obj);
  });

  it('TTL constants are positive numbers', () => {
    expect(TTL.SERPER).toBeGreaterThan(0);
    expect(TTL.NPM).toBeGreaterThan(0);
    expect(TTL.GITHUB).toBeGreaterThan(0);
    expect(TTL.REDDIT).toBeGreaterThan(0);
    expect(TTL.LLM).toBeGreaterThan(0);
    expect(TTL.REDDIT_TOKEN).toBeGreaterThan(TTL.LLM);
  });
});
