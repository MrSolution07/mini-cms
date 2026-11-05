# Mini-CMS Implementation Plan

## Quick Reference

| Phase | File                   | Description                |
| ----- | ---------------------- | -------------------------- |
| 1     | 01-dependencies.md     | Install dependencies       |
| 2     | 02-environment.md      | Environment configuration  |
| 3     | 03-database.md         | Drizzle schema setup       |
| 4     | 04-queries.md          | Database queries           |
| 5     | 05-auth.md             | Better-auth setup          |
| 6     | 06-cache.md            | Upstash cache & rate-limit |
| 7     | 07-email.md            | Resend email setup         |
| 8     | 08-server-functions.md | Server functions (RPC)     |
| 9     | 09-api-routes.md       | Public API routes          |
| 10    | 10-dashboard.md        | Dashboard UI               |
| 11    | 11-assets.md           | Asset management           |
| 12    | 12-cleanup.md          | Cleanup & final steps      |
| 13    | 13-environment-feature.md | Environment feature — content versioning for projects |
| 14    | 14-invite-fix.md         | Invite flow fix — allow unauthenticated users to view & accept invites |
| 15    | 15-table-controls.md     | Table controls — page size, refresh, filter, sort across dashboard tables |

## Order

Execute phases in numerical order (1-15)

> **Phase 13** (environment feature) builds on top of all previous phases. Start it only after phases 1–12 are complete.
> **Phase 15** (table controls) is implemented and merged into `main`.