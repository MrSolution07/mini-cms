import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, projects, requestLogs } from "@/db/schema";
import { getCollectionById, getCollectionBySlug } from "@/db/queries/collections";
import { getEnvironmentBySlug, getProductionEnvironment } from "@/db/queries/environments";
import { listItems } from "@/db/queries/items";
import { normalizePagination } from "@/db/queries/shared";
import { checkRateLimit, getCached, setCached, getRateLimitClientIdentifier } from "@/lib/cache";
import {
  anonymizeServerValue,
  captureServerError,
  captureServerEvent,
  createAnonymousServerIdentity,
} from "@/lib/posthog";

type CollectionItemsPayload = {
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  project: {
    id: string;
    slug: string;
    name: string;
  };
  collection: Awaited<ReturnType<typeof getCollectionById>>;
  environment: {
    id: string;
    slug: string;
    name: string;
    isProduction: boolean;
  } | null;
  items: Awaited<ReturnType<typeof listItems>>["items"];
  pagination: Awaited<ReturnType<typeof listItems>>["pagination"];
};

const PUBLIC_CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-requested-with",
  "access-control-max-age": "86400",
  "access-control-expose-headers": "retry-after, x-cache",
} as const;

export async function handleCollectionItems(request: Request) {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  const url = new URL(request.url);
  const requestIdentity = createAnonymousServerIdentity({
    subject: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.headers.get("x-real-ip")
      ?? request.headers.get("origin")
      ?? request.headers.get("referer")
      ?? "public-request",
    organizationId: url.searchParams.get("w"),
    projectId: url.searchParams.get("p"),
  });

  try {
    const {
      workspaceId,
      projectId,
      collectionId,
      collectionSlug,
      page,
      limit,
      query,
      rawFilters,
      environmentSlug,
    } = parseCollectionItemsSearch(url);

    if (!workspaceId || !projectId || (!collectionId && !collectionSlug)) {
      return json(
        {
          error:
            "w, p, and collection_id (or collection_slug) query parameters are required.",
        },
        400,
      );
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? request.headers.get("x-real-ip")
      ?? "local";

    const rateLimit = await checkRateLimit(
      `${getRateLimitClientIdentifier(request)}:${workspaceId}:${projectId}:${collectionId ?? collectionSlug}`,
    );

    if (!rateLimit.success) {
      const retryAfter = Math.max(
        0,
        Math.ceil(((rateLimit.reset ?? 0) - Date.now()) / 1000),
      );

      await captureServerEvent({
        event: "public_collection_items_rate_limited",
        identity: requestIdentity,
        properties: {
          collection_slug_hash: anonymizeServerValue(collectionSlug, "collection"),
          has_collection_id: Boolean(collectionId),
          retry_after_seconds: retryAfter,
        },
      });

      return json(
        { error: "Too many requests." },
        429,
        { "retry-after": String(retryAfter) },
      );
    }

    const workspace = await db.query.organizations.findFirst({
      where: eq(organizations.id, workspaceId),
    });

    if (!workspace) {
      return json({ error: "Workspace not found." }, 404);
    }

    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, projectId),
        eq(projects.organizationId, workspaceId),
      ),
    });

    if (!project) {
      return json({ error: "Project not found." }, 404);
    }

    const apiAccess = project.apiAccess ?? { type: "public" };
    const origin = request.headers.get("origin") || request.headers.get("referer") || "";
    const originDomain = extractDomain(origin);

    if (apiAccess.type === "none") {
      await captureServerEvent({
        event: "public_collection_items_denied",
        identity: requestIdentity,
        properties: {
          collection_slug_hash: anonymizeServerValue(collectionSlug, "collection"),
          reason: "api_access_disabled",
        },
      });
      return json({ error: "API access is disabled for this project." }, 403);
    }

    if (apiAccess.type === "restricted" && apiAccess.allowedDomains && apiAccess.allowedDomains.length > 0) {
      const isAllowed = apiAccess.allowedDomains.some((domain) => {
        const normalizedDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "");
        const normalizedOrigin = originDomain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "");
        return normalizedOrigin === normalizedDomain || normalizedOrigin.endsWith(`.${normalizedDomain}`);
      });

      if (!isAllowed && originDomain !== "unknown" && originDomain !== "") {
        await captureServerEvent({
          event: "public_collection_items_denied",
          identity: requestIdentity,
          properties: {
            collection_slug_hash: anonymizeServerValue(collectionSlug, "collection"),
            reason: "domain_not_allowed",
            origin_domain_hash: anonymizeServerValue(originDomain, "origin"),
          },
        });
        return json(
          { error: `API access is restricted. Origin '${originDomain}' is not allowed.` },
          403,
        );
      }
    }

    const collection = collectionId
      ? await getCollectionById(collectionId, workspaceId, projectId)
      : await getCollectionBySlug(collectionSlug!, workspaceId, projectId);

    if (!collection) {
      return json({ error: "Collection not found." }, 404);
    }

    // Fire-and-forget request logging for analytics
    void db
      .insert(requestLogs)
      .values({
        projectId,
        collectionSlug: collection.slug,
        originDomain,
        timestamp: new Date().toISOString(),
      })
      .catch(() => {});

    await captureServerEvent({
      event: "public_collection_items_requested",
      identity: createAnonymousServerIdentity({
        subject: ip,
        organizationId: workspaceId,
        projectId,
      }),
      properties: {
        collection_slug_hash: anonymizeServerValue(collection.slug, "collection"),
        origin_domain_hash: anonymizeServerValue(originDomain, "origin"),
        page,
        limit,
        has_query: Boolean(query),
        filter_count: Object.keys(rawFilters).length,
      },
    });

    // Resolve environment
    const env = environmentSlug
      ? await getEnvironmentBySlug(environmentSlug, projectId)
      : await getProductionEnvironment(projectId);

    if (environmentSlug && !env) {
      return json({ error: `Environment '${environmentSlug}' not found.` }, 404);
    }

    const environmentId = env?.id ?? null;

    const filters = validateFilters(rawFilters, collection.schema);
    const cacheKey = buildCacheKey({
      workspaceId,
      projectId,
      environmentId,
      collectionId: collection.id,
      page,
      limit,
      query,
      filters,
    });
    const cached = await getCached<CollectionItemsPayload>(cacheKey);

    if (cached) {
      await captureServerEvent({
        event: "public_collection_items_cache_hit",
        identity: createAnonymousServerIdentity({
          subject: ip,
          organizationId: workspaceId,
          projectId,
        }),
        properties: {
          collection_slug_hash: anonymizeServerValue(collection.slug, "collection"),
        },
      });

      return json(cached, 200, {
        "x-cache": "HIT",
        "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
      });
    }

    const items = await listItems(collection.id, {
      page,
      limit,
      publishedOnly: true,
      query,
      filters,
      schema: collection.schema,
      environmentId: environmentId ?? undefined,
    });

    const payload = {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
      },
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
      },
      collection,
      environment: env
        ? {
            id: env.id,
            slug: env.slug,
            name: env.name,
            isProduction: env.isProduction,
          }
        : null,
      items: items.items,
      pagination: items.pagination,
    } satisfies CollectionItemsPayload;

    await setCached(cacheKey, payload, 60);

    await captureServerEvent({
      event: "public_collection_items_cache_miss",
      identity: createAnonymousServerIdentity({
        subject: ip,
        organizationId: workspaceId,
        projectId,
      }),
      properties: {
        collection_slug_hash: anonymizeServerValue(collection.slug, "collection"),
        item_count: items.items.length,
      },
    });

    return json(payload, 200, {
      "x-cache": "MISS",
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=30",
    });
  } catch (error) {
    await captureServerError({
      error,
      identity: requestIdentity,
      properties: {
        area: "public_api",
        operation: "collection_items",
      },
    });
    return handleError(error);
  }
}

