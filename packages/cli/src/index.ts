#!/usr/bin/env node

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import Table from "cli-table3";
import { defineCommand, renderUsage, runCommand } from "citty";
import {
  DEFAULT_BASE_URL,
  DEFAULT_CLIENT_PATH,
  DEFAULT_COLLECTIONS_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_DECLARATIONS_PATH,
  DEFAULT_SKILL_DIRECTORY,
  DEFAULT_TYPES_PATH,
} from "./constants";
import packageJson from "../package.json" with { type: "json" };
import {
  loadCollectionsInput as importedLoadCollectionsInput,
  normalizeCollections as importedNormalizeCollections,
} from "./collections";
import {
  toJsPropertyName as importedToJsPropertyName,
  toPascalCase as importedToPascalCase,
  toTsType as importedToTsType,
  writeClientFiles as importedWriteClientFiles,
  writeTypesFile as importedWriteTypesFile,
} from "./codegen";
import {
  normalizeBaseUrl as importedNormalizeBaseUrl,
  readError as importedReadError,
  readJsonFile as importedReadJsonFile,
  relativeSafe as importedRelativeSafe,
  writeJson as importedWriteJson,
} from "./file-utils";
import { installSkill as importedInstallSkill } from "./skill";

type FieldType = "text" | "url" | "number" | "boolean" | "date";

type CollectionField = {
  key: string;
  label: string;
  type: FieldType;
};

type SyncedCollection = {
  id?: string;
  name: string;
  slug: string;
  description: string | null;
  schema: CollectionField[];
};

type PullResponse = {
  workspaceId: string;
  pulledAt: string;
  collections: SyncedCollection[];
};

type PushResponse = {
  workspaceId: string;
  updatedAt: string;
  collections: SyncedCollection[];
};

type ListCollectionItemsResponse = {
  workspaceId: string;
  collection: {
    id: string;
    name: string;
    slug: string;
  };
  items: Array<{
    id: string;
    data: Record<string, string | number | boolean | null>;
    order: number;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
};

type ListProjectsResponse = {
  workspaceId: string;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    metadata?: Record<string, unknown>;
  }>;
};

type ListCollectionsResponse = {
  workspaceId: string;
  collections: Array<{
    id: string;
    name: string;
    slug: string;
    projectId: string;
    description: string | null;
    schema: CollectionField[];
  }>;
};

type AssetRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  filename: string;
  originalFilename: string;
  contentType: string;
  size: number;
  storageKey: string;
  publicUrl: string;
  status: "pending" | "active";
  uploadedById: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListAssetsResponse = {
  workspaceId: string;
  items: AssetRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
};

type GenerateResponse = {
  clientPath: string;
  declarationsPath: string;
};

type AddSkillResponse = {
  directoryPath: string;
  skillPath: string;
};

type AskQuestion = (question: string) => Promise<string>;

type ResolveConfigOptions = {
  requireApiKey?: boolean;
  requireProjectId?: boolean;
};

type EnvironmentConfig = {
  baseUrl?: string;
  workspaceId?: string;
  projectId?: string;
  environmentId?: string;
  apiKey?: string;
};

type MiniConfig = {
  baseUrl?: string;
  workspaceId?: string;
  projectId?: string;
  environmentId?: string;
  apiKey?: string;
  collectionId?: string;
  defaultEnv?: string;
  environments?: Record<string, EnvironmentConfig>;
  collectionsPath?: string;
  typesPath?: string;
  clientPath?: string;
  declarationsPath?: string;
};

type ResolvedConfig = {
  configPath: string;
  env: string;
  baseUrl: string;
  workspaceId: string;
  projectId?: string;
  environmentId?: string;
  apiKey: string;
  collectionId?: string;
  collectionsPath: string;
  typesPath: string;
  clientPath: string;
  declarationsPath: string;
};

type CommandOptions = {
  config?: string;
  env?: string;
  baseUrl?: string;
  workspaceId?: string;
  projectId?: string;
  environmentId?: string;
  apiKey?: string;
  collectionId?: string;
  collections?: string;
  itemsFile?: string;
  types?: string;
  client?: string;
  declarations?: string;
  page?: number;
  limit?: number;
  json?: boolean;
  verbose?: boolean;
};

type CliEnv = {
  env?: string;
  baseUrl?: string;
  workspaceId?: string;
  projectId?: string;
  environmentId?: string;
  apiKey?: string;
};

let isVerboseLoggingEnabled = false;

const CLI_ENV_KEYS = {
  env: "MINI_CMS_ENV",
  baseUrl: "MINI_CMS_BASE_URL",
  workspaceId: "MINI_CMS_WORKSPACE_ID",
  projectId: "MINI_CMS_PROJECT_ID",
  environmentId: "MINI_CMS_ENVIRONMENT_ID",
  apiKey: "MINI_CMS_API_KEY",
} as const;


const sharedArgs = {
  config: {
    type: "string",
    description: "Config file path",
    default: DEFAULT_CONFIG_PATH,
  },
  env: {
    type: "string",
    description: "Content environment slug (default: production)",
  },
  baseUrl: {
    type: "string",
    description: "Mini CMS base URL",
  },
  workspaceId: {
    type: "string",
    description: "Workspace ID",
  },
  projectId: {
    type: "string",
    description: "Project ID",
  },
  environmentId: {
    type: "string",
    description: "Environment ID",
  },
  apiKey: {
    type: "string",
    description: "API key",
  },
  collectionId: {
    type: "string",
    description: "Collection ID",
  },
  collections: {
    type: "string",
    description: "Collections file or directory",
  },
  types: {
    type: "string",
    description: "Generated TypeScript file path",
  },
  client: {
    type: "string",
    description: "Generated JavaScript client path",
  },
  declarations: {
    type: "string",
    description: "Generated declaration file path",
  },
  json: {
    type: "boolean",
    description: "Print raw JSON output",
  },
  verbose: {
    type: "boolean",
    description: "Enable verbose CLI logging",
  },
} as const;

const CLI_VERSION = packageJson.version;

