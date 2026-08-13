import type { ResolvedConfigSnapshot } from "@review/domain/configuration";

export interface ConfigCacheEntry {
  readonly etag: string;
  readonly snapshot: ResolvedConfigSnapshot;
  readonly fetchedAt: number;
}

export interface ConfigClientOptions {
  readonly contextServiceBaseUrl?: string;
  readonly fetchFn?: typeof fetch;
}

export class ConfigCache {
  readonly #contextServiceBaseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #cache = new Map<string, ConfigCacheEntry>();

  public constructor(options: ConfigClientOptions = {}) {
    this.#contextServiceBaseUrl =
      options.contextServiceBaseUrl ?? "http://localhost:3001";
    this.#fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  public async getSnapshot(
    tenantId: string,
    locationId: string,
  ): Promise<{ snapshot: ResolvedConfigSnapshot; stale: boolean }> {
    const cacheKey = `${tenantId}:${locationId}`;
    const cached = this.#cache.get(cacheKey);

    const headers: Record<string, string> = {};
    if (cached) {
      headers["If-None-Match"] = cached.etag;
    }

    try {
      const response = await this.#fetchFn(
        `${this.#contextServiceBaseUrl}/context/${tenantId}/${locationId}`,
        { headers },
      );

      if (response.status === 304 && cached) {
        return { snapshot: cached.snapshot, stale: false };
      }

      if (response.ok) {
        const etag = response.headers.get("ETag") ?? `"${Date.now()}"`;
        const snapshot = (await response.json()) as ResolvedConfigSnapshot;
        this.#cache.set(cacheKey, {
          etag,
          snapshot,
          fetchedAt: Date.now(),
        });
        return { snapshot, stale: false };
      }
    } catch {
      // Context service unavailable - fallback to stale cache if present
      if (cached) {
        return { snapshot: cached.snapshot, stale: true };
      }
      throw new Error(
        `Failed to fetch configuration for tenant ${tenantId} and location ${locationId}, and no cached snapshot exists.`,
      );
    }

    if (cached) {
      return { snapshot: cached.snapshot, stale: true };
    }

    throw new Error(
      `Context Service returned error for tenant ${tenantId}, location ${locationId}.`,
    );
  }
}
