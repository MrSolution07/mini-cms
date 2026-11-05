import { createFileRoute } from "@tanstack/react-router";
import { getCollectionById } from "@/db/queries/collections";
import { listItems } from "@/db/queries/items";
import { resolveSchemaEnvironment } from "@/lib/schema-environment";
import { verifySchemaApiKey } from "@/lib/schema-sync";

const schemaCollectionItemsDeps = {
  verifySchemaApiKey,
  getCollectionById,
  listItems,
};

type SchemaCollectionItemsDeps = typeof schemaCollectionItemsDeps;

export async function handleSchemaCollectionItems(
  request: Request,
  deps: SchemaCollectionItemsDeps = schemaCollectionItemsDeps,
) {
  try {
    const auth = await deps.verifySchemaApiKey(request, "pull");
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const projectId = url.searchParams.get("projectId");
    const collectionId = url.searchParams.get("collectionId");
    const env = url.searchParams.get("env");
    const environmentId = url.searchParams.get("environmentId");
    const page = Number(url.searchParams.get("page") ?? "1");
    const limit = Number(url.searchParams.get("limit") ?? "100");

    if (!workspaceId || workspaceId !== auth.workspaceId) {
      return json(
        { error: "Workspace does not match the provided API key." },
        403,
      );
    }

    if (!collectionId) {
      return json({ error: "collectionId is required." }, 400);
    }

    if (auth.projectId && projectId && projectId !== auth.projectId) {
      return json(
        { error: "API key is restricted to a different project." },
        403,
      );
    }

    const effectiveProjectId = auth.projectId ?? projectId ?? undefined;

    const collection = await deps.getCollectionById(
      collectionId,
      workspaceId,
      effectiveProjectId,
    );

    if (!collection) {
      return json({ error: "Collection not found for workspace." }, 404);
    }

    const environment = await resolveSchemaEnvironment({
      projectId: collection.projectId,
      env,
      environmentId,
    });

    if ((env || environmentId) && !environment) {
      return json({ error: "Environment not found." }, 404);
    }

    const items = await deps.listItems(collectionId, {
      page,
      limit,
      environmentId: environment?.id,
    });

    return json({
      workspaceId,
      environment: environment
        ? {
            id: environment.id,
            slug: environment.slug,
            name: environment.name,
            isProduction: environment.isProduction,
          }
        : null,
      collection: {
        id: collection.id,
        name: collection.name,
        slug: collection.slug,
      },
      items: items.items.map((item) => ({
        id: item.id,
        data: item.data,
        order: item.order,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: items.pagination,
    });
  } catch (error) {
    return handleError(error);
  }
}

export const Route = createFileRoute("/api/schema/collection-items")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleSchemaCollectionItems(request),
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function handleError(error: unknown) {
  if (error instanceof Response) {
    return error;
  }

  return json(
    { error: error instanceof Error ? error.message : "Unexpected error." },
    500,
  );
}