const miniCmsCommand = defineCommand({
  meta: {
    name: "mini-cms",
    version: CLI_VERSION,
    description: "Mini CMS CLI",
  },
  subCommands: {
    init: defineCommand({
      meta: {
        name: "init",
        description: "Create mini.config.json with an interactive prompt",
      },
      args: {
        ...sharedArgs,
      },
      async run({ args }) {
        const options = toCommandOptions(args);
        const configPath = resolve(options.config ?? DEFAULT_CONFIG_PATH);
        const existingConfig = await readJsonFile<MiniConfig>(configPath, true) ?? {};
        const envConfig = readCliEnv();
        const directConfig = compactMiniConfig({
          baseUrl: options.baseUrl ?? existingConfig.baseUrl ?? envConfig.baseUrl,
          workspaceId:
            options.workspaceId ?? existingConfig.workspaceId ?? envConfig.workspaceId,
          projectId:
            options.projectId ?? existingConfig.projectId ?? envConfig.projectId,
          environmentId:
            options.environmentId ??
            existingConfig.environmentId ??
            envConfig.environmentId,
          apiKey: options.apiKey ?? existingConfig.apiKey ?? envConfig.apiKey,
          collectionId: options.collectionId ?? existingConfig.collectionId,
          defaultEnv: options.env ?? existingConfig.defaultEnv ?? "production",
          environments: existingConfig.environments,
          collectionsPath:
            options.collections ??
            existingConfig.collectionsPath ??
            DEFAULT_COLLECTIONS_PATH,
          typesPath:
            options.types ?? existingConfig.typesPath ?? DEFAULT_TYPES_PATH,
          clientPath:
            options.client ?? existingConfig.clientPath ?? DEFAULT_CLIENT_PATH,
          declarationsPath:
            options.declarations ??
            existingConfig.declarationsPath ??
            DEFAULT_DECLARATIONS_PATH,
        });
        const hasRequiredDirectValues = !!directConfig.baseUrl && !!directConfig.workspaceId;
        const hasRequiredProjectId = !!directConfig.projectId;
        const config = hasRequiredDirectValues && hasRequiredProjectId
          ? directConfig
          : await withPrompt((ask) => promptForMiniConfig(directConfig, ask));

        await writeJson(configPath, config);

        console.log(`Wrote ${relativeSafe(configPath)}.`);
        console.log("You can now run mini-cms pull.");
      },
    }),
    pull: defineCommand({
      meta: {
        name: "pull",
        description: "Pull all collection schemas and generate local files",
      },
      args: {
        ...sharedArgs,
      },
      async run({ args }) {
        const config = await resolveConfig(toCommandOptions(args), {
          requireProjectId: true,
        });
        const payload = await pullSchemas(config);

        await writeMiniConfig(config);
        const collectionsOutputPath = await writeCollectionsFile(
          config.collectionsPath,
          payload,
        );
        await writeTypesFile(
          config.typesPath,
          payload.collections,
          payload.workspaceId,
        );

        console.log(`Pulled ${payload.collections.length} collection(s).`);
        console.log(`Wrote ${relativeSafe(config.configPath)}.`);
        console.log(`Wrote ${relativeSafe(collectionsOutputPath)}.`);
        console.log(`Wrote ${relativeSafe(config.typesPath)}.`);
      },
    }),
    push: defineCommand({
      meta: {
        name: "push",
        description: "Push local collection definitions to the workspace",
      },
      args: {
        ...sharedArgs,
      },
      async run({ args }) {
        const config = await resolveConfig(toCommandOptions(args), {
          requireProjectId: true,
        });
        const collections = await loadCollectionsInput(
          config.collectionsPath,
          config.collectionId,
        );
        const payload = await pushSchemas(config, collections);

        console.log(`Pushed ${payload.collections.length} collection(s).`);
      },
    }),
    "list-projects": defineCommand({
      meta: {
        name: "list-projects",
        description: "List projects available to the API key",
      },
      args: {
        config: sharedArgs.config,
        env: sharedArgs.env,
        baseUrl: sharedArgs.baseUrl,
        workspaceId: sharedArgs.workspaceId,
        projectId: sharedArgs.projectId,
        apiKey: sharedArgs.apiKey,
        json: sharedArgs.json,
      },
      async run({ args }) {
        const config = await resolveConfig(toCommandOptions(args));
        const payload = await listProjects(config);

        if (!payload.projects.length) {
          console.log("No projects found.");
          return;
        }

        if (args.json === true) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        printTable(
          payload.projects.map((project) => ({
            id: project.id ?? "-",
            slug: project.slug,
            name: project.name,
          })),
        );
      },
    }),
    project: defineCommand({
      meta: {
        name: "project",
        description: "Manage projects",
      },
      subCommands: {
        create: defineCommand({
          meta: {
            name: "create",
            description: "Create a project",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            name: {
              type: "string",
              description: "Project name",
            },
            slug: {
              type: "string",
              description: "Project slug",
            },
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args));
            const name = getStringArg(args.name);
            const slug = getStringArg(args.slug);

            if (!name || !slug) {
              throw new Error("--name and --slug are required.");
            }

            const payload = await createProjectWithApi(config, { name, slug });
            console.log(JSON.stringify(payload, null, 2));
          },
        }),
        delete: defineCommand({
          meta: {
            name: "delete",
            description: "Delete a project by slug or id",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            apiKey: sharedArgs.apiKey,
            project: {
              type: "positional",
              description: "Project slug or id",
            },
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args));
            const project = getRequiredStringArg(args.project, "project");
            const resolvedProject = await resolveProjectIdentifier(config, project);
            const payload = await deleteProjectWithApi(config, resolvedProject.id);

            console.log(JSON.stringify(payload, null, 2));
          },
        }),
      },
    }),
    "list-collections": defineCommand({
      meta: {
        name: "list-collections",
        description: "List collections available to the API key",
      },
      args: {
        config: sharedArgs.config,
        env: sharedArgs.env,
        baseUrl: sharedArgs.baseUrl,
        workspaceId: sharedArgs.workspaceId,
        projectId: sharedArgs.projectId,
        apiKey: sharedArgs.apiKey,
        json: sharedArgs.json,
      },
      async run({ args }) {
        const config = await resolveConfig(toCommandOptions(args));
        const payload = await listCollectionsWithApi(config);

        if (!payload.collections.length) {
          console.log("No collections found.");
          return;
        }

        if (args.json === true) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        printTable(
          payload.collections.map((collection) => ({
            id: collection.id ?? "-",
            slug: collection.slug,
            name: collection.name,
            projectId: collection.projectId,
            description: collection.description ?? "",
          })),
        );
      },
    }),
    collection: defineCommand({
      meta: {
        name: "collection",
        description: "Manage collections and items",
      },
      subCommands: {
        create: defineCommand({
          meta: {
            name: "create",
            description: "Create a collection",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            name: {
              type: "string",
              description: "Collection name",
            },
            slug: {
              type: "string",
              description: "Collection slug",
            },
            description: {
              type: "string",
              description: "Collection description",
            },
            schema: {
              type: "string",
              description: "Schema JSON file path",
            },
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args));
            const name = getStringArg(args.name);
            const slug = getStringArg(args.slug);

            if (!name || !slug) {
              throw new Error("--name and --slug are required.");
            }

            const schemaPath = getStringArg(args.schema);
            const schema = schemaPath
              ? ((await readJsonFile<CollectionField[]>(resolve(schemaPath))) ?? [])
              : [];

            const payload = await createCollectionWithApi(config, {
              name,
              slug,
              description: getStringArg(args.description),
              schema,
            });

            console.log(JSON.stringify(payload, null, 2));
          },
        }),
        delete: defineCommand({
          meta: {
            name: "delete",
            description: "Delete a collection by slug or id",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            collection: {
              type: "positional",
              description: "Collection slug or id",
            },
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args));
            const collection = getRequiredStringArg(args.collection, "collection");
            const resolvedCollection = await resolveCollectionIdentifier(config, collection);
            const payload = await deleteCollectionWithApi(config, {
              id: resolvedCollection.id,
              slug: resolvedCollection.slug,
            });

            console.log(JSON.stringify(payload, null, 2));
          },
        }),
        item: defineCommand({
          meta: {
            name: "item",
            description: "Manage collection items",
          },
          subCommands: {
            list: defineCommand({
              meta: {
                name: "list",
                description: "List items in one collection",
              },
              args: {
                config: sharedArgs.config,
                env: sharedArgs.env,
                baseUrl: sharedArgs.baseUrl,
                workspaceId: sharedArgs.workspaceId,
                projectId: sharedArgs.projectId,
                apiKey: sharedArgs.apiKey,
                page: {
                  type: "string",
                  description: "Page number",
                  default: "1",
                },
                limit: {
                  type: "string",
                  description: "Items per page",
                  default: "100",
                },
                collection: {
                  type: "positional",
                  description: "Collection slug or id",
                },
                json: sharedArgs.json,
              },
              async run({ args }) {
                const config = await resolveConfig(toCommandOptions(args));
                const collection = getRequiredStringArg(args.collection, "collection");
                const resolvedCollection = await resolveCollectionIdentifier(config, collection);
                const payload = await listCollectionItems(config, {
                  collectionId: resolvedCollection.id,
                  projectId: config.projectId,
                  env: config.env,
                  page: getNumberArg(args.page) ?? 1,
                  limit: getNumberArg(args.limit) ?? 100,
                });

                if (args.json === true) {
                  console.log(JSON.stringify(payload, null, 2));
                  return;
                }

                if (!payload.items.length) {
                  console.log(`No items found in ${payload.collection.slug}.`);
                  return;
                }

                printTable(formatCollectionItemsTableRows(payload));
              },
            }),
            insert: defineCommand({
              meta: {
                name: "insert",
                description: "Insert an item into a collection",
              },
              args: {
                config: sharedArgs.config,
                env: sharedArgs.env,
                baseUrl: sharedArgs.baseUrl,
                workspaceId: sharedArgs.workspaceId,
                projectId: sharedArgs.projectId,
                apiKey: sharedArgs.apiKey,
                items: {
                  type: "string",
                  description: 'Item values like "field1=value;field2=value"',
                },
                itemsFile: {
                  type: "string",
                  description: "JSON file containing an array of item objects",
                },
                collection: {
                  type: "positional",
                  description: "Collection slug or id",
                },
              },
              async run({ args }) {
                const config = await resolveConfig(toCommandOptions(args));
                const collection = getRequiredStringArg(args.collection, "collection");
                const resolvedCollection = await resolveCollectionIdentifier(config, collection);
                const items = getStringArg(args.items);
                const itemsFile = getStringArg(args.itemsFile);

                if (!items && !itemsFile) {
                  const stdinPayload = await readItemsFromStdin();

                  if (!stdinPayload) {
                    throw new Error("--items, --items-file, or stdin JSON is required.");
                  }

                  const payload = await mutateCollectionItemWithApi(config, {
                    action: "insert",
                    collection: resolvedCollection.slug,
                    collectionId: resolvedCollection.id,
                    values: Array.isArray(stdinPayload) ? undefined : stdinPayload,
                    items: Array.isArray(stdinPayload) ? stdinPayload : undefined,
                  });

                  console.log(JSON.stringify(payload, null, 2));
                  return;
                }

                if (items && itemsFile) {
                  throw new Error("Use either --items or --items-file, not both.");
                }

                const batchItems = itemsFile
                  ? await readJsonFile<Array<Record<string, string | number | boolean | null>>>(
                      resolve(itemsFile),
                    ) ?? undefined
                  : undefined;

                const payload = await mutateCollectionItemWithApi(config, {
                  action: "insert",
                  collection: resolvedCollection.slug,
                  collectionId: resolvedCollection.id,
                  values: items ? parseKeyValueInput(items) : undefined,
                  items: batchItems,
                });

                console.log(JSON.stringify(payload, null, 2));
              },
            }),
            update: defineCommand({
              meta: {
                name: "update",
                description: "Update an item in a collection",
              },
              args: {
                config: sharedArgs.config,
                env: sharedArgs.env,
                baseUrl: sharedArgs.baseUrl,
                workspaceId: sharedArgs.workspaceId,
                projectId: sharedArgs.projectId,
                apiKey: sharedArgs.apiKey,
                id: {
                  type: "string",
                  description: "Item ID",
                },
                value: {
                  type: "string",
                  description: 'Updated values like "field1=value;field2=value"',
                },
                merge: {
                  type: "boolean",
                  description: "Merge provided fields into the existing item data",
                },
                collection: {
                  type: "positional",
                  description: "Collection slug or id",
                },
              },
              async run({ args }) {
                const config = await resolveConfig(toCommandOptions(args));
                const collection = getRequiredStringArg(args.collection, "collection");
                const resolvedCollection = await resolveCollectionIdentifier(config, collection);
                const id = getStringArg(args.id);
                const value = getStringArg(args.value);

                if (!id || !value) {
                  throw new Error("--id and --value are required.");
                }

                const payload = await mutateCollectionItemWithApi(config, {
                  action: "update",
                  collection: resolvedCollection.slug,
                  collectionId: resolvedCollection.id,
                  itemId: id,
                  values: parseKeyValueInput(value),
                  merge: args.merge === true,
                });

                console.log(JSON.stringify(payload, null, 2));
              },
            }),
            delete: defineCommand({
              meta: {
                name: "delete",
                description: "Delete an item from a collection",
              },
              args: {
                config: sharedArgs.config,
                env: sharedArgs.env,
                baseUrl: sharedArgs.baseUrl,
                workspaceId: sharedArgs.workspaceId,
                projectId: sharedArgs.projectId,
                apiKey: sharedArgs.apiKey,
                id: {
                  type: "string",
                  description: "Item ID",
                },
                collection: {
                  type: "positional",
                  description: "Collection slug or id",
                },
              },
              async run({ args }) {
                const config = await resolveConfig(toCommandOptions(args));
                const collection = getRequiredStringArg(args.collection, "collection");
                const resolvedCollection = await resolveCollectionIdentifier(config, collection);
                const id = getStringArg(args.id);

                if (!id) {
                  throw new Error("--id is required.");
                }

                const payload = await mutateCollectionItemWithApi(config, {
                  action: "delete",
                  collection: resolvedCollection.slug,
                  collectionId: resolvedCollection.id,
                  itemId: id,
                });

                console.log(JSON.stringify(payload, null, 2));
              },
            }),
          },
        }),
      },
    }),
    items: defineCommand({
      meta: {
        name: "items",
        description: "Pull and push collection item data",
      },
      subCommands: {
        pull: defineCommand({
          meta: {
            name: "pull",
            description: "Download items into mini/items/<env>/<slug>.json",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            collection: {
              type: "string",
              description: "Only pull one collection slug or id",
            },
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args), {
              requireProjectId: true,
            });
            await pullItems(config, {
              collection: getStringArg(args.collection),
            });
          },
        }),
        push: defineCommand({
          meta: {
            name: "push",
            description: "Upload items from mini/items/<env>/<slug>.json",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            collection: {
              type: "string",
              description: "Only push one collection slug",
            },
            dryRun: {
              type: "boolean",
              description: "Print what would change without writing",
            },
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args), {
              requireProjectId: true,
            });
            await pushItems(config, {
              collection: getStringArg(args.collection),
              dryRun: args.dryRun === true,
            });
          },
        }),
      },
    }),
    asset: defineCommand({
      meta: {
        name: "asset",
        description: "Manage project assets",
      },
      subCommands: {
        list: defineCommand({
          meta: {
            name: "list",
            description: "List assets in the current project",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            page: {
              type: "string",
              description: "Page number",
              default: "1",
            },
            limit: {
              type: "string",
              description: "Assets per page",
              default: "100",
            },
            json: sharedArgs.json,
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args), {
              requireProjectId: true,
            });

            const payload = await listAssetsWithApi(config, {
              page: getNumberArg(args.page) ?? 1,
              limit: getNumberArg(args.limit) ?? 100,
              projectId: config.projectId,
            });

            if (args.json === true) {
              console.log(JSON.stringify(payload, null, 2));
              return;
            }

            if (!payload.items.length) {
              console.log("No assets found.");
              return;
            }

            printTable(
              payload.items.map((asset) => ({
                id: asset.id,
                filename: asset.filename,
                contentType: asset.contentType,
                size: asset.size,
                status: asset.status,
                createdAt: asset.createdAt,
              })),
            );
          },
        }),
        upload: defineCommand({
          meta: {
            name: "upload",
            description: "Upload an asset file",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            file: {
              type: "positional",
              description: "Path to the file to upload",
            },
            json: sharedArgs.json,
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args), {
              requireProjectId: true,
            });
            const filePath = getRequiredStringArg(args.file, "file");
            const file = Bun.file(resolve(filePath));
            const exists = await file.exists();

            if (!exists) {
              throw new Error(`File not found: ${filePath}`);
            }

            const body = await file.arrayBuffer();
            const filename = filePath.split("/").at(-1) ?? "file";
            const contentType = file.type || inferContentType(filename);
            const size = body.byteLength;

            const requested = await requestAssetUploadWithApi(config, {
              projectId: config.projectId!,
              filename,
              contentType,
              size,
            });

            const uploadResponse = await fetch(requested.uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": contentType,
              },
              body,
            });

            if (!uploadResponse.ok) {
              throw new Error(`Upload failed with status ${uploadResponse.status}.`);
            }

            const payload = await confirmAssetUploadWithApi(config, {
              assetId: requested.assetId,
            });

            console.log(JSON.stringify(args.json === true ? payload : payload.asset, null, 2));
          },
        }),
        info: defineCommand({
          meta: {
            name: "info",
            description: "Get asset metadata",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            id: {
              type: "positional",
              description: "Asset ID",
            },
            json: sharedArgs.json,
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args));
            const id = getRequiredStringArg(args.id, "id");
            const payload = await getAssetInfoWithApi(config, { assetId: id });

            console.log(JSON.stringify(args.json === true ? payload : payload.asset, null, 2));
          },
        }),
        delete: defineCommand({
          meta: {
            name: "delete",
            description: "Delete an asset",
          },
          args: {
            config: sharedArgs.config,
            env: sharedArgs.env,
            baseUrl: sharedArgs.baseUrl,
            workspaceId: sharedArgs.workspaceId,
            projectId: sharedArgs.projectId,
            apiKey: sharedArgs.apiKey,
            id: {
              type: "positional",
              description: "Asset ID",
            },
            json: sharedArgs.json,
          },
          async run({ args }) {
            const config = await resolveConfig(toCommandOptions(args));
            const id = getRequiredStringArg(args.id, "id");
            const payload = await deleteAssetWithApi(config, { assetId: id });

            console.log(JSON.stringify(payload, null, 2));
          },
        }),
      },
    }),
    generate: defineCommand({
      meta: {
        name: "generate",
        description: "Generate a fetch-based browser client and typings",
      },
      args: {
        config: sharedArgs.config,
        env: sharedArgs.env,
        baseUrl: sharedArgs.baseUrl,
        workspaceId: sharedArgs.workspaceId,
        projectId: sharedArgs.projectId,
        collectionId: sharedArgs.collectionId,
        collections: sharedArgs.collections,
        types: sharedArgs.types,
        client: sharedArgs.client,
        declarations: sharedArgs.declarations,
      },
      async run({ args }) {
        const config = await resolveConfig(toCommandOptions(args), {
          requireApiKey: false,
        });
        const collections = await loadCollectionsInput(
          config.collectionsPath,
          config.collectionId,
        );

        await writeMiniConfig(config);
        await writeTypesFile(config.typesPath, collections, config.workspaceId);
        const output = await writeClientFiles(config, collections);

        console.log(`Generated ${relativeSafe(output.clientPath)}.`);
        console.log(`Generated ${relativeSafe(output.declarationsPath)}.`);
      },
    }),
    "add-skill": defineCommand({
      meta: {
        name: "add-skill",
        description: "Install the Mini CMS CLI skill into the current project",
      },
      async run() {
        const output = await installSkill(process.cwd());

        console.log(`Installed skill in ${relativeSafe(output.directoryPath)}.`);
        console.log(`Wrote ${relativeSafe(output.skillPath)}.`);
      },
    }),
  },
});

