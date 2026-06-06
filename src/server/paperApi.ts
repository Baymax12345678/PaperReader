import type { IncomingMessage, ServerResponse } from "node:http";

type SemanticPaper = {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  venue?: string;
  publicationDate?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  authors?: Array<{ name: string }>;
  url?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    PubMed?: string;
    CorpusId?: number;
  };
  openAccessPdf?: { url?: string };
  tldr?: { text?: string };
  relevanceScore?: number;
};

type OpenAlexWork = {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  cited_by_count?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: {
    landing_page_url?: string;
    pdf_url?: string;
    raw_source_name?: string;
    source?: { display_name?: string };
  };
  open_access?: { oa_url?: string };
  abstract_inverted_index?: Record<string, number[]>;
};

type OpenAlexSource = {
  id: string;
  display_name: string;
};

type OpenReviewNote = {
  id: string;
  forum?: string;
  pdate?: number;
  cdate?: number;
  tmdate?: number;
  content?: {
    title?: { value?: string };
    abstract?: { value?: string };
    TLDR?: { value?: string };
    authors?: { value?: string[] };
    venue?: { value?: string };
    venueid?: { value?: string };
    pdf?: { value?: string };
    _bibtex?: { value?: string };
  };
};

const SEMANTIC_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "year",
  "venue",
  "publicationDate",
  "citationCount",
  "influentialCitationCount",
  "authors",
  "url",
  "externalIds",
  "openAccessPdf",
  "tldr",
].join(",");

const OPENALEX_SELECT = [
  "id",
  "doi",
  "title",
  "display_name",
  "publication_year",
  "publication_date",
  "authorships",
  "primary_location",
  "open_access",
  "cited_by_count",
  "abstract_inverted_index",
].join(",");

const VENUE_ALIASES: Record<string, string> = {
  neurips: "Neural Information Processing Systems",
  nips: "Neural Information Processing Systems",
  icml: "International Conference on Machine Learning",
  iclr: "International Conference on Learning Representations",
  acl: "Annual Meeting of the Association for Computational Linguistics",
  emnlp: "Empirical Methods in Natural Language Processing",
  cvpr: "Computer Vision and Pattern Recognition",
  iccv: "International Conference on Computer Vision",
  eccv: "European Conference on Computer Vision",
  sigir: "Special Interest Group on Information Retrieval",
  kdd: "Knowledge Discovery and Data Mining",
  www: "The Web Conference",
  chi: "Conference on Human Factors in Computing Systems",
  aaai: "AAAI Conference on Artificial Intelligence",
  ijcai: "International Joint Conference on Artificial Intelligence",
  arxiv: "arXiv",
};

const SOURCE_ID_ALIASES: Record<string, string[]> = {
  arxiv: ["https://openalex.org/S4306400194", "https://openalex.org/S4393918464"],
};

const OPENREVIEW_VENUES: Record<string, string> = {
  iclr: "ICLR.cc",
  neurips: "NeurIPS.cc",
  nips: "NeurIPS.cc",
  icml: "ICML.cc",
};

const OPENREVIEW_PAGE_OFFSETS = [0, 1000, 2000];

export async function handlePaperApi(request: IncomingMessage, response: ServerResponse) {
  if (request.url?.startsWith("/api/zotero/import")) {
    try {
      const body = (await readJsonBody(request)) as { papers?: SemanticPaper[] };
      const result = await importToZotero(body.papers ?? []);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 503, {
        error: error instanceof Error ? error.message : "无法连接 Zotero。",
      });
    }
    return true;
  }

  if (!request.url?.startsWith("/api/papers")) return false;

  try {
    const url = new URL(request.url, "http://localhost");
    const papers = await searchPapers(url.searchParams);
    sendJson(response, 200, papers);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Search failed",
    });
  }

  return true;
}

