import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";

function logCacheError(operation: string, error: unknown) {
  console.error(`[cache] ${operation} failed:`, error instanceof Error ? error.message : error);
}

export const redis = new Redis({
  url: env.UPSTASH_REDIS_KV_REST_API_URL ?? "https://example.upstash.io",
  token: env.UPSTASH_REDIS_KV_REST_API_TOKEN ?? "development-token",
});

export const apiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(env.RATE_LIMIT_TOKENS_PER_MINUTE, "1 m"),
  analytics: true,
  prefix: "mini-cms:ratelimit",
});

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch (error) {
    logCacheError("getCached", error);
    return null;
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds = 60) {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    logCacheError("setCached", error);
  }
}

export async function invalidateCache(key: string) {
  try {
    await redis.del(key);
  } catch (error) {
    logCacheError("invalidateCache", error);
  }
}

export async function invalidateCollectionCache(
  slug: string,
  environmentId?: string,
) {
  if (environmentId) {
    await invalidateCache(`collection:${slug}:env:${environmentId}`);
  } else {
    await invalidateCache(`collection:${slug}`);
  }
}

/**
 * Invalidate all cache keys matching a collection pattern.
 * This is used when the environment isn't known at invalidation time.
 */
export async function invalidateCollectionCacheByPattern(slug: string) {
  // We use a scan-based approach for Redis pattern matching
  try {
    let cursor = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: `*collection*${slug}*`,
        count: 50,
      });
      cursor = Number(nextCursor);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== 0);
  } catch (error) {
    logCacheError("invalidateCollectionCacheByPattern", error);
  }
}

export async function checkRateLimit(
  identifier: string,
): Promise<{ success: boolean; reset?: number }> {
  try {
    const result = await apiRateLimit.limit(identifier);
    return { success: result.success, reset: result.reset };
  } catch (error) {
    logCacheError("rateLimit", error);
    // Allow request when rate limiter is unavailable
    return { success: true };
  }
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function getRateLimitClientIdentifier(request: Request): string {
  // 1) API key from CLI / programmatic access
  const apiKey = request.headers.get("x-api-key")?.trim();
  if (apiKey && apiKey.length > 0) {
    return `key:${hashIdentifier(apiKey)}`;
  }

  // 2) Session cookie (better-auth default cookie name)
  const cookie = request.headers.get("cookie") ?? "";
  const sessionMatch = cookie.match(/(?:^|;\s*)better-auth\.session_token=([^;]+)/);
  if (sessionMatch?.[1]) {
    return `session:${hashIdentifier(sessionMatch[1])}`;
  }

  // 3) Authorization Bearer token (fallback)
  const authHeader = request.headers.get("authorization")?.trim();
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return `token:${hashIdentifier(token)}`;
    }
  }

  // 4) Fallback to IP for anonymous public requests
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "local";
  return `ip:${ip}`;
}
