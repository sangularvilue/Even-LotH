const TTL_MS = 24 * 60 * 60 * 1000

type CacheEntry<T> = {
  data: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return undefined
  }
  return entry.data as T
}

export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, expiresAt: Date.now() + TTL_MS })
}
