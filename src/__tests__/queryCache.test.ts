import { cachedFetch, getCached, invalidateCache, invalidateCachePrefix } from '../lib/queryCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('query cache invalidation', () => {
  beforeEach(() => invalidateCachePrefix(''));

  it('does not reuse or restore an invalidated in-flight supplier lookup', async () => {
    const oldRequest = deferred<string>();
    const oldFetch = cachedFetch('supplier-lookup', () => oldRequest.promise);
    invalidateCachePrefix('supplier-');
    const freshFetcher = jest.fn(async () => 'updated suppliers');
    const freshFetch = cachedFetch('supplier-lookup', freshFetcher);
    expect(freshFetcher).toHaveBeenCalledTimes(1);
    await expect(freshFetch).resolves.toBe('updated suppliers');
    oldRequest.resolve('outdated suppliers');
    await oldFetch;
    expect(getCached('supplier-lookup')).toBe('updated suppliers');
  });

  it('keeps the replacement request deduplicated when the old request finishes', async () => {
    const oldRequest = deferred<string>();
    const newRequest = deferred<string>();
    const oldFetch = cachedFetch('supplier-lookup', () => oldRequest.promise);
    invalidateCache('supplier-lookup');
    const newFetch = cachedFetch('supplier-lookup', () => newRequest.promise);
    oldRequest.resolve('old');
    await oldFetch;
    const redundantFetcher = jest.fn(async () => 'redundant');
    const deduplicated = cachedFetch('supplier-lookup', redundantFetcher);
    expect(redundantFetcher).not.toHaveBeenCalled();
    newRequest.resolve('new');
    await expect(newFetch).resolves.toBe('new');
    await expect(deduplicated).resolves.toBe('new');
  });
});
