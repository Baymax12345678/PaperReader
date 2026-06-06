# PaperReader

PaperReader is a local paper discovery assistant for finding research papers by topic, research intent, venue, and month range. It can send selected papers directly to a local Zotero desktop client.

## Features

- Search papers with a precise topic phrase and a natural-language research intent.
- Filter by multiple venues such as arXiv, ICLR, NeurIPS, ICML, ACL, EMNLP, CVPR, and more.
- Filter by year and month range.
- Sort results by relevance, citations, or publication time.
- Open paper pages, DOI links, and PDFs from the result cards.
- Import selected results into a running local Zotero desktop app.
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

## Run in Development

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

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