const commandSpecs = [
  { words: ["init"], usage: "init", requiredArgs: 0 },
  { words: ["pull"], usage: "pull", requiredArgs: 0 },
  { words: ["push"], usage: "push", requiredArgs: 0 },
  { words: ["list-projects"], usage: "list-projects", requiredArgs: 0 },
  { words: ["project", "create"], usage: "project create", requiredArgs: 0 },
  {
    words: ["project", "delete"],
    usage: "project delete <project>",
    requiredArgs: 1,
  },
  {
    words: ["list-collections"],
    usage: "list-collections",
    requiredArgs: 0,
  },
  {
    words: ["collection", "create"],
    usage: "collection create",
    requiredArgs: 0,
  },
  {
    words: ["collection", "delete"],
    usage: "collection delete <collection>",
    requiredArgs: 1,
  },
  {
    words: ["collection", "item", "list"],
    usage: "collection item list <collection>",
    requiredArgs: 1,
  },
  {
    words: ["collection", "item", "insert"],
    usage: "collection item insert <collection>",
    requiredArgs: 1,
  },
  {
    words: ["collection", "item", "update"],
    usage: "collection item update <collection>",
    requiredArgs: 1,
  },
  {
    words: ["collection", "item", "delete"],
    usage: "collection item delete <collection>",
    requiredArgs: 1,
  },
  { words: ["asset", "list"], usage: "asset list", requiredArgs: 0 },
  { words: ["asset", "upload"], usage: "asset upload <file>", requiredArgs: 1 },
  { words: ["asset", "info"], usage: "asset info <id>", requiredArgs: 1 },
  { words: ["asset", "delete"], usage: "asset delete <id>", requiredArgs: 1 },
  { words: ["generate"], usage: "generate", requiredArgs: 0 },
  { words: ["add-skill"], usage: "add-skill", requiredArgs: 0 },
] as const;

