import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compactMiniConfig,
  DEFAULT_CLIENT_PATH,
  DEFAULT_COLLECTIONS_PATH,
  DEFAULT_DECLARATIONS_PATH,
  DEFAULT_TYPES_PATH,
  formatCliError,
  installSkill,
  loadCollectionsInput,
  parseKeyValueInput,
  promptForMiniConfig,
  pullSchemas,
  readError,
  resolveConfig,
  run,
  writeClientFiles,
  writeMiniConfig,
  writeTypesFile,
  type ResolvedConfig,
} from "../../src/index";
import { cleanupTempDir, createJsonResponse, createTempDir } from "../common";

const originalCwd = process.cwd();
const originalConsoleLog = console.log;
const originalFetch = globalThis.fetch;

function getLoggedLines(logMock: ReturnType<typeof mock>) {
  return (logMock.mock.calls as Array<[string]>)
    .flatMap((call) => call[0].split("\n"))
    .filter((line) => line.length > 0);
}

async function withMockedTerminalWidth<T>(width: number, runTest: () => Promise<T>) {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");

  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value: width,
  });

  try {
    return await runTest();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, "columns", descriptor);
    } else {
      Reflect.deleteProperty(process.stdout, "columns");
    }
  }
}

describe("cli helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    delete process.env.MINI_CMS_BASE_URL;
    delete process.env.MINI_CMS_WORKSPACE_ID;
    delete process.env.MINI_CMS_PROJECT_ID;
    delete process.env.MINI_CMS_API_KEY;
    console.log = originalConsoleLog;
    globalThis.fetch = originalFetch;
    mock.restore();
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  });

  test("resolveConfig prefers inline options and falls back to config file", async () => {
    await writeFile(
      join(tempDir, "mini.config.json"),
      JSON.stringify({
        baseUrl: "https://cms.example.com",
        workspaceId: "ws_123",
        apiKey: "mcms_test",
        collectionsPath: "defs/content.json",
        typesPath: "generated/types.ts",
      }),
    );

    const config = await resolveConfig({
      config: join(tempDir, "mini.config.json"),
      workspaceId: "ws_override",
    });

    expect(config.baseUrl).toBe("https://cms.example.com");
    expect(config.workspaceId).toBe("ws_override");
    expect(config.apiKey).toBe("mcms_test");
    expect(config.collectionsPath.endsWith("defs/content.json")).toBe(true);
    expect(config.typesPath.endsWith("generated/types.ts")).toBe(true);
  });

  test("resolveConfig requires projectId when requested", async () => {
    await expect(
      resolveConfig(
        {
          baseUrl: "https://cms.example.com",
          workspaceId: "ws_123",
          apiKey: "mcms_test",
        },
        { requireProjectId: true },
      ),
    ).rejects.toThrow(
      "Missing required projectId. Provide --project-id, define projectId in mini.config.json, or set MINI_CMS_PROJECT_ID.",
    );
  });

  test("resolveConfig falls back to MINI_CMS_ env vars", async () => {
    process.env.MINI_CMS_BASE_URL = "https://env.example.com";
    process.env.MINI_CMS_WORKSPACE_ID = "ws_env";
    process.env.MINI_CMS_PROJECT_ID = "proj_env";
    process.env.MINI_CMS_API_KEY = "mcms_env";

    const config = await resolveConfig({});

    expect(config.baseUrl).toBe("https://env.example.com");
    expect(config.workspaceId).toBe("ws_env");
    expect(config.projectId).toBe("proj_env");
    expect(config.apiKey).toBe("mcms_env");
  });

  test("resolveConfig prefers config file over MINI_CMS_ env vars", async () => {
    process.env.MINI_CMS_BASE_URL = "https://env.example.com";
    process.env.MINI_CMS_WORKSPACE_ID = "ws_env";
    process.env.MINI_CMS_PROJECT_ID = "proj_env";
    process.env.MINI_CMS_API_KEY = "mcms_env";

    await writeFile(
      join(tempDir, "mini.config.json"),
      JSON.stringify({
        baseUrl: "https://cms.example.com",
        workspaceId: "ws_file",
        projectId: "proj_file",
        apiKey: "mcms_file",
      }),
    );

    const config = await resolveConfig({
      config: join(tempDir, "mini.config.json"),
    });

    expect(config.baseUrl).toBe("https://cms.example.com");
    expect(config.workspaceId).toBe("ws_file");
    expect(config.projectId).toBe("proj_file");
    expect(config.apiKey).toBe("mcms_file");
  });

  test("resolveConfig prefers inline options over config and MINI_CMS_ env vars", async () => {
    process.env.MINI_CMS_BASE_URL = "https://env.example.com";
    process.env.MINI_CMS_WORKSPACE_ID = "ws_env";
    process.env.MINI_CMS_PROJECT_ID = "proj_env";
    process.env.MINI_CMS_API_KEY = "mcms_env";

    await writeFile(
      join(tempDir, "mini.config.json"),
      JSON.stringify({
        baseUrl: "https://cms.example.com",
        workspaceId: "ws_file",
        projectId: "proj_file",
        apiKey: "mcms_file",
      }),
    );

    const config = await resolveConfig({
      config: join(tempDir, "mini.config.json"),
      baseUrl: "https://inline.example.com",
      workspaceId: "ws_inline",
      projectId: "proj_inline",
      apiKey: "mcms_inline",
    });

    expect(config.baseUrl).toBe("https://inline.example.com");
    expect(config.workspaceId).toBe("ws_inline");
    expect(config.projectId).toBe("proj_inline");
    expect(config.apiKey).toBe("mcms_inline");
  });

  test("loadCollectionsInput reads a directory of json files", async () => {
    await writeFile(
      join(tempDir, "projects.json"),
      JSON.stringify({
        name: "Projects",
        slug: "projects",
        description: null,
        schema: [{ key: "title", label: "Title", type: "text" }],
      }),
    );
    await writeFile(
      join(tempDir, "team.json"),
      JSON.stringify({
        collections: [
          {
            id: "col_team",
            name: "Team",
            slug: "team",
            description: "People",
            schema: [{ key: "active", label: "Active", type: "boolean" }],
          },
        ],
      }),
    );

    const collections = await loadCollectionsInput(tempDir);

    expect(collections).toHaveLength(2);
    expect(collections.map((item) => item.slug).sort()).toEqual([
      "projects",
      "team",
    ]);
  });

  test("loadCollectionsInput deduplicates by slug and prefers entries with ids", async () => {
    await writeFile(
      join(tempDir, "projects.json"),
      JSON.stringify({
        name: "Projects",
        slug: "projects",
        description: null,
        schema: [{ key: "title", label: "Title", type: "text" }],
      }),
    );
    await writeFile(
      join(tempDir, "mini.collections.json"),
      JSON.stringify({
        workspaceId: "ws_123",
        pulledAt: new Date().toISOString(),
        collections: [
          {
            id: "col_projects",
            name: "Projects",
            slug: "projects",
            description: "Pulled from server",
            schema: [
              { key: "title", label: "Title", type: "text" },
              { key: "url", label: "URL", type: "url" },
            ],
          },
        ],
      }),
    );

    const collections = await loadCollectionsInput(tempDir);

    expect(collections).toHaveLength(1);
    expect(collections[0].id).toBe("col_projects");
    expect(collections[0].schema).toHaveLength(2);
  });

  test("writeTypesFile generates workspace and collection item types", async () => {
    const output = join(tempDir, "mini.types.ts");

    await writeTypesFile(
      output,
      [
        {
          id: "col_projects",
          name: "Projects",
          slug: "client-projects",
          description: null,
          schema: [
            { key: "title", label: "Title", type: "text" },
            { key: "published", label: "Published", type: "boolean" },
          ],
        },
      ],
      "ws_123",
    );

    const contents = await readFile(output, "utf8");

    expect(contents).toContain('export const workspaceId = "ws_123" as const;');
    expect(contents).toContain('export type CollectionSlug =');
    expect(contents).toContain('"client-projects"');
    expect(contents).toContain("export type ClientProjectsItem = {");
    expect(contents).toContain("published: boolean;");
    expect(contents).toContain("export type CollectionItemData<T> = {");
    expect(contents).toContain("type _DefaultFields = {");
    expect(contents).toContain("_id: string;");
    expect(contents).toContain("_published: boolean;");
    expect(contents).toContain("data: T & _DefaultFields;");
    expect(contents).toContain("export type CollectionItem<T extends CollectionSlug> = CollectionItemData<CollectionMap[T]>;");
  });

  test("writeMiniConfig writes relative generated paths", async () => {
    const config: ResolvedConfig = {
      configPath: join(tempDir, "mini.config.json"),
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
      projectId: "proj_123",
      env: "production",
      apiKey: "mcms_test",
      collectionsPath: join(process.cwd(), "content/mini.collections.json"),
      typesPath: join(process.cwd(), "types/mini.types.ts"),
      clientPath: join(process.cwd(), "client/mini.client.js"),
      declarationsPath: join(process.cwd(), "client/mini.client.d.ts"),
    };

    await writeMiniConfig(config);

    const file = JSON.parse(
      await readFile(join(tempDir, "mini.config.json"), "utf8"),
    ) as Record<string, string>;

    expect(file.collectionsPath).toBe("content/mini.collections.json");
    expect(file.typesPath).toBe("types/mini.types.ts");
    expect(file.clientPath).toBe("client/mini.client.js");
    expect(file.declarationsPath).toBe("client/mini.client.d.ts");
  });

  test("compactMiniConfig removes empty optional values", () => {
    expect(
      compactMiniConfig({
        baseUrl: "https://cms.example.com",
        workspaceId: "ws_123",
        apiKey: "",
        projectId: undefined,
      }),
    ).toEqual({
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
    });
  });

  test("promptForMiniConfig builds config from answers", async () => {
    const answers = [
      "https://cms.example.com",
      "ws_123",
      "proj_123",
      "mcms_test",
      "mcms_test",
      "col_123",
      "content/mini.collections.json",
      "types/mini.types.ts",
      "client/mini.client.js",
      "client/mini.client.d.ts",
    ];

    const config = await promptForMiniConfig({}, async () => answers.shift() ?? "");

    expect(config).toEqual({
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
      projectId: "proj_123",
      environmentId: "mcms_test",
      apiKey: "mcms_test",
      collectionId: "col_123",
      collectionsPath: "content/mini.collections.json",
      typesPath: "types/mini.types.ts",
      clientPath: "client/mini.client.js",
      declarationsPath: "client/mini.client.d.ts",
    });
  });

  test("compactMiniConfig supports direct init-style config creation", () => {
    const config = compactMiniConfig({
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
      projectId: "proj_123",
      apiKey: "mcms_test",
      collectionId: "col_123",
      collectionsPath: DEFAULT_COLLECTIONS_PATH,
      typesPath: DEFAULT_TYPES_PATH,
      clientPath: DEFAULT_CLIENT_PATH,
      declarationsPath: DEFAULT_DECLARATIONS_PATH,
    });

    expect(config).toEqual({
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
      projectId: "proj_123",
      apiKey: "mcms_test",
      collectionId: "col_123",
      collectionsPath: DEFAULT_COLLECTIONS_PATH,
      typesPath: DEFAULT_TYPES_PATH,
      clientPath: DEFAULT_CLIENT_PATH,
      declarationsPath: DEFAULT_DECLARATIONS_PATH,
    });
  });

  test("parseKeyValueInput parses strings booleans numbers and null", () => {
    expect(
      parseKeyValueInput(
        "title=Hello;published=true;views=42;summary=null;url=https://example.com",
      ),
    ).toEqual({
      title: "Hello",
      published: true,
      views: 42,
      summary: null,
      url: "https://example.com",
    });
  });

  test("formatCliError suggests renamed list commands", () => {
    const error = formatCliError(
      new Error("Unused args: `list-collections`"),
      ["node", "mini-cms", "push", "list-collections"],
    );

    expect(error.message).toBe(
      "Unknown command usage: push list-collections. Did you mean `list-collections`?",
    );
  });

  test("formatCliError explains incomplete top-level command prefixes", () => {
    const error = formatCliError(
      new Error("Incomplete command: collection. Try `collection create`, `collection delete <collection>`, or `collection item list <collection>`."),
      ["node", "mini-cms", "collection"],
    );

    expect(error.message).toBe(
      "Incomplete command: collection. Try `collection create`, `collection delete <collection>`, or `collection item list <collection>`.",
    );
  });

  test("formatCliError explains incomplete nested command prefixes", () => {
    const error = formatCliError(
      new Error("Incomplete command: collection item. Try `collection item list <collection>`, `collection item insert <collection>`, or `collection item update <collection>`."),
      ["node", "mini-cms", "collection", "item"],
    );

    expect(error.message).toBe(
      "Incomplete command: collection item. Try `collection item list <collection>`, `collection item insert <collection>`, or `collection item update <collection>`.",
    );
  });

  test("formatCliError explains missing required positional args", () => {
    const error = formatCliError(
      new Error("Incomplete command: collection item list. Usage: `mini-cms collection item list <collection>`."),
      ["node", "mini-cms", "collection", "item", "list"],
    );

    expect(error.message).toBe(
      "Incomplete command: collection item list. Usage: `mini-cms collection item list <collection>`.",
    );
  });

  test("writeClientFiles generates a fetch-based browser client", async () => {
    const config: ResolvedConfig = {
      configPath: join(tempDir, "mini.config.json"),
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
      projectId: "proj_123",
      env: "production",
      apiKey: "",
      collectionsPath: join(tempDir, "mini.collections.json"),
      typesPath: join(tempDir, "mini.types.ts"),
      clientPath: join(tempDir, "mini.client.js"),
      declarationsPath: join(tempDir, "mini.client.d.ts"),
    };

    await writeClientFiles(config, [
      {
        id: "col_projects",
        name: "Projects",
        slug: "projects",
        description: null,
        schema: [{ key: "title", label: "Title", type: "text" }],
      },
      {
        id: "col_case_studies",
        name: "Case Studies",
        slug: "case-studies",
        description: null,
        schema: [{ key: "headline", label: "Headline", type: "text" }],
      },
    ]);

    const clientContents = await readFile(config.clientPath, "utf8");
    const dtsContents = await readFile(config.declarationsPath, "utf8");

    expect(clientContents).toContain("async function getCollectionItems(collectionSlug, options = {})");
    expect(clientContents).toContain("const collections = {");
    expect(clientContents).toContain("collectionDefinitions: getMiniCmsCollections()");
    expect(clientContents).toContain("projects: { query: (options = {}) => getCollectionItems(\"projects\", options) }");
    expect(clientContents).toContain("case_studies: { query: (options = {}) => getCollectionItems(\"case-studies\", options) }");
    expect(clientContents).toContain("await fetch(url.toString()");
    expect(clientContents).toContain("filter.");
    expect(clientContents).toContain("collection_slug");
    expect(clientContents).toContain("collection_id");
    expect(clientContents).toContain("@typedef {object} MiniCmsColllectionItemData");
    expect(clientContents).toContain("@typedef {object} MiniCmsDefaultFields");
    expect(clientContents).toContain("@property {T & MiniCmsDefaultFields} data");
    expect(clientContents).toContain("@typedef {MiniCmsColllectionItemData<MiniCmsCollectionMap[TSlug]>} MiniCmsCollectionItem");
    expect(clientContents).toContain("createdAt: new Date(item.createdAt)");
    expect(dtsContents).toContain("export type MiniCmsCollectionMap = {");
    expect(dtsContents).toContain("export type ProjectsItem = {");
    expect(dtsContents).toContain("type _DefaultFields = {");
    expect(dtsContents).toContain("data: T & _DefaultFields;");
    expect(dtsContents).toContain("export type MiniCmsColllectionItemData<T> = {");
    expect(dtsContents).toContain("export type MiniCmsCollectionItem<T extends MiniCmsCollectionSlug> = MiniCmsColllectionItemData<MiniCmsCollectionMap[T]>;");
    expect(dtsContents).toContain("export type MiniCmsGetCollectionItemsOptions<TSlug extends MiniCmsCollectionSlug");
    expect(dtsContents).toContain("items: Array<MiniCmsCollectionItem<TSlug> & { order: number; }>;");
    expect(dtsContents).toContain("collectionDefinitions: MiniCmsCollectionDefinition[];");
    expect(dtsContents).toContain("collections: {");
    expect(dtsContents).toContain("getCollectionItems<TSlug extends MiniCmsCollectionSlug>(collectionSlug: TSlug, options?: MiniCmsGetCollectionItemsOptions<TSlug>)");
    expect(dtsContents).toContain("case_studies: { query(options?: MiniCmsGetCollectionItemsOptions<\"case-studies\">)");
    expect(dtsContents).toContain('export type MiniCmsCollectionSlug = "projects" | "case-studies";');
  });

  test("installSkill writes SKILL.md to local .skills directory", async () => {
    const output = await installSkill(tempDir);
    const contents = await readFile(output.skillPath, "utf8");

    expect(output.directoryPath).toBe(join(tempDir, ".agents/skills/mini-cms-cli"));
    expect(output.skillPath).toBe(join(tempDir, ".agents/skills/mini-cms-cli/SKILL.md"));
    expect(contents).toContain("name: mini-cms-cli");
    expect(contents).toContain("mini-cms add-skill");
  });

  test("pullSchemas sends workspace project and collection query params", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        createJsonResponse({
          workspaceId: "ws_123",
          pulledAt: "2026-03-08T00:00:00.000Z",
          collections: [],
        }),
      ),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await pullSchemas({
      configPath: join(tempDir, "mini.config.json"),
      baseUrl: "https://cms.example.com",
      workspaceId: "ws_123",
      projectId: "proj_123",
      env: "production",
      apiKey: "mcms_key",
      collectionId: "col_1",
      collectionsPath: join(tempDir, "mini.collections.json"),
      typesPath: join(tempDir, "mini.types.ts"),
      clientPath: join(tempDir, "mini.client.js"),
      declarationsPath: join(tempDir, "mini.client.d.ts"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("/api/schema/pull");
    expect(url.searchParams.get("workspaceId")).toBe("ws_123");
    expect(url.searchParams.get("projectId")).toBe("proj_123");
    expect(url.searchParams.get("collectionId")).toBe("col_1");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "mcms_key",
    );
  });

  test("readError falls back to status text when json parsing fails", async () => {
    const response = new Response("bad gateway", { status: 502 });
    await expect(readError(response)).resolves.toBe(
      "Request failed with status 502.",
    );
  });

  test("list-projects prints a table by default", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        createJsonResponse({
          workspaceId: "ws_123",
          projects: [
            { id: "proj_1", slug: "alpha", name: "Alpha Project" },
            { id: "proj_2", slug: "beta", name: "Beta Project" },
          ],
        }),
      ),
    );
    const logMock = mock(() => {});

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = logMock as unknown as typeof console.log;

    await withMockedTerminalWidth(120, async () => {
      await run([
        "node",
        "mini-cms",
        "list-projects",
        "--base-url",
        "https://cms.example.com",
        "--workspace-id",
        "ws_123",
        "--api-key",
        "mcms_test",
      ]);
    });

    expect(getLoggedLines(logMock)).toEqual([
      "+--------+-------+---------------+",
      "| id     | slug  | name          |",
      "+--------+-------+---------------+",
      "| proj_1 | alpha | Alpha Project |",
      "+--------+-------+---------------+",
      "| proj_2 | beta  | Beta Project  |",
      "+--------+-------+---------------+",
    ]);
  });

  test("list-projects prints json when --json is passed", async () => {
    const payload = {
      workspaceId: "ws_123",
      projects: [{ id: "proj_1", slug: "alpha", name: "Alpha Project" }],
    };
    const fetchMock = mock(() => Promise.resolve(createJsonResponse(payload)));
    const logMock = mock(() => {});

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = logMock as unknown as typeof console.log;

    await run([
      "node",
      "mini-cms",
      "list-projects",
      "--base-url",
      "https://cms.example.com",
      "--workspace-id",
      "ws_123",
      "--api-key",
      "mcms_test",
      "--json",
    ]);

    expect(logMock).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
  });

  test("list-collections prints a table by default", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        createJsonResponse({
          workspaceId: "ws_123",
          collections: [
            {
              id: "col_1",
              slug: "projects",
              name: "Projects",
              projectId: "proj_1",
              description: "Client work",
              schema: [],
            },
          ],
        }),
      ),
    );
    const logMock = mock(() => {});

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = logMock as unknown as typeof console.log;

    await withMockedTerminalWidth(120, async () => {
      await run([
        "node",
        "mini-cms",
        "list-collections",
        "--base-url",
        "https://cms.example.com",
        "--workspace-id",
        "ws_123",
        "--project-id",
        "proj_1",
        "--api-key",
        "mcms_test",
      ]);
    });

    expect(getLoggedLines(logMock)).toEqual([
      "+-------+----------+----------+-----------+-------------+",
      "| id    | slug     | name     | projectId | description |",
      "+-------+----------+----------+-----------+-------------+",
      "| col_1 | projects | Projects | proj_1    | Client work |",
      "+-------+----------+----------+-----------+-------------+",
    ]);
  });

  test("collection item list prints a table by default", async () => {
    const fetchMock = mock((input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString(),
      );

      if (url.pathname === "/api/schema/collections") {
        return Promise.resolve(
          createJsonResponse({
            workspaceId: "ws_123",
            collections: [
              {
                id: "col_1",
                slug: "projects",
                name: "Projects",
                projectId: "proj_1",
                description: "Client work",
                schema: [],
              },
            ],
          }),
        );
      }

      if (url.pathname === "/api/schema/collection-items") {
        return Promise.resolve(
          createJsonResponse({
            workspaceId: "ws_123",
            collection: { id: "col_1", slug: "projects", name: "Projects" },
            items: [
              {
                id: "item_1",
                order: 1,
                data: { title: "Homepage", featured: true },
                createdAt: "2026-03-16T10:00:00.000Z",
                updatedAt: "2026-03-16T11:00:00.000Z",
              },
            ],
            pagination: {
              page: 1,
              limit: 100,
              total: 1,
              totalPages: 1,
              hasMore: false,
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });
    const logMock = mock(() => {});

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = logMock as unknown as typeof console.log;

    await withMockedTerminalWidth(120, async () => {
      await run([
        "node",
        "mini-cms",
        "collection",
        "item",
        "list",
        "projects",
        "--base-url",
        "https://cms.example.com",
        "--workspace-id",
        "ws_123",
        "--project-id",
        "proj_1",
        "--api-key",
        "mcms_test",
      ]);
    });

    expect(getLoggedLines(logMock)).toEqual([
      "+--------+-------+----------+----------+--------------------------+--------------------------+",
      "| id     | order | title    | featured | createdAt                | updatedAt                |",
      "+--------+-------+----------+----------+--------------------------+--------------------------+",
      "| item_1 | 1     | Homepage | true     | 2026-03-16T10:00:00.000Z | 2026-03-16T11:00:00.000Z |",
      "+--------+-------+----------+----------+--------------------------+--------------------------+",
    ]);
  });

  test("collection item list hides columns that exceed terminal width", async () => {
    const fetchMock = mock((input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString(),
      );

      if (url.pathname === "/api/schema/collections") {
        return Promise.resolve(
          createJsonResponse({
            workspaceId: "ws_123",
            collections: [
              {
                id: "col_1",
                slug: "projects",
                name: "Projects",
                projectId: "proj_1",
                description: "Client work",
                schema: [],
              },
            ],
          }),
        );
      }

      if (url.pathname === "/api/schema/collection-items") {
        return Promise.resolve(
          createJsonResponse({
            workspaceId: "ws_123",
            collection: { id: "col_1", slug: "projects", name: "Projects" },
            items: [
              {
                id: "item_1",
                order: 1,
                data: {
                  title: "Homepage",
                  featured: true,
                  summary: "A very long summary column",
                },
                createdAt: "2026-03-16T10:00:00.000Z",
                updatedAt: "2026-03-16T11:00:00.000Z",
              },
            ],
            pagination: {
              page: 1,
              limit: 100,
              total: 1,
              totalPages: 1,
              hasMore: false,
            },
          }),
        );
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    });
    const logMock = mock(() => {});

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    console.log = logMock as unknown as typeof console.log;

    await withMockedTerminalWidth(35, async () => {
      await run([
        "node",
        "mini-cms",
        "collection",
        "item",
        "list",
        "projects",
        "--base-url",
        "https://cms.example.com",
        "--workspace-id",
        "ws_123",
        "--project-id",
        "proj_1",
        "--api-key",
        "mcms_test",
      ]);
    });

    expect(getLoggedLines(logMock)).toEqual([
      "+--------+-------+----------+",
      "| id     | order | title    |",
      "+--------+-------+----------+",
      "| item_1 | 1     | Homepage |",
      "+--------+-------+----------+",
    ]);
  });
});
