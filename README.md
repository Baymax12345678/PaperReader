# PaperReader

PaperReader is a local paper discovery assistant for finding research papers by topic, research intent, venue, and month range. It can send selected papers directly to a local Zotero desktop client.

## Features

- Search papers with a precise topic phrase and a natural-language research intent.
- Filter by multiple venues such as arXiv, ICLR, NeurIPS, ICML, ACL, EMNLP, CVPR, and more.
- Filter by year and month range.
- Sort results by relevance, citations, or publication time.
- Open paper pages, DOI links, and PDFs from the result cards.
- Import selected results into a running local Zotero desktop app.
- Sign in with Supabase to sync read / saved / dismissed paper states.
- Recommend similar papers from recently read papers.
- Use OpenReview metadata for ICLR / NeurIPS / ICML conference records, which helps catch accepted papers that are not yet correctly labeled in other paper indexes.

## Data Sources

PaperReader currently uses public paper metadata APIs:

- Semantic Scholar
- OpenAlex
- OpenReview
- Local Zotero Connector endpoint at `127.0.0.1:23119`

No paid API key is required for normal use. Public APIs may still rate-limit heavy usage.

## Requirements

- Node.js 20 or newer is recommended.
- npm
- Zotero desktop app, only required if you want direct Zotero import.

## Install

```bash
npm install
```

## Supabase Memory Setup

PaperReader can run without Supabase. Search and Zotero import still work, but read-state sync and recommendations from recently read papers are disabled.

To enable memory sync:

1. Create a free Supabase project.
2. Open the Supabase SQL editor.
3. Run the SQL in [supabase-schema.sql](./supabase-schema.sql).
4. Copy `.env.example` to `.env`.
5. Fill in your project URL and anon key:

   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

6. In Supabase, open **Authentication -> Providers -> Email** and make sure email/password sign-in is enabled.
7. Restart the dev server.

The app uses Supabase email/password auth. Use the top-right form to register once, then sign in with the same email and password. If you do not want registration to require email confirmation, turn off **Confirm email** in Supabase's Email provider settings.

## Run in Development

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

## Desktop App Trial

PaperReader also has an Electron desktop wrapper for local macOS testing.

Run the desktop app in development:

```bash
npm run electron:dev
```

Build a local macOS app:

```bash
npm run electron:app
```

The generated app is written to:

```text
release/PaperReader-darwin-arm64/PaperReader.app
```

This trial build is unsigned. macOS may show a security warning the first time it is opened. For now, the app is intended for local use and testing, not public distribution.

The desktop app bundles the frontend and starts a local backend inside Electron. Zotero import still talks to the local Zotero Connector at `127.0.0.1:23119`.

## Build and Run

```bash
npm run build
npm start
```

The production server defaults to:

```text
http://localhost:4173/
```

You can change the production port:

```bash
PORT=5173 npm start
```

## How to Search

Use the left panel:

1. Fill **Research Topic / Precise Phrase** with a compact keyword phrase, for example `test-time scaling`.
2. Optionally fill **Research Intent / Recommendation Note** with a more specific description, for example:

   ```text
   I am studying LLM reasoning and found nabla-reasoner interesting. Recommend related work with similar goals but different technical approaches.
   ```

3. Select one or more venues.
4. Choose the start and end month.
5. Choose result count and sort order.
6. Click search.

The research intent field is parsed for paper names, abbreviations, and research terms such as `LLM reasoning`, `VLA`, `vision-language-action`, `nabla-reasoner`, and `test-time compute`.

## Read Memory and Recommendations

After signing in with Supabase, each paper card can be marked as:

- Read
- Saved
- Not interested

You can also hide read papers from the current result list.

Click **Recommend from Read Papers** to generate a new query from your recent read history. PaperReader extracts terms from recently read titles, abstracts, TLDRs, and venues, calls the existing search pipeline, and filters out papers already marked as read or dismissed.

This feature stores only paper metadata and reading state. It does not upload PDFs.

## Zotero Import

To import results directly into Zotero:

1. Open Zotero desktop.
2. Search papers in PaperReader.
3. Select papers with the checkboxes, or leave all unchecked to import all current results.
4. Click **Import Zotero**.

PaperReader sends items to Zotero through the local connector endpoint:

```text
http://127.0.0.1:23119/connector/saveItems
```

If import fails, check:

- Zotero desktop is running.
- The local connector endpoint is reachable:

  ```text
  http://127.0.0.1:23119/connector/ping
  ```

## Notes

- Venue metadata can lag behind conference announcements in general paper indexes. PaperReader supplements ICLR / NeurIPS / ICML with OpenReview when available.
- Search results are ranked by a local relevance score after deduplication.
- Direct Zotero import is local only; it does not require Zotero cloud sync.
- Supabase is only used for read memory and recommendations. Public paper search APIs do not require paid keys.
