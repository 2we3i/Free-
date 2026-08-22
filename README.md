# AI Video Pipeline

Production-oriented Node.js/TypeScript service: daily idea → clips + audio → stitch → Telegram approval → publish to 9 networks via self-hosted Postiz, with every status written to Google Sheets.

## Requirements

- Node.js 20+
- Telegram bot token, admin chat, developer alert chat
- OpenAI key (GPT-5 idea + GPT-5 fallback for scene breakdown)
- Claude or Gemini key for parallel scene detailing
- Wavespeed AI, Fal AI, self-hosted Postiz (`POSTIZ_API_KEY` + integration IDs), Google service account

## Setup

```bash
cp .env.example .env
npm install
npm run typecheck
npm run dev
```

The process exits immediately if `.env` fails Zod validation.

## Run

| Command | Purpose |
| --- | --- |
| `npm run dev` | Bot long-polling + daily cron |
| `npm start` | Production (`node dist/index.js` after `npm run build`) |
| `npx tsx src/index.ts --run-now` | One pipeline run without waiting for cron |

`CRON_SCHEDULE` defaults to `0 9 * * *` in `TZ`.

## Postiz

Connect TikTok, LinkedIn, Facebook, Instagram, X, YouTube, Threads, Bluesky, and Pinterest once in the Postiz web UI. This service only needs `POSTIZ_BASE_URL`, `POSTIZ_API_KEY`, and the nine `POSTIZ_INTEGRATION_*` IDs from the dashboard.

After approval it uploads the stitched video (`POST /public/v1/upload`), then creates one post (`POST /public/v1/posts`) with all integration IDs. Per-network success/error from that response is recorded independently in Google Sheets.

## Telegram HITL

After stitch, the admin chat gets the video plus `✅ Опубликовать` / `❌ Отмена`. The run waits on an in-memory Promise keyed by `Run_ID` until callback or `APPROVAL_TIMEOUT_MS` (default 45 minutes). Timeout and cancel both set `CANCELLED` and skip publish. Repeat callbacks are rejected. Restart loses pending waits (move the registry to Redis if you need durability).

## Sheets columns

`Run_ID | Status | Idea | Video_URL | Post_Links | Error | Timestamp`

Statuses: `GENERATING_SCRIPT → GENERATING_MEDIA → STITCHING → AWAITING_APPROVAL → PUBLISHING → DONE | CANCELLED | ERROR`

Partial publish success is `DONE` with failed networks listed in `Error`. Total publish failure is `ERROR`.
