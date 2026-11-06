# Mini-CMS

A minimalist, self-hosted CMS for development agencies to manage projects and team members.

## Working Rules

- Treat `apps/web` as the product app, `packages/cli` as the developer/admin CLI, and `apps/docs` as the main product documentation source.
- The docs describe user-facing app features, public API behavior, environment setup, hosting, and CLI usage. Changes in `apps/web` or `packages/cli` often require matching doc updates.
- If you change an existing feature or add a new one, check `apps/docs/` to see whether the docs should be updated.
- When a feature affects both the dashboard and CLI, keep the terminology and behavior aligned across `apps/web`, `packages/cli`, and `apps/docs`.
- If docs are duplicated elsewhere, update the canonical docs in `apps/docs` first, then mirror changes where appropriate.

## Tech Stack

| Component        | Technology                   |
| ---------------- | ---------------------------- |
| Framework        | TanStack Start               |
| Database         | Turso (libSQL) + Drizzle ORM |
| Auth             | Better-auth                  |
| Email            | Resend                       |
| Cache/Rate-limit | Upstash (Redis HTTP)         |
| Build            | Rolldown-vite                |
| Env Validation   | @t3/env                      |

## Project Structure

```
apps/
├── web/                 # Main app: dashboard, API routes, auth, db, server functions
│   └── src/
│       ├── db/
│       ├── lib/
│       ├── server/functions/
│       └── routes/
├── docs/                # Canonical product docs for app features, API, env, hosting, CLI
│   ├── content/docs/
│   └── public/docs/assets/
└── docs/             # New docs app/migration target; keep content aligned with apps/docs

packages/
└── cli/                 # Mini CMS CLI for schema sync and content operations
```

## App, CLI, and Docs Relationship

- `apps/web` implements the dashboard UX, public/content APIs, schema routes, auth, and server-side behavior.
- `packages/cli` depends on API behavior exposed by `apps/web`, especially the `/api/schema/*` endpoints.
- `apps/docs` explains how to use the app and CLI, and documents environment variables, API behavior, and hosting.
- A change in app behavior may require CLI changes, and a change in CLI or app behavior may require docs changes.
- Before finishing feature work, check whether the user-facing docs and CLI examples still match the implementation.

## Environment Variables

See `.env.example` for required variables:

```bash
# Database (Turso)
TURSO_DB_URL=
TURSO_AUTH_TOKEN=

# Auth (Better-auth)
AUTH_SECRET=

# Email (Resend)
RESEND_API_KEY=

# Cache/Rate-limit (Upstash)
UPSTASH_REDIS_KV_REST_API_URL=
UPSTASH_REDIS_KV_REST_API_TOKEN=
```

## Commands

```bash
# Install dependencies
bun install

# Run development
bun run dev

# Build for production
bun run build

# Typecheck
bun run typecheck

# Lint
bun run lint

# Format
bun run format
```

## End-to-End Tests

```bash
# Run the whole e2e suite (starts a dev server automatically)
bun run test:e2e
```

The suite runs against the configured database, so point `TURSO_DB_URL` at a
throwaway database before running it. Test data is created and removed by the
tests themselves, but the schema must already exist.

### Capturing outbound email

The invite flow test asserts on the email that Resend would send. To avoid
delivering real mail, run the local Resend stand-in and point the dev server
at it:

```bash
# Terminal 1 - capture outgoing mail instead of sending it
bun --cwd apps/web run test:e2e:mail

# Terminal 2 - dev server with the capture base URL
RESEND_BASE_URL=http://127.0.0.1:3999 bun run dev
```

The invite test skips itself when the stand-in is not running, so it can never
send a real email. Everything else in the suite runs either way.

## API Endpoints

### Public (Cached, Rate-limited)

| Method | Path                     | Description                   |
| ------ | ------------------------ | ----------------------------- |
| GET    | `/api/collections`       | List collections (paginated)  |
| GET    | `/api/collections/:slug` | Get collection items (cached) |

### Protected (Server Functions)

| Category    | Functions                    |
| ----------- | ---------------------------- |
| Collections | create, update, delete, list |
| Items       | create, update, delete, list |
| Invites     | create, accept               |
| Users       | list, updateRole             |

## Schema Field Types

| Type      | Editor       | Display                           |
| --------- | ------------ | --------------------------------- |
| `text`    | Text input   | Plain text                        |
| `url`     | URL input    | Thumbnail (hover) + Modal (click) |
| `number`  | Number input | Number                            |
| `boolean` | Toggle       | Checkmark/X                       |

## Caching Strategy

- GET `/api/collections/:slug` cached for 60s via Upstash
- Cache invalidates on any collection/item change
- Rate-limited: 300 requests/minute per API key or session (IP fallback for anonymous)

## Auth Flow

1. Admin creates invite link → sends email via Resend
2. User clicks link → creates account → gets admin access
3. Sessions managed via better-auth
