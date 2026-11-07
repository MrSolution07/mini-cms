import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { collectionItems, collections } from "@/db/schema";

/**
 * Loads an item only when its collection belongs to the workspace.
 *
 * A correlated EXISTS inside findFirst/update/delete fails on the hosted
 * libSQL database, so ownership is checked with a second query.
 */
async function itemInWorkspace(id: string, organizationId: string) {
  const item = await db.query.collectionItems.findFirst({
    where: eq(collectionItems.id, id),
  });

  if (!item) return null;

  const collection = await db.query.collections.findFirst({
    where: and(
      eq(collections.id, item.collectionId),
      eq(collections.organizationId, organizationId),
    ),
  });

  return collection ? item : null;
}
import {
  toStoredItemValues,
  withSystemItemValues,
} from "@/lib/collections-system-fields";
import {
  buildPagination,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from "./shared";

export type CollectionItemData = Record<
  string,
  string | number | boolean | null
>;

type CollectionItemFilterField = {
  key: string;
  type: "text" | "url" | "number" | "boolean" | "date";
};

export async function listItems(
  collectionId: string,
  input?: PaginationInput & {
    publishedOnly?: boolean;
    filters?: Record<string, string>;
    query?: string;
    schema?: CollectionItemFilterField[];
    environmentId?: string;
    includeUnassigned?: boolean;
  },
): Promise<PaginatedResult<typeof collectionItems.$inferSelect>> {
  const { limit, offset, page } = normalizePagination(input);
  const conditions = [eq(collectionItems.collectionId, collectionId)];

  // Filter by environment if specified; otherwise return items from all environments.
  // Production reads also keep rows with no environment. Those are legacy rows
  // and dashboard creates that were saved before an environment id was stored.
  if (input?.environmentId) {
    const matchesEnvironment = eq(collectionItems.environmentId, input.environmentId);
    if (input.includeUnassigned) {
      const unassigned = or(matchesEnvironment, isNull(collectionItems.environmentId));
      if (unassigned) conditions.push(unassigned);
    } else {
      conditions.push(matchesEnvironment);
    }
  }

  if (input?.publishedOnly) {
    conditions.push(
      sql`json_extract(${collectionItems.data}, '$._published') = 1`,
    );
  }

  const filterFields = new Map(
    (input?.schema ?? []).map((field) => [field.key, field.type]),
  );

  for (const [key, rawValue] of Object.entries(input?.filters ?? {})) {
    const normalizedValue = rawValue.trim();

    if (!normalizedValue) {
      continue;
    }

    const jsonPath = `$.${key}`;
    const fieldType = filterFields.get(key);

    if (fieldType === "number") {
      const numericValue = Number(normalizedValue);

      if (!Number.isNaN(numericValue)) {
        conditions.push(
          sql`json_extract(${collectionItems.data}, ${jsonPath}) = ${numericValue}`,
        );
      }

      continue;
    }

    if (fieldType === "boolean" || key === "_published") {
      const booleanValue = parseBooleanFilter(normalizedValue);

      if (booleanValue !== null) {
        conditions.push(
          sql`json_extract(${collectionItems.data}, ${jsonPath}) = ${booleanValue ? 1 : 0}`,
        );
      }

      continue;
    }

    conditions.push(
      sql`lower(CAST(json_extract(${collectionItems.data}, ${jsonPath}) AS text)) = lower(${normalizedValue})`,
    );
  }

  const query = input?.query?.trim();

  if (query) {
    const queryFields = ["_id", ...(input?.schema ?? []).map((field) => field.key)];
    const uniqueFields = Array.from(new Set(queryFields));

    if (uniqueFields.length) {
      const queryValue = `%${query.toLowerCase()}%`;
      const queryConditions = uniqueFields.map((key) => {
        const jsonPath = `$.${key}`;
        return sql`lower(COALESCE(CAST(json_extract(${collectionItems.data}, ${jsonPath}) AS text), '')) like ${queryValue}`;
      });

      const combinedQuery = or(...queryConditions);

      if (combinedQuery) {
        conditions.push(combinedQuery);
      }
    }
  }

  const where = and(...conditions);

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(collectionItems)
      .where(where)
      .orderBy(asc(collectionItems.order), asc(collectionItems.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(collectionItems)
      .where(where),
  ]);

  const total = totalResult[0]?.value ?? 0;

  return {
    items: items.map(withSystemItemValues),
    pagination: buildPagination(page, limit, total),
  };
}

function parseBooleanFilter(value: string) {
  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }

  return null;
}

export async function getItemById(id: string, organizationId?: string) {
  const item = organizationId
    ? await itemInWorkspace(id, organizationId)
    : await db.query.collectionItems.findFirst({
        where: eq(collectionItems.id, id),
      });

  return item ? withSystemItemValues(item) : null;
}

