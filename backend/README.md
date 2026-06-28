# Backend API

Base path: `/api`

| Method | Path | Params / body |
| --- | --- | --- |
| `GET` | `/health` | none |
| `GET` | `/projects` | none |
| `POST` | `/projects` | body: `name?` |
| `GET` | `/projects/:id` | path: `id` |
| `PATCH` | `/projects/:id` | path: `id`; body: `name` |
| `DELETE` | `/projects/:id` | path: `id` |
| `GET` | `/projects/:projectId/files` | path: `projectId` |
| `POST` | `/projects/:projectId/files` | path: `projectId`; multipart: `files[]` (max 10, 20 MiB each) |
| `DELETE` | `/projects/:projectId/files/:fileId` | path: `projectId`, `fileId` |
| `GET` | `/projects/:projectId/prompts` | path: `projectId` |
| `POST` | `/projects/:projectId/prompts` | path: `projectId`; body: `prompt`, `file_ids?` |
| `POST` | `/projects/:projectId/prompts/:promptId/stop` | path: `projectId`, `promptId` |
| `POST` | `/projects/:projectId/prompts/:promptId/retry` | path: `projectId`, `promptId`; body: `prompt?`, `file_ids?` |
| `GET` | `/events/:projectId` | path: `projectId`; SSE stream |
| `POST` | `/events/broadcast` | body: `projectId`, `event` |
| `GET` | `/skills` | none |
| `POST` | `/skills` | body: `name`, `system_prompt`, `description?`, `tool_name?` |
| `PUT` | `/skills/:id` | path: `id`; body: `name?`, `system_prompt?`, `description?`, `tool_name?` |
| `DELETE` | `/skills/:id` | path: `id` |
| `GET` | `/personality` | none |
| `PUT` | `/personality` | body: `text` |
| `GET` | `/personality/versions` | none |
| `GET` | `/personality/versions/:id/projects` | path: `id` |
| `GET` | `/tools` | none |
| `GET` | `/tools/:name` | path: `name` |
| `POST` | `/tools` | body proxied to pyworker: `name`, `code`, `description?`, `params_schema?`, `read_only?`, `permissions?` |
| `PUT` | `/tools/:name` | path: `name`; body proxied to pyworker: `code?`, `description?`, `params_schema?` |
| `DELETE` | `/tools/:name` | path: `name` |
| `GET` | `/drafts/:key` | path: `key` |
| `PUT` | `/drafts/:key` | path: `key`; body: `text` |
| `POST` | `/admin/reset-database` | body: `confirmation = "NUKE DATABASE"` |

File upload MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `application/vnd.ms-powerpoint`, `application/msword`.
