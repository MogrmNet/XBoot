# GARHI API — Cloudflare Worker

See the main `../README.md` for deployment and configuration. Store `OPENAI_API_KEY` using `wrangler secret put OPENAI_API_KEY`; do not commit it.

Optional Worker variables:
- `OPENAI_MODEL` (default `gpt-4o-mini`)
- `OPENAI_API_URL` (default OpenAI-compatible Chat Completions URL)
- `ALLOWED_ORIGIN` (comma-separated allowed origins; configure in Cloudflare)

Endpoint: `POST /api/chat`

Request JSON:
```json
{
  "message": "إيه مسار الـSR؟",
  "history": [],
  "knowledge": []
}
```

Response JSON:
```json
{
  "answer": "...",
  "status": "PARTIALLY_VERIFIED",
  "sources": []
}
```

This endpoint does not connect to internal WE systems. Configure provider billing, authentication, request limits, and origin restrictions before production use.