export async function createItem(
  collectionId: string,
  data: CollectionItemData,
  options?: {
    order?: number;
    environmentId?: string;
    organizationId?: string;
  },
) {
  const id = nanoid();
  const now = new Date().toISOString();

  if (options?.organizationId) {
    const { getCollectionById } = await import("./collections");
    const collection = await getCollectionById(
      collectionId,
      options.organizationId,
    );
    if (!collection) {
      throw new Error("Collection not found in this workspace.");
    }
  }

  await db.insert(collectionItems).values({
    id,
    collectionId,
    environmentId: options?.environmentId ?? null,
    data: toStoredItemValues(data),
    order: options?.order ?? 0,
    createdAt: now,
    updatedAt: now,
  });

  return getItemById(id, options?.organizationId);
}

export async function updateItem(
  id: string,
  data: CollectionItemData,
  organizationId?: string,
  environmentId?: string,
) {
  const existing = organizationId
    ? await itemInWorkspace(id, organizationId)
    : await db.query.collectionItems.findFirst({
        where: eq(collectionItems.id, id),
      });

  if (!existing) {
    return null;
  }

  await db
    .update(collectionItems)
    .set({
      data: toStoredItemValues(data, existing.data._published === true),
      ...(environmentId && !existing.environmentId ? { environmentId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(collectionItems.id, id));

  return getItemById(id, organizationId);
}

export async function deleteItem(id: string, organizationId?: string) {
  if (organizationId) {
    const existing = await itemInWorkspace(id, organizationId);
    if (!existing) return;
  }

  await db.delete(collectionItems).where(eq(collectionItems.id, id));
}

export async function countItemsByCollectionIds(
  collectionIds: string[],
  environmentId?: string,
) {
  if (collectionIds.length === 0) return new Map<string, number>();

  const conditions = [inArray(collectionItems.collectionId, collectionIds)];

  if (environmentId) {
    conditions.push(eq(collectionItems.environmentId, environmentId));
  }

  const results = await db
    .select({
      collectionId: collectionItems.collectionId,
      count: count(),
    })
    .from(collectionItems)
    .where(and(...conditions))
    .groupBy(collectionItems.collectionId);

  return new Map(results.map((r) => [r.collectionId, r.count]));
}

export async function reorderItems(collectionId: string, itemIds: string[]) {
  const items = await db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));

  const validIds = items
    .map((item) => item.id)
    .filter((id) => itemIds.includes(id));

  if (validIds.length === 0) return;

  const now = new Date().toISOString();
  const cases = validIds
    .map((id, index) => sql`WHEN ${id} THEN ${index}`)
    .reduce((acc, c, i) => (i === 0 ? c : sql`${acc} ${c}`), sql``);

  await db
    .update(collectionItems)
    .set({
      order: sql`CASE ${collectionItems.id} ${cases} ELSE ${collectionItems.order} END`,
      updatedAt: now,
    })
    .where(inArray(collectionItems.id, validIds));
}

/**
 * Promote items to the production environment.
 * Moves items from their current environment to the production environment.
 */
export async function promoteItemsToProduction(
  itemIds: string[],
  productionEnvironmentId: string,
) {
  if (itemIds.length === 0) return;

  const now = new Date().toISOString();

  // Batch update in chunks of 50
  const chunkSize = 50;
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    await db
      .update(collectionItems)
      .set({
        environmentId: productionEnvironmentId,
        updatedAt: now,
      })
      .where(inArray(collectionItems.id, chunk));
  }
}

/**
 * Duplicate items to another environment.
 * Creates copies of the specified items in the target environment.
 * The original items remain unchanged.
 */
export async function duplicateItemsToEnvironment(
  itemIds: string[],
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
) {
  if (itemIds.length === 0) return;

  const now = new Date().toISOString();

  // Fetch the original items
  const originals = await db
    .select()
    .from(collectionItems)
    .where(
      and(
        inArray(collectionItems.id, itemIds),
        eq(collectionItems.environmentId, sourceEnvironmentId),
      ),
    );

  if (originals.length === 0) return;

  // Insert copies with new IDs in the target environment
  const copies = originals.map((original) => ({
    id: nanoid(),
    collectionId: original.collectionId,
    environmentId: targetEnvironmentId,
    data: original.data,
    order: original.order,
    createdAt: now,
    updatedAt: now,
  }));

  // Insert in chunks of 50
  const chunkSize = 50;
  for (let i = 0; i < copies.length; i += chunkSize) {
    const chunk = copies.slice(i, i + chunkSize);
    await db.insert(collectionItems).values(chunk);
  }

  return copies.map((c) => c.id);
}