async function importToZotero(papers: SemanticPaper[]) {
  if (papers.length === 0) {
    throw new Error("没有可导入的论文。");
  }

  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:23119/connector/saveItems", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zotero-connector-api-version": "3",
      },
      body: JSON.stringify({
        sessionID: `paperreader-${Date.now()}`,
        uri: "http://localhost:5173/",
        items: papers.map(toZoteroItem),
      }),
    });
  } catch {
    throw new Error("无法连接本地 Zotero。请先打开 Zotero 桌面端，再重试导入。");
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Zotero 返回 ${response.status}。请确认 Zotero 桌面端已打开。`);
  }

  return {
    imported: papers.length,
  };
}

function toZoteroItem(paper: SemanticPaper) {
  return {
    itemType: "journalArticle",
    title: paper.title,
    creators: paper.authors?.map((author) => toZoteroCreator(author.name)) ?? [],
    date: paper.publicationDate || paper.year?.toString(),
    publicationTitle: paper.venue,
    DOI: paper.externalIds?.DOI,
    url: paper.url,
    abstractNote: paper.abstract,
    attachments: paper.openAccessPdf?.url
      ? [
          {
            title: "Full Text PDF",
            mimeType: "application/pdf",
            url: paper.openAccessPdf.url,
          },
        ]
      : [],
  };
}

function toZoteroCreator(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { creatorType: "author", lastName: name };
  }
  return {
    creatorType: "author",
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "",
  };
}

export async function searchPapers(params: URLSearchParams) {
  const query = buildSearchQuery(params);
  const rankingQuery = buildRankingQuery(params);
  const limit = parseLimit(params.get("limit"));
  const searchParams = withQuery(params, query);
  const openReviewPromise: Promise<PaperSearchResult> = searchOpenReview(searchParams).catch(() => ({
    total: 0,
    data: [] as SemanticPaper[],
  }));
  try {
    const semantic = await searchSemanticScholar(searchParams);
    const rankedSemantic = rankResponse(semantic, rankingQuery, limit);
    const openReview = await openReviewPromise;
    if (openReview.data.length > 0) {
      return rankResponse(
        {
          total: (semantic.total ?? 0) + openReview.total,
          data: [...(semantic.data ?? []), ...openReview.data],
        },
        rankingQuery,
        limit,
      );
    }
    if (rankedSemantic.data.length > 0 && (rankedSemantic.data[0]?.relevanceScore ?? 0) >= 90) {
      return rankedSemantic;
    }
  } catch {
    // Fall through to OpenAlex, which is slower but gives stricter venue/date filtering.
  }

  const openReview = await openReviewPromise;
  const openAlex = await searchOpenAlex(searchParams);
  if (openReview.data.length > 0 && openAlex.fallbackReason) {
    return rankResponse(openReview, rankingQuery, limit);
  }
  if (openReview.data.length > 0) {
    return rankResponse(
      {
        total: (openAlex.total ?? 0) + openReview.total,
        data: [...(openAlex.data ?? []), ...openReview.data],
        fallbackReason: openAlex.fallbackReason,
      },
      rankingQuery,
      limit,
    );
  }
  return rankResponse(openAlex, rankingQuery, limit);
}

async function searchSemanticScholar(params: URLSearchParams) {
  const query = params.get("query") || "*";
  const limit = parseLimit(params.get("limit"));
  const venues = parseVenues(params);
  const requests = venues.length > 0 ? venues : [""];
  const responses = await Promise.all(
    requests.slice(0, 8).map(async (venue) => {
    const upstream = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    upstream.searchParams.set("query", query);
    upstream.searchParams.set("fields", SEMANTIC_FIELDS);
    upstream.searchParams.set("limit", String(Math.min(75, Math.max(limit * 2, 25))));
    setIfPresent(upstream.searchParams, "year", buildYearParam(params));
    setIfPresent(upstream.searchParams, "venue", venue);

    const response = await fetch(upstream);
    if (!response.ok) {
      throw new Error(`Semantic Scholar ${response.status}`);
    }
    const json = (await response.json()) as { total?: number; data?: SemanticPaper[] };
      return {
        total: json.total ?? 0,
        data: filterByVenue(filterByDate(json.data ?? [], params), parseVenues(params)),
      };
    }),
  );

  return {
    total: responses.reduce((sum, item) => sum + item.total, 0),
    data: dedupePapers(responses.flatMap((item) => item.data)),
  };
}

async function searchOpenAlex(params: URLSearchParams): Promise<PaperSearchResult> {
  const query = params.get("query") || "";
  const venues = parseVenues(params);
  const limit = parseLimit(params.get("limit"));
  const dateFrom = params.get("dateFrom") || "";
  const dateTo = params.get("dateTo") || "";
  const venueTargets = venues.length > 0 ? venues : [""];
  const responses = await Promise.all(
    venueTargets.slice(0, 8).map(async (venue) => {
      const sources = venue ? await findOpenAlexSources(venue) : [];
      const preciseResponses =
        sources.length > 0
          ? await Promise.all(
              sources.map((source) => fetchOpenAlexWorks(query, venue, dateFrom, dateTo, limit, source.id)),
            )
          : [await fetchOpenAlexWorks(query, venue, dateFrom, dateTo, limit)];
      const precise = {
        total: preciseResponses.reduce((sum, item) => sum + item.total, 0),
        data: preciseResponses.flatMap((item) => item.data),
      };

    if (sources.length === 0 && venue && precise.data.length === 0) {
      const broad = await fetchOpenAlexWorks(query, venue, dateFrom, dateTo, limit);
        return {
          total: precise.total + broad.total,
          data: [...precise.data, ...broad.data],
        };
    }

      return precise;
    }),
  );

  const strict = {
    total: responses.reduce((sum, item) => sum + item.total, 0),
    data: dedupePapers(responses.flatMap((item) => item.data)),
  };

  if (venues.length === 0 || strict.data.length > 0) {
    return strict;
  }

  const fallback = await fetchOpenAlexWorks(query, "", dateFrom, dateTo, limit);
  return {
    ...fallback,
    fallbackReason: "所选会议在论文源中暂无严格匹配，已显示全库相关结果。很多热门方向会先以 arXiv/ACL/EMNLP 等来源出现，会议归属可能滞后更新。",
  };
}

async function fetchOpenAlexWorks(
  query: string,
  venue: string,
  dateFrom: string,
  dateTo: string,
  limit: number,
  sourceId?: string,
) {
  const upstream = new URL("https://api.openalex.org/works");

  upstream.searchParams.set("search", [query, sourceId ? "" : venue].filter(Boolean).join(" "));
  upstream.searchParams.set("per-page", String(Math.min(100, Math.max(limit * 2, 25))));
  upstream.searchParams.set("select", OPENALEX_SELECT);

  const filters = buildOpenAlexFilters(dateFrom, dateTo, sourceId);
  if (filters.length > 0) upstream.searchParams.set("filter", filters.join(","));

  const response = await fetch(upstream);
  if (!response.ok) {
    throw new Error(`OpenAlex ${response.status}`);
  }

  const json = (await response.json()) as { meta?: { count?: number }; results?: OpenAlexWork[] };
  return {
    total: json.meta?.count ?? 0,
    data: (json.results ?? []).map(mapOpenAlexWork),
  };
}

async function findOpenAlexSources(venue: string): Promise<OpenAlexSource[]> {
  const hardcoded = SOURCE_ID_ALIASES[venue.trim().toLowerCase()];
  if (hardcoded) {
    return hardcoded.map((id) => ({ id, display_name: venue }));
  }

  const query = VENUE_ALIASES[venue.trim().toLowerCase()] ?? venue;
  const upstream = new URL("https://api.openalex.org/sources");
  upstream.searchParams.set("search", query);
  upstream.searchParams.set("per-page", "1");
  upstream.searchParams.set("select", "id,display_name");

  const response = await fetch(upstream);
  if (!response.ok) return [];

  const json = (await response.json()) as { results?: OpenAlexSource[] };
  return json.results?.[0] ? [json.results[0]] : [];
}

function buildOpenAlexFilters(dateFrom: string, dateTo: string, sourceId?: string) {
  const filters: string[] = [];
  if (dateFrom) filters.push(`from_publication_date:${dateFrom}`);
  if (dateTo) filters.push(`to_publication_date:${dateTo}`);
  if (sourceId) filters.push(`primary_location.source.id:${sourceId.replace("https://openalex.org/", "")}`);
  return filters;
}

function mapOpenAlexWork(work: OpenAlexWork): SemanticPaper {
  return {
    paperId: work.id,
    title: work.title || work.display_name || "Untitled",
    abstract: restoreAbstract(work.abstract_inverted_index),
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name || work.primary_location?.raw_source_name,
    publicationDate: work.publication_date,
    citationCount: work.cited_by_count,
    authors: work.authorships
      ?.map((authorship) => ({ name: authorship.author?.display_name || "" }))
      .filter((author) => author.name),
    url: work.primary_location?.landing_page_url || work.id,
    externalIds: work.doi ? { DOI: work.doi.replace(/^https:\/\/doi.org\//i, "") } : undefined,
    openAccessPdf: { url: work.primary_location?.pdf_url || work.open_access?.oa_url },
  };
}

async function searchOpenReview(params: URLSearchParams) {
  const query = params.get("query") || "";
  const venues = parseVenues(params).filter((venue) => OPENREVIEW_VENUES[venue.trim().toLowerCase()]);
  if (venues.length === 0) return { total: 0, data: [] as SemanticPaper[] };

  const targets = buildOpenReviewTargets(venues, params);
  if (targets.length === 0) return { total: 0, data: [] as SemanticPaper[] };

  const [searched, scanned] = await Promise.all([
    searchOpenReviewByQuery(query, targets),
    scanOpenReviewVenues(targets),
  ]);
  const data = filterByVenue(filterByDate(dedupePapers([...searched, ...scanned]), params), venues);

  return {
    total: data.length,
    data,
  };
}

async function searchOpenReviewByQuery(query: string, targets: OpenReviewTarget[]) {
  const terms = buildOpenReviewSearchTerms(query);
  const responses = await Promise.all(
    terms.map(async (term) => {
      const upstream = new URL("https://api2.openreview.net/notes/search");
      upstream.searchParams.set("term", term);
      upstream.searchParams.set("limit", "100");
      const response = await fetch(upstream);
      if (!response.ok) return [] as SemanticPaper[];
      const json = (await response.json()) as { notes?: OpenReviewNote[] };
      return (json.notes ?? [])
        .filter((note) => openReviewTargetMatches(note, targets))
        .filter(isAcceptedOpenReviewNote)
        .map(mapOpenReviewNote);
    }),
  );

  return dedupePapers(responses.flat());
}

async function scanOpenReviewVenues(targets: OpenReviewTarget[]) {
  const requests = targets.flatMap((target) =>
    OPENREVIEW_PAGE_OFFSETS.map(async (offset) => {
      const upstream = new URL("https://api2.openreview.net/notes");
      upstream.searchParams.set("content.venueid", target.venueId);
      upstream.searchParams.set("limit", "1000");
      upstream.searchParams.set("offset", String(offset));

      const response = await fetch(upstream, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return [] as SemanticPaper[];
      const json = (await response.json()) as { notes?: OpenReviewNote[] };
      return (json.notes ?? []).filter(isAcceptedOpenReviewNote).map(mapOpenReviewNote);
    }),
  );

  const settled = await Promise.allSettled(requests);
  return dedupePapers(
    settled.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
  );
}

type OpenReviewTarget = {
  venue: string;
  year: number;
  venueId: string;
};

type PaperSearchResult = {
  total: number;
  data: SemanticPaper[];
  fallbackReason?: string;
};

function buildOpenReviewTargets(venues: string[], params: URLSearchParams): OpenReviewTarget[] {
  const years = buildYearRange(params);
  return venues.flatMap((venue) => {
    const prefix = OPENREVIEW_VENUES[venue.trim().toLowerCase()];
    if (!prefix) return [];
    return years.map((year) => ({
      venue,
      year,
      venueId: `${prefix}/${year}/Conference`,
    }));
  });
}

function buildYearRange(params: URLSearchParams) {
  const fromYear = Number(params.get("dateFrom")?.slice(0, 4) || params.get("year") || new Date().getFullYear());
  const toYear = Number(params.get("dateTo")?.slice(0, 4) || fromYear);
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear)) return [new Date().getFullYear()];
  const start = Math.min(fromYear, toYear);
  const end = Math.max(fromYear, toYear);
  return Array.from({ length: Math.min(4, end - start + 1) }, (_, index) => start + index);
}

function buildOpenReviewSearchTerms(query: string) {
  const terms = new Set<string>();
  const normalized = normalizeText(query);
  if (query.trim()) terms.add(query.trim());
  if (normalized.includes("test time scaling")) {
    terms.add("test-time");
    terms.add("test-time compute");
    terms.add("inference-time compute");
    terms.add("test-time gradient");
  }
  return [...terms].slice(0, 5);
}

function openReviewTargetMatches(note: OpenReviewNote, targets: OpenReviewTarget[]) {
  const venueId = note.content?.venueid?.value || "";
  const venue = note.content?.venue?.value || "";
  return targets.some((target) => venueId === target.venueId || isMainConferenceVenue(venue, target));
}

function isAcceptedOpenReviewNote(note: OpenReviewNote) {
  const venue = note.content?.venue?.value || "";
  return Boolean(note.content?.title?.value && venue && !/^submitted to /i.test(venue) && !/workshop/i.test(venue));
}

function isMainConferenceVenue(venue: string, target: OpenReviewTarget) {
  return new RegExp(`^${target.venue}\\s+${target.year}\\s+(Poster|Oral|Spotlight|Conference)$`, "i").test(venue);
}

function mapOpenReviewNote(note: OpenReviewNote): SemanticPaper {
  const venue = note.content?.venue?.value || "OpenReview";
  const timestamp = note.pdate || note.tmdate || note.cdate;
  const url = `https://openreview.net/forum?id=${note.forum || note.id}`;
  const pdfPath = note.content?.pdf?.value;

  return {
    paperId: `openreview:${note.id}`,
    title: note.content?.title?.value || "Untitled",
    abstract: note.content?.abstract?.value,
    year: extractYear(venue) || timestampToYear(timestamp),
    venue,
    publicationDate: timestampToDate(timestamp) || venueYearToDate(venue),
    citationCount: 0,
    authors: note.content?.authors?.value?.map((name) => ({ name })),
    url,
    openAccessPdf: {
      url: pdfPath ? new URL(pdfPath, "https://openreview.net").toString() : undefined,
    },
    tldr: note.content?.TLDR?.value ? { text: note.content.TLDR.value } : undefined,
  };
}

