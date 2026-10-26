# GARHI — WE Technical Copilot AI

> مساعدك الذكي لشغل WE Technical Call Center
> Independent tool. **Not** an official WE product and **not** connected to any WE internal system.

A ChatGPT-style assistant for call-center agents: type a question, get a streamed answer grounded in the reference records, with source/page citations and an honest evidence label. The chat is the home screen.

```
Browser (GitHub Pages, static)            Cloudflare Worker (/worker)                 Model provider
 chat UI · history · uploads/OCR  ──POST──▶ validate · CORS · rate-limit
 (files stay in the browser)        /api/chat  retrieve from knowledge.json (server-side)
                                              build evidence-only prompt ───────────▶ Anthropic Messages API (streaming)
 renders stream + sources + label ◀──SSE──  stream deltas, label computed by server ◀──
```

## What is real vs. what needs setup

| Feature | Status |
|---|---|
| Chat UI: streaming, stop, retry, copy answer, copy SR path, history (search/rename/delete), RTL/LTR, mobile | ✅ implemented, browser-tested |
| Backend (`worker/`): validation, CORS, optional access code, rate limit, server-side retrieval, streaming | ✅ implemented, unit-tested with a **mocked** provider |
| **Real AI answers** | ⚠️ **needs your setup** (below). Not verified against the live provider in development — no key/network was available. |
| Evidence label (`VERIFIED / PARTIALLY VERIFIED / NOT FOUND`) | ✅ computed by the **server** from source status, never self-declared by the model |
| No-evidence questions | ✅ fixed Arabic "not confirmed" reply, **model is not called** |
| PDF / screenshot ingestion (pdf.js + Tesseract OCR `ara+eng`) with per-page status, retry, manual correction | ✅ implemented; libraries load from jsDelivr in the browser. **OCR/PDF path was not run in dev** (no CDN access) — only txt/json ingestion was browser-tested. |
| Quiz Solver (exact vs similar, option letters preserved) | ✅ implemented; **needs an answer-key record** (format below). With none, it says no confirmed answer. |
| Semantic/vector search | ❌ not implemented. Retrieval is lexical + Arabic/English synonym groups (`js/retrieval.js`). |
| Server-side admin panel / login / approval workflow / conflict detection | ❌ not implemented (a static site cannot do this securely). See "Approving knowledge". |
| `tech.pdf` and quiz PDFs | ❌ not in this repo (must not be public). `knowledge.json` is the earlier hand-written summary: 23/25 records are `historical`. |

## Knowledge records

`knowledge.json` is the only built-in knowledge. Each record: `id, title, category, terms[], summary, steps[], sourcePages[], evidence, status`.
`status` values: `approved` (only these can ever yield **VERIFIED**), `historical`, `training`, `policy`, `user-upload`.
Nothing is `approved` today, so every answer is at best **PARTIALLY VERIFIED** and tells the agent to confirm with the official procedure/supervisor.

**Quiz key record** (category must contain "Quiz"):
```json
{"id":"q-001","title":"Quiz 3 — Q4","category":"Quiz Questions and Answer Keys","terms":[],"summary":"…","steps":[],"sourcePages":[4],
 "status":"approved","question":"…","options":[{"letter":"A","text":"…"},{"letter":"B","text":"…"}],"answerLetter":"B","evidence":"Technical_Quiz_Answers_1-15.pdf p.4"}
```
A verified letter is returned only for an **exact** question+options match on an `approved` key. Anything else is reported as "similar" or "no confirmed answer".

### Approving knowledge
Approval = a reviewed pull request that edits `knowledge.json` (`status: "approved"`, real `sourcePages`). Uploads made in the browser are forced to `user-upload`, stay on that device, and can never override or approve anything.

## Setup — enable the real AI (≈10 min)

You need: a Cloudflare account (free tier works) and an API key from your model provider.

1. **Deploy the Worker**
   ```bash
   cd worker
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY     # paste the key at the prompt — never in git/chat/website
   npx wrangler secret put APP_TOKEN             # optional but recommended: an access code you invent (stops strangers spending your credits)
   npx wrangler deploy                           # prints https://garhi-api.<subdomain>.workers.dev
   ```
   Edit `worker/wrangler.toml` `[vars]` if your Pages URL differs (`ALLOWED_ORIGIN`, `KNOWLEDGE_URL`) or to change `ANTHROPIC_MODEL`.
2. **Check it:** `curl https://garhi-api.<subdomain>.workers.dev/api/health` → `{"ok":true,"aiConfigured":true,…}` (this only shows a key is present, not that it is valid).
3. **Point the site at it:** GitHub repo → *Settings → Secrets and variables → Actions → **Variables*** → add `GARHI_API_URL` = the Worker URL (a public URL, not a secret).
4. **Enable Pages:** *Settings → Pages → Source: **GitHub Actions***, then push to `main` (workflow: `.github/workflows/pages.yml`). Site: `https://mogrmnet.github.io/XBoot/`.
5. **First real test:** open the site → Settings → enter the access code (if you set `APP_TOKEN`) → ask *"العميل عايز Early Renewal"*. Confirm you get a streamed answer with sources. Only then is the AI actually working.

Without step 1–3 the site still opens and shows an honest "AI not configured" message; local reference search stays available and is labelled as search, not AI.

## Local development (no install needed)
```bash
node scripts/serve.mjs 8000                        # static site only
ANTHROPIC_API_KEY=… node scripts/serve.mjs 8000 --with-worker   # site + Worker at /api on one origin
# then Settings → API URL = http://localhost:8000
```

## Tests
```bash
npm test                 # 33 unit tests, zero dependencies (retrieval, Arabic, follow-ups, context-leak, quiz, worker, CORS, errors, injection, rendering, secrets)
npm run scan:secrets     # fails on key-like strings, .env/.dev.vars, PDFs
npm run build            # → dist/ (public allow-list only; verifies relative asset paths)
# browser checks (need Playwright + Chromium):
PLAYWRIGHT_BROWSERS_PATH=… node scripts/e2e.mjs          # full UI flow; provider is MOCKED
PLAYWRIGHT_BROWSERS_PATH=… node scripts/pages-check.mjs  # dist works under /XBoot/
```

## Security & privacy
- Provider key exists only as a Worker secret. Frontend/config/repo contain none (enforced by `scan-secrets` in CI).
- Worker: size limits (6k chars/message, 30k total), role validation, per-IP rate limit (best-effort per isolate — add a Cloudflare Rate Limiting rule for a hard limit), CORS allow-list, optional `APP_TOKEN`, 90 s timeout, logs HTTP status only (never message content).
- Documents and user text are **data**: tags that could close the evidence block are stripped, and the system prompt tells the model to ignore instructions found in them.
- Rendering escapes all HTML; Latin runs (SR paths, IDs, IPs) are direction-isolated.
- Chat history and uploaded files live in **this browser** (localStorage/IndexedDB) — not secure storage. Don't enter customer data. Uploaded excerpts are sent to the Worker/provider only with a question and can be switched off in Settings.
- Never commit `tech.pdf` or other internal material to a public repo (`.gitignore` blocks PDFs).

## Files
`index.html`, `style.css`, `config.js` (generated at deploy) · `js/` (`app` UI, `api` SSE client, `retrieval` shared with the Worker, `quiz`, `render`, `ingest`) · `worker/` · `knowledge.json` · `tests/` · `scripts/` · `.github/workflows/pages.yml`