export async function run(argv = process.argv): Promise<void> {
  try {
    const rawArgs = argv.slice(2);
    isVerboseLoggingEnabled = rawArgs.includes("--verbose");

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      const [command, parent] = resolveUsageCommand(miniCmsCommand, rawArgs);
      console.log(await renderUsage(command, parent));
      return;
    }

    if (rawArgs.length === 1 && rawArgs[0] === "--version") {
      console.log(CLI_VERSION);
      return;
    }

    const incompleteCommandError = getIncompleteCommandError(argv);

    if (incompleteCommandError) {
      throw new Error(incompleteCommandError);
    }

    await runCommand(miniCmsCommand, { rawArgs });
    return;
  } catch (error) {
    throw formatCliError(error, argv);
  }
}

if (import.meta.main) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}

function formatCliError(error: unknown, argv: string[]): Error {
  if (error instanceof Error) {
    return new Error(toFriendlyCommandError(error.message, argv));
  }

  return new Error("Unexpected error.");
}

function toFriendlyCommandError(message: string, argv: string[]) {
  const input = argv.slice(2).join(" ").trim();

  if (message.includes("Unused args:")) {
    const suggestion = suggestCommand(input);

    return suggestion
      ? `Unknown command usage: ${input}. Did you mean \`${suggestion}\`?`
      : `Unknown command usage: ${input}. Run \`mini-cms --help\` to see available commands.`;
  }

  if (message.includes("Unknown option")) {
    return `${message}. Run \`mini-cms --help\` to see available commands.`;
  }

  if (message.includes("missing required args")) {
    return `${message}. Run \`mini-cms --help\` to see available commands.`;
  }

  return message;
}