function timestampToDate(value?: number) {
  if (!value) return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

function timestampToYear(value?: number) {
  return timestampToDate(value) ? Number(timestampToDate(value)?.slice(0, 4)) : undefined;
}

function venueYearToDate(venue: string) {
  const year = extractYear(venue);
  return year ? `${year}-01-01` : undefined;
}

function extractYear(value: string) {
  const match = value.match(/\b(20\d{2})\b/);
  return match?.[1] ? Number(match[1]) : undefined;
}

function restoreAbstract(index?: Record<string, number[]>) {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    positions.forEach((position) => {
      words[position] = word;
    });
  }
  return words.filter(Boolean).join(" ");
}

function setIfPresent(params: URLSearchParams, key: string, value: string | null) {
  if (value) params.set(key, value);
}

function parseLimit(value: string | null) {
  const parsed = Number(value || 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(100, Math.max(1, parsed));
}

function buildSearchQuery(params: URLSearchParams) {
  const base = params.get("query")?.trim();
  const context = params.get("context") || "";
  const terms = extractResearchTerms(context);
  const pieces = [base && base !== "*" ? base : "", ...terms.slice(0, 8)].filter(Boolean);
  return pieces.length ? dedupeWords(pieces).join(" ") : "*";
}

function buildRankingQuery(params: URLSearchParams) {
  const base = params.get("query")?.trim();
  const context = params.get("context") || "";
  const terms = extractResearchTerms(context);
  const pieces = [base && base !== "*" ? base : "", ...terms, context].filter(Boolean);
  return pieces.length ? pieces.join(" ") : "*";
}

function withQuery(params: URLSearchParams, query: string) {
  const next = new URLSearchParams(params);
  next.set("query", query);
  return next;
}

function extractResearchTerms(value: string) {
  const terms = new Set<string>();
  const normalized = normalizeText(value);

  if (/(?:nabla[-\s]?reasoner|∇[-\s]?reasoner|\\nabla)/i.test(value)) {
    terms.add("nabla reasoner");
    terms.add("test-time gradient descent");
    terms.add("inference-time compute");
    terms.add("latent space reasoning");
  }

  if (/\bvla\b/i.test(value) || /vision[-\s]?language[-\s]?action/i.test(value)) {
    terms.add("vla");
    terms.add("vision-language-action");
    terms.add("vision language action");
    terms.add("robot manipulation");
    terms.add("embodied ai");
  }

  if (normalized.includes("llm reasoning")) {
    terms.add("llm reasoning");
    terms.add("reasoning large language models");
  }

  if (normalized.includes("test time scaling")) {
    terms.add("test-time scaling");
    terms.add("test-time compute");
    terms.add("inference-time compute");
  }

  const englishTokens = value.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? [];
  englishTokens
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2 && !RESEARCH_STOPWORDS.has(token))
    .slice(0, 10)
    .forEach((token) => terms.add(token));

  for (let index = 0; index < englishTokens.length - 1; index += 1) {
    const pair = `${englishTokens[index]} ${englishTokens[index + 1]}`.toLowerCase();
    if (!RESEARCH_PHRASE_STOPWORDS.some((word) => pair.includes(word))) {
      terms.add(pair);
    }
  }

  return [...terms];
}

