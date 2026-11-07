import { createServerFn } from "@tanstack/react-start";
import type { CollectionField } from "@/db/queries/collections";

export const createCollectionServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      projectId?: string;
      name: string;
      slug: string;
      description?: string;
      schema: CollectionField[];
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { getActiveProjectContext } = await import("./project-access");
    const { getDefaultProject, getProjectById } =
      await import("../db/queries/projects");
    const { createCollectionAction } =
      await import("../server/functions/collections");
    const { organizationId, access } = await getActiveProjectContext(ctx);
    let projectId = data.projectId;

    if (projectId) {
      const project = await getProjectById(projectId, organizationId);

      if (!project) {
        throw new Error("Project not found in this workspace.");
      }

      if (!access.all && !access.projectIds.includes(projectId)) {
        throw new Error("Forbidden: no access to this project");
      }
    } else if (!access.all) {
      projectId = (await getDefaultProject(organizationId, access))?.id;
      if (!projectId) {
        throw new Error("No project found for workspace.");
      }
    }

    return createCollectionAction({
      organizationId,
      projectId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      schema: data.schema,
    });
  });

export const updateCollectionServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      name?: string;
      slug?: string;
      description?: string | null;
      schema?: CollectionField[];
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { requireCollectionAccess } = await import("./project-access");
    const { updateCollectionAction } =
      await import("../server/functions/collections");
    const { organizationId } = await requireCollectionAccess(ctx, data.id);
    return updateCollectionAction(
      data.id,
      {
        name: data.name,
        slug: data.slug,
        description: data.description,
        schema: data.schema,
      },
      organizationId,
    );
  });

export const listCollectionsServerFn = createServerFn({ method: "GET" })
  .validator(
    (data: { page?: number; limit?: number; projectId?: string } | undefined) =>
      data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { getActiveProjectContext } = await import("./project-access");
    const { listCollections } = await import("../db/queries/collections");
    const { organizationId, access } = await getActiveProjectContext(ctx);

    if (
      data?.projectId &&
      !access.all &&
      !access.projectIds.includes(data.projectId)
    ) {
      throw new Error("Forbidden: no access to this project");
    }

    return listCollections({
      ...data,
      organizationId,
      projectIds: access.all ? undefined : access.projectIds,
    });
  });

export const getCollectionSchemaServerFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string; projectId?: string }) => data)
  .handler(async ({ data, ...ctx }) => {
    const { getActiveProjectContext } = await import("./project-access");
    const { getCollectionBySlug } = await import("../db/queries/collections");
    const { organizationId, access } = await getActiveProjectContext(ctx);

    if (
      data.projectId &&
      !access.all &&
      !access.projectIds.includes(data.projectId)
    ) {
      throw new Error("Forbidden: no access to this project");
    }

    const collection = await getCollectionBySlug(
      data.slug,
      organizationId,
      data.projectId,
      access.all ? undefined : access.projectIds,
    );

    if (!collection) {
      throw new Error("Collection not found");
    }

    return { collection };
  });

export const getCollectionPageServerFn = createServerFn({ method: "GET" })
  .validator(
    (data: {
      slug: string;
      page?: number;
      limit?: number;
      projectId?: string;
      env?: string;
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { getActiveProjectContext } = await import("./project-access");
    const [{ getCollectionBySlug }, { listItems }] = await Promise.all([
      import("../db/queries/collections"),
      import("../db/queries/items"),
    ]);

    const { organizationId, access } = await getActiveProjectContext(ctx);

    if (
      data.projectId &&
      !access.all &&
      !access.projectIds.includes(data.projectId)
    ) {
      throw new Error("Forbidden: no access to this project");
    }

    const collection = await getCollectionBySlug(
      data.slug,
      organizationId,
      data.projectId,
      access.all ? undefined : access.projectIds,
    );

    if (!collection) {
      throw new Error("Collection not found");
    }

    // Resolve environment slug → ID
    let environmentId: string | undefined;
    if (data.projectId && data.env) {
      const { getEnvironmentBySlug, getProductionEnvironment } =
        await import("../db/queries/environments");
      const env = data.env === "production"
        ? await getProductionEnvironment(data.projectId)
        : await getEnvironmentBySlug(data.env, data.projectId);
      if (env) {
        environmentId = env.id;
      }
    }

    const items = await listItems(collection.id, {
      page: data.page,
      limit: data.limit,
      environmentId,
    });

    return { collection, items, environment: environmentId ? undefined : undefined };
  });

async function resolveItemEnvironmentId(projectId: string, requestedId?: string) {
  const { getEnvironmentById, getProductionEnvironment } = await import(
    "../db/queries/environments"
  );

  if (requestedId) {
    const environment = await getEnvironmentById(requestedId);
    if (environment?.projectId === projectId) return environment.id;
  }

  const production = await getProductionEnvironment(projectId);
  return production?.id;
}

export const createItemServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      collectionId: string;
      slug: string;
      values: Record<string, string | number | boolean | null>;
      order?: number;
      environmentId?: string;
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { requireCollectionAccess } = await import("./project-access");
    const { createItemAction } = await import("../server/functions/items");
    const { collection, organizationId } = await requireCollectionAccess(
      ctx,
      data.collectionId,
    );
    const environmentId = await resolveItemEnvironmentId(
      collection.projectId,
      data.environmentId,
    );
    return createItemAction(
      data.collectionId,
      data.slug,
      data.values,
      data.order,
      organizationId,
      environmentId,
    );
  });