function suggestCommand(input: string) {
  const normalized = input.trim().replace(/\s+/g, " ");
  const suggestions: Array<[string, string]> = [
    ["push list-collections", "list-collections"],
    ["push list-projects", "list-projects"],
    ["collection list", "list-collections"],
    ["project list", "list-projects"],
    ["collection testimonials list", "collection item list testimonials"],
  ];

  return suggestions.find(([wrong]) => wrong === normalized)?.[1] ?? null;
}

function getIncompleteCommandError(argv: string[]) {
  const inputTokens = getLeadingCommandTokens(argv.slice(2));

  if (!inputTokens.length) {
    return null;
  }

  const exactMatch = commandSpecs.find(
    (spec) =>
      inputTokens.length >= spec.words.length &&
      spec.words.every((word, index) => inputTokens[index] === word),
  );

  if (exactMatch) {
    const providedArgs = inputTokens.length - exactMatch.words.length;

    if (providedArgs < exactMatch.requiredArgs) {
      return `Incomplete command: ${inputTokens.join(" ")}. Usage: \`mini-cms ${exactMatch.usage}\`.`;
    }

    return null;
  }

  const matchingSpecs = commandSpecs.filter((spec) =>
    inputTokens.every((token, index) => spec.words[index] === token),
  );

  if (!matchingSpecs.length) {
    return null;
  }

  const suggestions = matchingSpecs
    .map((spec) => `\`${spec.usage}\``)
    .filter((usage, index, list) => list.indexOf(usage) === index)
    .slice(0, 3);

  if (!suggestions.length) {
    return `Incomplete command: ${inputTokens.join(" ")}. Run \`mini-cms --help\` to see available commands.`;
  }

  return `Incomplete command: ${inputTokens.join(" ")}. Try ${joinWithOr(suggestions)}.`;
}

function getLeadingCommandTokens(args: string[]) {
  const tokens: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("-")) {
      break;
    }

    tokens.push(arg);
  }

  return tokens;
}

function joinWithOr(values: string[]) {
  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} or ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function resolveUsageCommand(
  command: typeof miniCmsCommand,
  rawArgs: string[],
  parent?: typeof miniCmsCommand,
): [typeof miniCmsCommand, typeof miniCmsCommand | undefined] {
  const subCommands = command.subCommands;

  if (!subCommands) {
    return [command, parent];
  }

  const subCommandArgIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));

  if (subCommandArgIndex < 0) {
    return [command, parent];
  }

  const subCommandName = rawArgs[subCommandArgIndex];

  if (!subCommandName || !(subCommandName in subCommands)) {
    return [command, parent];
  }

  const nextCommand = subCommands[subCommandName as keyof typeof subCommands];

  return resolveUsageCommand(
    nextCommand as typeof miniCmsCommand,
    rawArgs.slice(subCommandArgIndex + 1),
    command,
  );
}