function dedupeWords(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const RESEARCH_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "any",
  "are",
  "can",
  "for",
  "from",
  "have",
  "has",
  "interesting",
  "latest",
  "new",
  "paper",
  "papers",
  "recent",
  "recently",
  "recommend",
  "research",
  "some",
  "the",
  "this",
  "what",
  "with",
  "work",
  "works",
]);

const RESEARCH_PHRASE_STOPWORDS = ["recently in", "research work", "interesting recommend", "recommend some"];

function parseVenues(params: URLSearchParams) {
  const values = [...params.getAll("venue"), params.get("venues") || ""];
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildYearParam(params: URLSearchParams) {
  const fromYear = params.get("dateFrom")?.slice(0, 4) || "";
  const toYear = params.get("dateTo")?.slice(0, 4) || "";
  if (fromYear && toYear && fromYear !== toYear) return `${fromYear}-${toYear}`;
  return fromYear || toYear || params.get("year");
}

function filterByDate(papers: SemanticPaper[], params: URLSearchParams) {
  const from = params.get("dateFrom") || "";
  const to = params.get("dateTo") || "";
  if (!from && !to) return papers;

  return papers.filter((paper) => {
    const date = paper.publicationDate || (paper.year ? `${paper.year}-01-01` : "");
    if (!date) return true;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}

function filterByVenue(papers: SemanticPaper[], venues: string[]) {
  if (venues.length === 0) return papers;
  return papers.filter((paper) => venues.some((venue) => venueMatches(paper.venue || "", venue)));
}

function rankResponse(response: { total?: number; data?: SemanticPaper[]; fallbackReason?: string }, query: string, limit: number) {
  const ranked = dedupePapers(response.data ?? [])
    .map((paper) => ({ ...paper, relevanceScore: scorePaper(paper, query) }))
    .sort((a, b) => {
      if ((b.relevanceScore ?? 0) !== (a.relevanceScore ?? 0)) {
        return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
      }
      return (b.citationCount ?? 0) - (a.citationCount ?? 0);
    })
    .slice(0, limit);

  return {
    total: response.total ?? ranked.length,
    data: ranked,
    fallbackReason: response.fallbackReason,
  };
}

function scorePaper(paper: SemanticPaper, query: string) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  const phrase = normalizeText(query);
  const title = normalizeText(paper.title);
  const abstract = normalizeText([paper.tldr?.text, paper.abstract].filter(Boolean).join(" "));
  let score = 0;

  if (title.includes(phrase)) score += 120;
  if (abstract.includes(phrase)) score += 45;
  score += scoreQueryConcepts(phrase, `${title} ${abstract}`);

  const titleHits = tokens.filter((token) => title.includes(token)).length;
  const abstractHits = tokens.filter((token) => abstract.includes(token)).length;
  const titleTokenCount = Math.max(1, tokenize(paper.title).length);
  score += (titleHits / tokens.length) * 80;
  score += (abstractHits / tokens.length) * 25;
  score += (titleHits / titleTokenCount) * 40;
  if (titleHits === tokens.length) score += 50;
  if (abstractHits === tokens.length) score += 15;

  if (tokens.length > 1 && !title.includes(phrase) && titleHits < tokens.length) score -= 45;
  score += Math.min(12, Math.log10((paper.citationCount ?? 0) + 1) * 4);
  if (paper.openAccessPdf?.url) score += 3;
  return Math.max(0, Math.round(score));
}

function scoreQueryConcepts(phrase: string, text: string) {
  const concepts: string[] = [];

  if (phrase.includes("test time scaling")) {
    concepts.push(
      "inference time compute",
      "inference time scaling",
      "test time compute",
      "test time gradient",
      "test time training",
      "test time optimization",
    );
  }

  if (phrase.includes("nabla reasoner")) {
    concepts.push("test time gradient", "latent space", "inference time compute", "llm reasoning", "reasoning");
  }

  if (phrase.includes("vla") || phrase.includes("vision language action")) {
    concepts.push(
      "vision language action",
      "vision language model",
      "robot manipulation",
      "embodied",
      "robotics",
      "action model",
    );
  }

  return concepts.reduce((score, concept) => (text.includes(concept) ? score + 28 : score), 0);
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !["and", "the", "for", "with"].includes(token));
}

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupePapers(papers: SemanticPaper[]) {
  const byKey = new Map<string, SemanticPaper>();
  const keyAliases = new Map<string, string>();

  for (const paper of papers) {
    const keys = getDedupeKeys(paper);
    const existingKey = keys.map((key) => keyAliases.get(key) || key).find((key) => byKey.has(key));

    if (existingKey) {
      byKey.set(existingKey, mergePapers(byKey.get(existingKey)!, paper));
      keys.forEach((key) => keyAliases.set(key, existingKey));
      continue;
    }

    const primaryKey = keys[0] || paper.paperId;
    byKey.set(primaryKey, paper);
    keys.forEach((key) => keyAliases.set(key, primaryKey));
  }

  return [...byKey.values()];
}

function getDedupeKeys(paper: SemanticPaper) {
  const keys = new Set<string>();
  const doi = paper.externalIds?.DOI?.replace(/^https:\/\/doi.org\//i, "").toLowerCase();
  const arxivId = extractArxivId([paper.externalIds?.ArXiv, paper.externalIds?.DOI, paper.url, paper.openAccessPdf?.url]);
  const titleKey = normalizeText(paper.title);
  const year = paper.publicationDate?.slice(0, 4) || paper.year?.toString() || "";

  if (doi) keys.add(`doi:${doi}`);
  if (arxivId) keys.add(`arxiv:${arxivId}`);
  if (titleKey && year) keys.add(`title-year:${titleKey}:${year}`);
  if (titleKey) keys.add(`title:${titleKey}`);
  keys.add(`id:${paper.paperId}`);

  return [...keys];
}

function extractArxivId(values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/(?:arxiv[.:/]|abs\/|pdf\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return "";
}

function mergePapers(a: SemanticPaper, b: SemanticPaper): SemanticPaper {
  const preferred = paperCompleteness(b) > paperCompleteness(a) ? b : a;
  const fallback = preferred === a ? b : a;

  return {
    ...preferred,
    abstract: preferred.abstract || fallback.abstract,
    year: preferred.year || fallback.year,
    venue: preferVenue(preferred.venue, fallback.venue),
    publicationDate: preferred.publicationDate || fallback.publicationDate,
    citationCount: Math.max(preferred.citationCount ?? 0, fallback.citationCount ?? 0),
    influentialCitationCount: Math.max(preferred.influentialCitationCount ?? 0, fallback.influentialCitationCount ?? 0),
    authors: preferred.authors?.length ? preferred.authors : fallback.authors,
    url: preferUrl(preferred.url, fallback.url),
    externalIds: {
      ...(fallback.externalIds ?? {}),
      ...(preferred.externalIds ?? {}),
    },
    openAccessPdf: {
      url: preferred.openAccessPdf?.url || fallback.openAccessPdf?.url,
    },
    tldr: preferred.tldr?.text ? preferred.tldr : fallback.tldr,
  };
}

function paperCompleteness(paper: SemanticPaper) {
  return [
    paper.externalIds?.DOI,
    paper.openAccessPdf?.url,
    paper.abstract,
    paper.authors?.length,
    paper.url,
    paper.venue,
    paper.publicationDate,
  ].filter(Boolean).length;
}

function preferVenue(a?: string, b?: string) {
  if (!a) return b;
  if (!b) return a;
  if (/arxiv\.org/i.test(a) && /arxiv/i.test(b)) return a;
  if (/arxiv \(cornell university\)/i.test(a) && /arxiv\.org/i.test(b)) return b;
  return a.length <= b.length ? a : b;
}

function preferUrl(a?: string, b?: string) {
  if (!a) return b;
  if (!b) return a;
  if (/arxiv\.org\/abs\//i.test(a)) return a;
  if (/arxiv\.org\/abs\//i.test(b)) return b;
  return a;
}

function venueMatches(actual: string, requested: string) {
  const normalizedActual = normalizeText(actual);
  if (!normalizedActual) return false;
  const requestedAlias = VENUE_ALIASES[requested.trim().toLowerCase()] ?? requested;
  const normalizedRequested = normalizeText(requested);
  const normalizedAlias = normalizeText(requestedAlias);
  return (
    normalizedActual.includes(normalizedRequested) ||
    normalizedActual.includes(normalizedAlias) ||
    normalizedAlias.includes(normalizedActual)
  );
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}