export const updateItemServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: string;
      slug: string;
      values: Record<string, string | number | boolean | null>;
      environmentId?: string;
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { requireItemAccess } = await import("./project-access");
    const { updateItemAction } = await import("../server/functions/items");
    const { item, projectId, organizationId } = await requireItemAccess(
      ctx,
      data.id,
    );
    const environmentId = item.environmentId
      ? undefined
      : await resolveItemEnvironmentId(projectId, data.environmentId);
    return updateItemAction(
      data.id,
      data.slug,
      data.values,
      organizationId,
      environmentId,
    );
  });

export const deleteItemServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; slug: string }) => data)
  .handler(async ({ data, ...ctx }) => {
    const { requireItemAccess } = await import("./project-access");
    const { deleteItemAction } = await import("../server/functions/items");
    const { organizationId } = await requireItemAccess(ctx, data.id);
    await deleteItemAction(data.id, data.slug, organizationId);
    return { success: true };
  });

export const promoteItemsServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      itemIds: string[];
      productionEnvironmentId: string;
      collectionSlug: string;
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { requireEnvironmentAccess, requireItemsInProject } = await import(
      "./project-access"
    );
    const { promoteItemsAction } = await import("../server/functions/items");
    const { environment } = await requireEnvironmentAccess(
      ctx,
      data.productionEnvironmentId,
    );
    await requireItemsInProject(ctx, data.itemIds, environment.projectId);

    return promoteItemsAction(
      data.itemIds,
      data.productionEnvironmentId,
      data.collectionSlug,
    );
  });

export const duplicateItemsServerFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      itemIds: string[];
      sourceEnvironmentId: string;
      targetEnvironmentId: string;
      collectionSlug: string;
    }) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    const { requireEnvironmentAccess, requireItemsInProject } = await import(
      "./project-access"
    );
    const { duplicateItemsAction } = await import("../server/functions/items");
    const { environment: source } = await requireEnvironmentAccess(
      ctx,
      data.sourceEnvironmentId,
    );
    const { environment: target } = await requireEnvironmentAccess(
      ctx,
      data.targetEnvironmentId,
    );

    if (source.projectId !== target.projectId) {
      throw new Error("Environments must belong to the same project");
    }

    await requireItemsInProject(ctx, data.itemIds, source.projectId);

    return duplicateItemsAction(
      data.itemIds,
      data.sourceEnvironmentId,
      data.targetEnvironmentId,
      data.collectionSlug,
    );
  });

export const deleteCollectionServerFn = createServerFn({ method: "POST" })
  .validator((data: { id: string; slug?: string }) => data)
  .handler(async ({ data, ...ctx }) => {
    const { requireCollectionAccess } = await import("./project-access");
    const { deleteCollectionAction } =
      await import("../server/functions/collections");
    const { organizationId } = await requireCollectionAccess(ctx, data.id);
    return deleteCollectionAction(data.id, data.slug, organizationId);
  });

export const getCollectionItemCountsServerFn = createServerFn({ method: "GET" })
  .validator(
    (data: { collectionIds: string[] } | undefined) => data,
  )
  .handler(async ({ data, ...ctx }) => {
    if (!data?.collectionIds?.length) return {};
    const { filterAccessibleCollectionIds } = await import("./project-access");
    const { countItemsByCollectionIds } = await import("../db/queries/items");
    const accessibleIds = await filterAccessibleCollectionIds(
      ctx,
      data.collectionIds,
    );

    if (accessibleIds.length === 0) {
      return {};
    }

    const counts = await countItemsByCollectionIds(accessibleIds);
    return Object.fromEntries(counts);
  });