function getStringArg(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getRequiredStringArg(value: unknown, name: string) {
  const normalized = getStringArg(value);

  if (!normalized) {
    throw new Error(`${name} is required.`);
  }

  return normalized;
}

function getNumberArg(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function toCommandOptions(args: Record<string, unknown>): CommandOptions {
  return {
    config: getStringArg(args.config),
    env: getStringArg(args.env),
    baseUrl: getStringArg(args.baseUrl),
    workspaceId: getStringArg(args.workspaceId),
    projectId: getStringArg(args.projectId),
    environmentId: getStringArg(args.environmentId),
    apiKey: getStringArg(args.apiKey),
    collectionId: getStringArg(args.collectionId),
    collections: getStringArg(args.collections),
    itemsFile: getStringArg(args.itemsFile),
    types: getStringArg(args.types),
    client: getStringArg(args.client),
    declarations: getStringArg(args.declarations),
    page: getNumberArg(args.page),
    limit: getNumberArg(args.limit),
    json: args.json === true,
    verbose: args.verbose === true,
  };
}

function formatCollectionItemsTableRows(payload: ListCollectionItemsResponse): Array<Record<string, unknown>> {
  const fieldKeys = collectItemFieldKeys(payload.items);

  return payload.items.map((item) => ({
    id: item.id,
    order: item.order,
    ...Object.fromEntries(
      fieldKeys.map((fieldKey) => [fieldKey, formatTableValue(item.data[fieldKey])]),
    ),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

function collectItemFieldKeys(items: ListCollectionItemsResponse["items"]): string[] {
  const keys: string[] = [];

  for (const item of items) {
    for (const key of Object.keys(item.data)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }

  return keys;
}

function printTable(rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    return;
  }

  const columns = selectVisibleTableColumns(rows, Object.keys(rows[0]));

  if (!columns.length) {
    return;
  }

  console.log(renderTable(rows, columns));
}

function formatTableValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function renderTable(rows: Array<Record<string, unknown>>, columns: string[]) {
  const table = new Table({
    head: columns,
    style: {
      head: [],
      border: [],
      compact: false,
    },
    chars: {
      top: "-",
      "top-mid": "+",
      "top-left": "+",
      "top-right": "+",
      bottom: "-",
      "bottom-mid": "+",
      "bottom-left": "+",
      "bottom-right": "+",
      left: "|",
      "left-mid": "+",
      mid: "-",
      "mid-mid": "+",
      right: "|",
      "right-mid": "+",
      middle: "|",
    },
    colWidths: columns.map((column) => getColumnWidth(rows, column)),
    wordWrap: false,
  });

  table.push(
    ...rows.map((row) => columns.map((column) => formatTableValue(row[column]))),
  );

  return table.toString();
}

function selectVisibleTableColumns(
  rows: Array<Record<string, unknown>>,
  columns: string[],
) {
  const maxWidth = getTerminalWidth();
  const visibleColumns: string[] = [];

  for (const column of columns) {
    const nextColumns = [...visibleColumns, column];
    const preview = renderTable(rows, nextColumns);
    const previewWidth = Math.max(...preview.split("\n").map((line) => line.length));

    if (previewWidth <= maxWidth || visibleColumns.length === 0) {
      visibleColumns.push(column);
    }
  }

  return visibleColumns;
}

function getColumnWidth(rows: Array<Record<string, unknown>>, column: string) {
  return Math.max(
    column.length,
    ...rows.map((row) => formatTableValue(row[column]).length),
  ) + 2;
}

function getTerminalWidth() {
  return typeof process.stdout.columns === "number" && process.stdout.columns > 0
    ? process.stdout.columns
    : 120;
}

function logVerbose(message: string, details?: unknown) {
  if (!isVerboseLoggingEnabled) {
    return;
  }

  if (details === undefined) {
    console.error(`[mini-cms] ${message}`);
    return;
  }

  console.error(`[mini-cms] ${message}`, details);
}

async function resolveConfig(
  options: CommandOptions,
  resolveOptions: ResolveConfigOptions = {},
): Promise<ResolvedConfig> {
  const configPath = resolve(options.config ?? DEFAULT_CONFIG_PATH);
  const fileConfig = await readJsonFile<MiniConfig>(configPath, true);
  const envConfig = readCliEnv();
  const env =
    options.env ??
    envConfig.env ??
    fileConfig?.defaultEnv ??
    "production";
  const envBlock = fileConfig?.environments?.[env] ?? {};

  const baseUrl =
    options.baseUrl ??
    envBlock.baseUrl ??
    fileConfig?.baseUrl ??
    envConfig.baseUrl ??
    DEFAULT_BASE_URL;
  const workspaceId =
    options.workspaceId ??
    envBlock.workspaceId ??
    fileConfig?.workspaceId ??
    envConfig.workspaceId ??
    "";
  const projectId =
    options.projectId ??
    envBlock.projectId ??
    fileConfig?.projectId ??
    envConfig.projectId;
  const environmentId =
    options.environmentId ??
    envBlock.environmentId ??
    fileConfig?.environmentId ??
    envConfig.environmentId;
  const apiKey =
    options.apiKey ??
    envBlock.apiKey ??
    fileConfig?.apiKey ??
    envConfig.apiKey ??
    "";
  const collectionId = options.collectionId ?? fileConfig?.collectionId;
  const collectionsPath = resolve(
    options.collections ??
      fileConfig?.collectionsPath ??
      DEFAULT_COLLECTIONS_PATH,
  );
  const typesPath = resolve(
    options.types ?? fileConfig?.typesPath ?? DEFAULT_TYPES_PATH,
  );
  const clientPath = resolve(
    options.client ?? fileConfig?.clientPath ?? DEFAULT_CLIENT_PATH,
  );
  const declarationsPath = resolve(
    options.declarations ??
      fileConfig?.declarationsPath ??
      DEFAULT_DECLARATIONS_PATH,
  );

  if (!baseUrl || !workspaceId || ((resolveOptions.requireApiKey ?? true) && !apiKey)) {
    throw new Error(
      (resolveOptions.requireApiKey ?? true)
        ? "Missing required values. Provide --base-url, --workspace-id, and --api-key, define them in mini.config.json, or set MINI_CMS_BASE_URL, MINI_CMS_WORKSPACE_ID, and MINI_CMS_API_KEY."
        : "Missing required values. Provide --base-url and --workspace-id, define them in mini.config.json, or set MINI_CMS_BASE_URL and MINI_CMS_WORKSPACE_ID.",
    );
  }

  if (resolveOptions.requireProjectId && !projectId) {
    throw new Error(
      "Missing required projectId. Provide --project-id, define projectId in mini.config.json, or set MINI_CMS_PROJECT_ID.",
    );
  }

  return {
    configPath,
    env,
    baseUrl,
    workspaceId,
    projectId,
    environmentId,
    apiKey,
    collectionId,
    collectionsPath,
    typesPath,
    clientPath,
    declarationsPath,
  };
}

function readCliEnv(): CliEnv {
  return {
    env: readEnvValue(CLI_ENV_KEYS.env),
    baseUrl: readEnvValue(CLI_ENV_KEYS.baseUrl),
    workspaceId: readEnvValue(CLI_ENV_KEYS.workspaceId),
    projectId: readEnvValue(CLI_ENV_KEYS.projectId),
    environmentId: readEnvValue(CLI_ENV_KEYS.environmentId),
    apiKey: readEnvValue(CLI_ENV_KEYS.apiKey),
  };
}

function readEnvValue(key: string) {
  const value = process.env[key];

  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

async function pullSchemas(config: ResolvedConfig): Promise<PullResponse> {
  const url = new URL("/api/schema/pull", normalizeBaseUrl(config.baseUrl));
  url.searchParams.set("workspaceId", config.workspaceId);
  url.searchParams.set("projectId", config.projectId ?? "");

  if (config.environmentId) {
    url.searchParams.set("environmentId", config.environmentId);
  }

  if (config.collectionId) {
    url.searchParams.set("collectionId", config.collectionId);
  }

  const response = await fetch(url, {
    headers: {
      "x-api-key": config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as PullResponse;
}

async function pushSchemas(
  config: ResolvedConfig,
  collections: SyncedCollection[],
): Promise<PushResponse> {
  const response = await fetch(
    new URL("/api/schema/push", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        projectId: config.projectId,
        environmentId: config.environmentId,
        collectionId: config.collectionId,
        collections,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as PushResponse;
}

async function listCollectionItems(
  config: ResolvedConfig,
  input: {
    collectionId: string;
    projectId?: string;
    env?: string;
    page: number;
    limit: number;
  },
) {
  const url = new URL(
    "/api/schema/collection-items",
    normalizeBaseUrl(config.baseUrl),
  );
  url.searchParams.set("workspaceId", config.workspaceId);
  url.searchParams.set("collectionId", input.collectionId);
  url.searchParams.set("env", input.env ?? config.env);
  if (input.projectId) {
    url.searchParams.set("projectId", input.projectId);
  }
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("limit", String(input.limit));

  logVerbose("GET /api/schema/collection-items", {
    url: url.toString(),
    workspaceId: config.workspaceId,
    projectId: input.projectId,
    collectionId: input.collectionId,
    page: input.page,
    limit: input.limit,
  });

  const response = await fetch(url, {
    headers: {
      "x-api-key": config.apiKey,
    },
  });

  logVerbose("collection-items response", {
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const payload = (await response.json()) as ListCollectionItemsResponse;
  logVerbose("collection-items payload summary", {
    collection: payload.collection,
    itemCount: payload.items.length,
    pagination: payload.pagination,
  });

  return payload;
}

type ItemFileEntry = {
  id?: string;
  order?: number;
  data: Record<string, string | number | boolean | null>;
};

const DEFAULT_ITEMS_DIRECTORY = "mini/items";

async function listAllCollectionItems(
  config: ResolvedConfig,
  collectionId: string,
): Promise<ItemFileEntry[]> {
  const limit = 500;
  const items: ItemFileEntry[] = [];
  let page = 1;

  while (true) {
    const payload = await listCollectionItems(config, {
      collectionId,
      projectId: config.projectId,
      env: config.env,
      page,
      limit,
    });

    items.push(
      ...payload.items.map((item) => ({
        id: item.id,
        order: item.order,
        data: item.data,
      })),
    );

    if (!payload.pagination.hasMore) {
      break;
    }

    page += 1;
  }

  return items;
}

async function pullItems(
  config: ResolvedConfig,
  input: { collection?: string },
) {
  const payload = await pullSchemas(config);
  const collections = input.collection
    ? payload.collections.filter(
        (collection) =>
          collection.slug === input.collection ||
          collection.id === input.collection,
      )
    : payload.collections;

  if (input.collection && collections.length === 0) {
    throw new Error(`Collection not found: ${input.collection}`);
  }

  const directory = resolve(DEFAULT_ITEMS_DIRECTORY, config.env);

  for (const collection of collections) {
    if (!collection.id) {
      continue;
    }

    const items = await listAllCollectionItems(config, collection.id);
    const filePath = join(directory, `${collection.slug}.json`);
    await writeJson(filePath, items);
    console.log(`Wrote ${relativeSafe(filePath)} (${items.length} item(s)).`);
  }
}

async function pushItems(
  config: ResolvedConfig,
  input: { collection?: string; dryRun?: boolean },
) {
  const directory = resolve(DEFAULT_ITEMS_DIRECTORY, config.env);
  const entries = await readdir(directory).catch((error: unknown) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  });

  const files = entries
    .filter((entry) => entry.endsWith(".json"))
    .filter(
      (entry) => !input.collection || entry === `${input.collection}.json`,
    );

  if (files.length === 0) {
    throw new Error(
      `No item files found in ${relativeSafe(directory)}. Run "mini-cms items pull" first.`,
    );
  }

  for (const file of files) {
    const slug = file.slice(0, -".json".length);
    const items =
      (await readJsonFile<ItemFileEntry[]>(join(directory, file))) ?? [];
    const collection = await resolveCollectionIdentifier(config, slug);

    let created = 0;
    let updated = 0;

    for (const item of items) {
      if (input.dryRun) {
        if (item.id) {
          updated += 1;
        } else {
          created += 1;
        }
        continue;
      }

      if (item.id) {
        await mutateCollectionItemWithApi(config, {
          action: "update",
          collection: collection.slug,
          collectionId: collection.id,
          itemId: item.id,
          values: item.data,
          merge: false,
        });
        updated += 1;
      } else {
        await mutateCollectionItemWithApi(config, {
          action: "insert",
          collection: collection.slug,
          collectionId: collection.id,
          values: item.data,
          order: item.order,
        });
        created += 1;
      }
    }

    console.log(
      `${input.dryRun ? "Would sync" : "Synced"} ${collection.slug}: ${created} insert(s), ${updated} update(s).`,
    );
  }
}

async function listProjects(config: ResolvedConfig) {
  const url = new URL("/api/schema/projects", normalizeBaseUrl(config.baseUrl));
  url.searchParams.set("workspaceId", config.workspaceId);

  const response = await fetch(url, {
    headers: {
      "x-api-key": config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ListProjectsResponse;
}

async function createProjectWithApi(
  config: ResolvedConfig,
  input: { name: string; slug: string },
) {
  const response = await fetch(
    new URL("/api/schema/projects", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "create",
        workspaceId: config.workspaceId,
        name: input.name,
        slug: input.slug,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function deleteProjectWithApi(config: ResolvedConfig, projectId: string) {
  const response = await fetch(
    new URL("/api/schema/projects", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "delete",
        workspaceId: config.workspaceId,
        id: projectId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function listCollectionsWithApi(config: ResolvedConfig) {
  const url = new URL("/api/schema/collections", normalizeBaseUrl(config.baseUrl));
  url.searchParams.set("workspaceId", config.workspaceId);

  if (config.projectId) {
    url.searchParams.set("projectId", config.projectId);
  }

  const response = await fetch(url, {
    headers: {
      "x-api-key": config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ListCollectionsResponse;
}

async function createCollectionWithApi(
  config: ResolvedConfig,
  input: {
    name: string;
    slug: string;
    description?: string | null;
    schema?: CollectionField[];
  },
) {
  const response = await fetch(
    new URL("/api/schema/collections", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "create",
        workspaceId: config.workspaceId,
        projectId: config.projectId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        schema: input.schema ?? [],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function deleteCollectionWithApi(
  config: ResolvedConfig,
  input: { id?: string; slug?: string },
) {
  const response = await fetch(
    new URL("/api/schema/collections", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "delete",
        workspaceId: config.workspaceId,
        projectId: config.projectId,
        id: input.id,
        slug: input.slug,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function mutateCollectionItemWithApi(
  config: ResolvedConfig,
  input: {
    action: "insert" | "update" | "delete";
    collection?: string;
    collectionId?: string;
    itemId?: string;
    values?: Record<string, string | number | boolean | null>;
    items?: Array<Record<string, string | number | boolean | null>>;
    order?: number;
    merge?: boolean;
  },
) {
  const response = await fetch(
    new URL("/api/schema/items", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: input.action,
        workspaceId: config.workspaceId,
        projectId: config.projectId,
        env: config.env,
        collection: input.collection,
        collectionId: input.collectionId,
        itemId: input.itemId,
        values: input.values,
        items: input.items,
        order: input.order,
        merge: input.merge,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function listAssetsWithApi(
  config: ResolvedConfig,
  input: { projectId?: string; page: number; limit: number },
) {
  const url = new URL("/api/schema/assets", normalizeBaseUrl(config.baseUrl));
  url.searchParams.set("workspaceId", config.workspaceId);
  if (input.projectId) {
    url.searchParams.set("projectId", input.projectId);
  }
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("limit", String(input.limit));

  const response = await fetch(url, {
    headers: {
      "x-api-key": config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ListAssetsResponse;
}

async function requestAssetUploadWithApi(
  config: ResolvedConfig,
  input: { projectId: string; filename: string; contentType: string; size: number },
) {
  const response = await fetch(
    new URL("/api/schema/assets", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "request-upload",
        workspaceId: config.workspaceId,
        projectId: input.projectId,
        filename: input.filename,
        contentType: input.contentType,
        size: input.size,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as {
    asset: AssetRecord;
    assetId: string;
    publicUrl: string;
    uploadUrl: string;
    workspaceId: string;
  };
}

async function confirmAssetUploadWithApi(
  config: ResolvedConfig,
  input: { assetId: string },
) {
  const response = await fetch(
    new URL("/api/schema/assets", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "confirm-upload",
        workspaceId: config.workspaceId,
        assetId: input.assetId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as { asset: AssetRecord; workspaceId: string };
}

async function getAssetInfoWithApi(
  config: ResolvedConfig,
  input: { assetId: string },
) {
  const url = new URL("/api/schema/assets", normalizeBaseUrl(config.baseUrl));
  url.searchParams.set("workspaceId", config.workspaceId);
  url.searchParams.set("assetId", input.assetId);

  const response = await fetch(url, {
    headers: {
      "x-api-key": config.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as { asset: AssetRecord; workspaceId: string };
}

async function deleteAssetWithApi(
  config: ResolvedConfig,
  input: { assetId: string },
) {
  const response = await fetch(
    new URL("/api/schema/assets", normalizeBaseUrl(config.baseUrl)),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify({
        action: "delete",
        workspaceId: config.workspaceId,
        assetId: input.assetId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json();
}

async function writeMiniConfig(config: ResolvedConfig) {
  const value = {
    $schema: `${normalizeBaseUrl(DEFAULT_BASE_URL)}schemas/mini.config.schema.json`,
    baseUrl: config.baseUrl,
    workspaceId: config.workspaceId,
    ...(config.projectId ? { projectId: config.projectId } : {}),
    apiKey: config.apiKey,
    ...(config.collectionId ? { collectionId: config.collectionId } : {}),
    collectionsPath: relativeSafe(config.collectionsPath),
    typesPath: relativeSafe(config.typesPath),
    clientPath: relativeSafe(config.clientPath),
    declarationsPath: relativeSafe(config.declarationsPath),
  };

  await writeJson(config.configPath, value);
}

async function writeCollectionsFile(filePath: string, payload: PullResponse): Promise<string> {
  const outputPath = await resolveCollectionsOutputPath(filePath);

  await importedWriteJson(outputPath, {
    $schema: `${normalizeBaseUrl(DEFAULT_BASE_URL)}schemas/mini.collections.schema.json`,
    workspaceId: payload.workspaceId,
    pulledAt: payload.pulledAt,
    collections: payload.collections,
  });

  return outputPath;
}

async function resolveCollectionsOutputPath(filePath: string) {
  const stats = await stat(filePath).catch(() => null);

  if (stats?.isDirectory()) {
    return join(filePath, "mini.collections.json");
  }

  return filePath;
}

async function loadCollectionsInput(filePath: string, collectionId?: string): Promise<SyncedCollection[]> {
  return importedLoadCollectionsInput(filePath, collectionId);
}

function normalizeCollections(collections: SyncedCollection[]): SyncedCollection[] {
  return importedNormalizeCollections(collections);
}

async function writeTypesFile(
  filePath: string,
  collections: SyncedCollection[],
  workspaceId: string,
): Promise<void> {
  return importedWriteTypesFile(filePath, collections, workspaceId);
}

async function writeClientFiles(
  config: ResolvedConfig,
  collections: SyncedCollection[],
): Promise<GenerateResponse> {
  return importedWriteClientFiles(config, collections);
}

async function installSkill(projectRoot: string): Promise<AddSkillResponse> {
  return importedInstallSkill(projectRoot);
}

async function promptForMiniConfig(
  existingConfig: MiniConfig,
  ask: AskQuestion,
): Promise<MiniConfig> {
  const baseUrl = await promptValue(ask, "Base URL", existingConfig.baseUrl, {
    required: true,
  });
  const workspaceId = await promptValue(
    ask,
    "Workspace ID",
    existingConfig.workspaceId,
    { required: true },
  );
  const projectId = await promptValue(
    ask,
    "Default project ID",
    existingConfig.projectId,
  );
  const defaultEnv = await promptValue(
    ask,
    "Default environment slug",
    existingConfig.defaultEnv ?? "production",
    { required: true },
  );
  const environmentId = await promptValue(
    ask,
    "Default environment ID",
    existingConfig.environmentId,
  );
  const apiKey = await promptValue(ask, "API key", existingConfig.apiKey);
  const collectionId = await promptValue(
    ask,
    "Default collection ID",
    existingConfig.collectionId,
  );
  const collectionsPath = await promptValue(
    ask,
    "Collections file path",
    existingConfig.collectionsPath ?? DEFAULT_COLLECTIONS_PATH,
    { required: true },
  );
  const typesPath = await promptValue(
    ask,
    "Types file path",
    existingConfig.typesPath ?? DEFAULT_TYPES_PATH,
    { required: true },
  );
  const clientPath = await promptValue(
    ask,
    "Client file path",
    existingConfig.clientPath ?? DEFAULT_CLIENT_PATH,
    { required: true },
  );
  const declarationsPath = await promptValue(
    ask,
    "Declarations file path",
    existingConfig.declarationsPath ?? DEFAULT_DECLARATIONS_PATH,
    { required: true },
  );

  return compactMiniConfig({
    baseUrl,
    workspaceId,
    ...(projectId ? { projectId } : {}),
    ...(environmentId ? { environmentId } : {}),
    defaultEnv,
    ...(existingConfig.environments
      ? { environments: existingConfig.environments }
      : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(collectionId ? { collectionId } : {}),
    collectionsPath,
    typesPath,
    clientPath,
    declarationsPath,
  });
}

function compactMiniConfig(config: MiniConfig): MiniConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== ""),
  ) as MiniConfig;
}

async function withPrompt<T>(run: (ask: AskQuestion) => Promise<T>) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await run((question) => readline.question(question));
  } finally {
    readline.close();
  }
}

async function readItemsFromStdin() {
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("stdin must contain valid JSON object or array.");
  }

  if (Array.isArray(parsed)) {
    if (!parsed.every(isRecordValueMap)) {
      throw new Error("stdin JSON array must contain only item objects.");
    }

    return parsed as Array<Record<string, string | number | boolean | null>>;
  }

  if (!isRecordValueMap(parsed)) {
    throw new Error("stdin JSON must be an item object or array of item objects.");
  }

  return parsed as Record<string, string | number | boolean | null>;
}

function isRecordValueMap(value: unknown): value is Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry),
  );
}

async function promptValue(
  ask: AskQuestion,
  label: string,
  defaultValue?: string,
  options?: { required?: boolean },
) {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await ask(`${label}${suffix}: `)).trim();
    const value = answer || defaultValue || "";

    if (options?.required && !value) {
      console.log(`${label} is required.`);
      continue;
    }

    return value;
  }
}

function parseKeyValueInput(value: string): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};

  for (const segment of value.split(";")) {
    const trimmed = segment.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      throw new Error(`Invalid key/value pair: ${trimmed}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      throw new Error(`Invalid key/value pair: ${trimmed}`);
    }

    result[key] = parseScalarValue(rawValue);
  }

  return result;
}

function parseScalarValue(value: string) {
  const normalized = value.trim();

  if (normalized === "null") {
    return null;
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  const numericValue = Number(normalized);

  if (normalized !== "" && !Number.isNaN(numericValue)) {
    return numericValue;
  }

  return normalized;
}

async function resolveCollectionIdentifier(
  config: ResolvedConfig,
  value: string,
) {
  const payload = await listCollectionsWithApi(config);
  const collection = payload.collections.find(
    (item) => item.id === value || item.slug === value,
  );

  if (!collection) {
    throw new Error(`Collection not found: ${value}`);
  }

  return collection;
}

async function resolveProjectIdentifier(config: ResolvedConfig, value: string) {
  const payload = await listProjects(config);
  const project = payload.projects.find(
    (item) => item.id === value || item.slug === value,
  );

  if (!project) {
    throw new Error(`Project not found: ${value}`);
  }

  return project;
}

function toJsPropertyName(value: string): string {
  return importedToJsPropertyName(value);
}

function toPascalCase(value: string): string {
  return importedToPascalCase(value);
}

function toTsType(type: FieldType): string {
  return importedToTsType(type);
}

async function readJsonFile<T>(filePath: string, optional = false): Promise<T | null> {
  return importedReadJsonFile<T>(filePath, optional);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  return importedWriteJson(filePath, value);
}

async function readError(response: Response): Promise<string> {
  return importedReadError(response);
}

function normalizeBaseUrl(baseUrl: string): string {
  return importedNormalizeBaseUrl(baseUrl);
}

function relativeSafe(filePath: string) {
  return importedRelativeSafe(filePath);
}

function inferContentType(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "ico":
      return "image/x-icon";
    case "pdf":
      return "application/pdf";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

export {
  DEFAULT_BASE_URL,
  DEFAULT_COLLECTIONS_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CLIENT_PATH,
  DEFAULT_DECLARATIONS_PATH,
  DEFAULT_SKILL_DIRECTORY,
  DEFAULT_TYPES_PATH,
  compactMiniConfig,
  collectItemFieldKeys,
  formatCliError,
  formatCollectionItemsTableRows,
  installSkill,
  loadCollectionsInput,
  normalizeBaseUrl,
  normalizeCollections,
  parseKeyValueInput,
  printTable,
  promptForMiniConfig,
  pullSchemas,
  pushSchemas,
  readError,
  resolveConfig,
  toJsPropertyName,
  toPascalCase,
  toTsType,
  writeCollectionsFile,
  writeClientFiles,
  writeMiniConfig,
  writeTypesFile,
};

export type {
  CollectionField,
  CommandOptions,
  MiniConfig,
  PullResponse,
  PushResponse,
  ResolvedConfig,
  SyncedCollection,
};
