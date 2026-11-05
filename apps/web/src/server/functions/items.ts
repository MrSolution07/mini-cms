import {
  createItem,
  deleteItem,
  duplicateItemsToEnvironment,
  listItems,
  promoteItemsToProduction,
  reorderItems,
  updateItem,
  type CollectionItemData,
} from "@/db/queries/items";
import { invalidateCollectionCache } from "@/lib/cache";
import { ensureItemLimit } from "@/lib/demo-limits";
import {
  anonymizeServerValue,
  captureServerError,
  captureServerEvent,
  createAnonymousServerIdentity,
} from "@/lib/posthog";

export async function listItemsAction(
  collectionId: string,
  input?: { page?: number; limit?: number },
) {
  return listItems(collectionId, input);
}

export async function createItemAction(
  collectionId: string,
  slug: string,
  data: CollectionItemData,
  order?: number,
  organizationId?: string,
  environmentId?: string,
) {
  const identity = createAnonymousServerIdentity({ subject: collectionId });

  try {
    await ensureItemLimit(collectionId);
    const item = await createItem(collectionId, data, {
      order,
      organizationId,
      environmentId,
    });
    await invalidateCollectionCache(slug);

    await captureServerEvent({
      event: "item_created",
      identity,
      properties: {
        collection_slug_hash: anonymizeServerValue(slug, "collection"),
        field_count: Object.keys(data).length,
        has_explicit_order: order !== undefined,
      },
    });

    return item;
  } catch (error) {
    await captureServerError({
      error,
      identity,
      properties: {
        area: "items",
        operation: "create",
      },
    });
    throw error;
  }
}

export async function updateItemAction(
  id: string,
  slug: string,
  data: CollectionItemData,
  organizationId?: string,
) {
  const identity = createAnonymousServerIdentity({ subject: id });

  try {
    const item = await updateItem(id, data, organizationId);
    await invalidateCollectionCache(slug);

    await captureServerEvent({
      event: "item_updated",
      identity,
      properties: {
        collection_slug_hash: anonymizeServerValue(slug, "collection"),
        field_count: Object.keys(data).length,
      },
    });

    return item;
  } catch (error) {
    await captureServerError({
      error,
      identity,
      properties: {
        area: "items",
        operation: "update",
      },
    });
    throw error;
  }
}

export async function deleteItemAction(
  id: string,
  slug: string,
  organizationId?: string,
) {
  const identity = createAnonymousServerIdentity({ subject: id });

  try {
    await deleteItem(id, organizationId);
    await invalidateCollectionCache(slug);

    await captureServerEvent({
      event: "item_deleted",
      identity,
      properties: {
        collection_slug_hash: anonymizeServerValue(slug, "collection"),
      },
    });
  } catch (error) {
    await captureServerError({
      error,
      identity,
      properties: {
        area: "items",
        operation: "delete",
      },
    });
    throw error;
  }
}

/**
 * Promote items to the project's production environment.
 * Items are moved (environment_id updated) — they leave the current env.
 */
export async function promoteItemsAction(
  itemIds: string[],
  productionEnvironmentId: string,
  collectionSlug: string,
) {
  const identity = createAnonymousServerIdentity({
    subject: `promote:${productionEnvironmentId}`,
  });

  try {
    await promoteItemsToProduction(itemIds, productionEnvironmentId);
    await invalidateCollectionCache(collectionSlug, productionEnvironmentId);

    await captureServerEvent({
      event: "items_promoted",
      identity,
      properties: {
        item_count: itemIds.length,
        target_env_id: productionEnvironmentId,
        collection_slug_hash: anonymizeServerValue(collectionSlug, "collection"),
      },
    });

    return { success: true, promotedCount: itemIds.length };
  } catch (error) {
    await captureServerError({
      error,
      identity,
      properties: {
        area: "items",
        operation: "promote",
      },
    });
    throw error;
  }
}

/**
 * Duplicate items to another environment.
 * Items are copied (new IDs) — the originals remain in the source env.
 */
export async function duplicateItemsAction(
  itemIds: string[],
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
  collectionSlug: string,
) {
  const identity = createAnonymousServerIdentity({
    subject: `duplicate:${sourceEnvironmentId}->${targetEnvironmentId}`,
  });

  try {
    const newIds = await duplicateItemsToEnvironment(
      itemIds,
      sourceEnvironmentId,
      targetEnvironmentId,
    );

    await invalidateCollectionCache(collectionSlug, targetEnvironmentId);
    await invalidateCollectionCache(collectionSlug, sourceEnvironmentId);

    await captureServerEvent({
      event: "items_duplicated",
      identity,
      properties: {
        item_count: itemIds.length,
        source_env_id: sourceEnvironmentId,
        target_env_id: targetEnvironmentId,
        collection_slug_hash: anonymizeServerValue(collectionSlug, "collection"),
      },
    });

    return { success: true, duplicatedCount: itemIds.length, newIds };
  } catch (error) {
    await captureServerError({
      error,
      identity,
      properties: {
        area: "items",
        operation: "duplicate",
      },
    });
    throw error;
  }
}

export async function reorderItemsAction(
  collectionId: string,
  slug: string,
  itemIds: string[],
) {
  const identity = createAnonymousServerIdentity({ subject: collectionId });

  try {
    await reorderItems(collectionId, itemIds);
    await invalidateCollectionCache(slug);

    await captureServerEvent({
      event: "items_reordered",
      identity,
      properties: {
        collection_slug_hash: anonymizeServerValue(slug, "collection"),
        item_count: itemIds.length,
      },
    });
  } catch (error) {
    await captureServerError({
      error,
      identity,
      properties: {
        area: "items",
        operation: "reorder",
      },
    });
    throw error;
  }
}