export const Route = createFileRoute("/api/collections/items")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleCollectionItems(request),
      OPTIONS: async ({ request }: { request: Request }) =>
        handleCollectionItems(request),
    },
  },
});

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return withCors(
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...headers,
      },
    }),
  );
}

function handleError(error: unknown) {
  if (error instanceof Response) {
    return withCors(error);
  }

  return json(
    { error: error instanceof Error ? error.message : "Unexpected error." },
    500,
  );
}

function withCors(response: Response) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseCollectionItemsSearch(url: URL) {
  const workspaceId = url.searchParams.get("w");
  const projectId = url.searchParams.get("p");
  const collectionId = url.searchParams.get("collection_id");
  const collectionSlug = url.searchParams.get("collection_slug");
  const environmentSlug = url.searchParams.get("env") ?? "";
  const { page, limit } = normalizePagination({
    page: Number(url.searchParams.get("page") ?? "1"),
    limit: Number(url.searchParams.get("limit") ?? "10"),
  });
  const query = url.searchParams.get("q")?.trim() ?? "";
  const rawFilters: Record<string, string> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (!key.startsWith("filter.")) {
      continue;
    }

    const fieldKey = key.slice("filter.".length).trim();

    if (fieldKey) {
      rawFilters[fieldKey] = value;
    }
  }

  return {
    workspaceId,
    projectId,
    collectionId,
    collectionSlug,
    page,
    limit,
    query,
    rawFilters,
    environmentSlug,
  };
}

function validateFilters(
  filters: Record<string, string>,
  schema: Array<{ key: string }>,
) {
  const allowedKeys = new Set(["_id", "_published", ...schema.map((field) => field.key)]);

  for (const key of Object.keys(filters)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown filter field: ${key}.`);
    }
  }

  return filters;
}

function buildCacheKey(input: {
  workspaceId: string;
  projectId: string;
  environmentId: string | null;
  collectionId: string;
  page: number;
  limit: number;
  query: string;
  filters: Record<string, string>;
}) {
  const filters = Object.keys(input.filters)
    .sort()
    .map((key) => `${key}=${input.filters[key]}`)
    .join("&");

  return [
    "public",
    input.workspaceId,
    input.projectId,
    input.environmentId ?? "__no_env__",
    input.collectionId,
    String(input.page),
    String(input.limit),
    input.query,
    filters,
  ].join(":");
}

function extractDomain(origin: string): string {
  if (!origin || origin === "unknown") return "unknown";
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}
