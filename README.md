# GARHI — WE Technical Copilot AI

A GitHub Pages-ready, Arabic RTL, responsive knowledge-search assistant branded with the **GARHI** watermark.

## What is included
- Searchable knowledge cards seeded from visible training notes in the uploaded 80-page `tech.pdf`.
- Arabic/English keyword search and a chat-style interface.
- Source-page references, case directory, category filters, local file import for TXT/JSON/CSV/MD, and dark/light mode.
- No API keys, no backend, and no connection to internal WE systems.

## Important accuracy note
The supplied PDF is image-based. The initial index is a curated partial summary of legible page captions and visible screenshots, not a complete OCR transcription of every page/menu. Results are explicitly labeled historical where appropriate. Verify current procedures, ticket paths, IVR numbers, and SLA values against current authorized material before using them operationally.

## Run locally
Open `index.html` in a browser. For fetch-based JSON loading, use a local static server, e.g. `python -m http.server 8000`, then open `http://localhost:8000`.

## Publish on GitHub Pages
1. Create a repository on GitHub.
2. Upload `index.html`, `style.css`, `app.js`, `knowledge.json`, and this README.
3. Go to **Settings → Pages**.
4. Choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
5. Wait for GitHub Pages to publish and use the URL shown in Settings → Pages.

## Private source material
Do not upload the original `tech.pdf` or internal company material to a public repository unless you have permission. The source PDF is intentionally not included in this project package. The current site shows page references, but does not claim to open the private source PDF online.

## AI integration
This static GitHub Pages build performs keyword retrieval from `knowledge.json`; it is not a generative AI model and does not connect to live WE systems. To add AI-generated answers safely, connect a server-side API or authorized serverless function and keep API credentials off the client. Pass retrieved evidence to the model and require source-grounded answers with abstention when evidence is missing.
