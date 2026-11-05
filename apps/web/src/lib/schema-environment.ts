import type { Environment } from "@/db/schema/environments";
import {
  getEnvironmentById,
  getEnvironmentBySlug,
  getProductionEnvironment,
} from "@/db/queries/environments";

type ResolveSchemaEnvironmentInput = {
  projectId: string;
  env?: string | null;
  environmentId?: string | null;
};

/**
 * Resolves the content environment for schema API requests.
 *
 * `environmentId` wins over `env`; without either, the project's production
 * environment is used. Returns null when no environment exists so legacy
 * projects keep returning all items.
 */
export async function resolveSchemaEnvironment(
  input: ResolveSchemaEnvironmentInput,
): Promise<Environment | null> {
  if (input.environmentId) {
    const environment = await getEnvironmentById(input.environmentId);
    return environment?.projectId === input.projectId ? environment : null;
  }

  if (input.env && input.env !== "production") {
    return (await getEnvironmentBySlug(input.env, input.projectId)) ?? null;
  }

  return (await getProductionEnvironment(input.projectId)) ?? null;
}
