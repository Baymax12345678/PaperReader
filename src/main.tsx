import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import "./styles.css";

type Author = {
  name: string;
};

type Paper = {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  venue?: string;
  publicationDate?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  authors?: Author[];
  url?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    PubMed?: string;
    CorpusId?: number;
  };
  openAccessPdf?: {
    url?: string;
  };
  tldr?: {
    text?: string;
  };
  relevanceScore?: number;
};

type SearchResponse = {
  total?: number;
  data?: Paper[];
  fallbackReason?: string;
};

type SortKey = "relevance" | "citations" | "time";

type PaperState = {
  paper_id: string;
  is_read: boolean;
  is_saved: boolean;
  is_dismissed: boolean;
  read_at?: string | null;
  saved_at?: string | null;
  dismissed_at?: string | null;
  updated_at?: string | null;
};

type StoredPaper = {
  title: string;
  abstract?: string | null;
  tldr?: string | null;
  venue?: string | null;
  year?: number | null;
  url?: string | null;
  publication_date?: string | null;
  authors_json?: Author[] | null;
  open_access_pdf?: string | null;
  doi?: string | null;
  arxiv_id?: string | null;
};

const PAGE_SIZE = 5;
const YEARS = Array.from({ length: 9 }, (_, index) => String(2022 + index));
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

const PRESET_VENUES = [
  "arXiv",
  "NeurIPS",
  "ICML",
  "ICLR",
  "ACL",
  "EMNLP",
  "CVPR",
  "ICCV",
  "ECCV",
  "SIGIR",
  "KDD",
  "WWW",
  "CHI",
  "AAAI",
  "IJCAI",
];

function App() {
  const [query, setQuery] = useState("test-time scaling");
  const [researchIntent, setResearchIntent] = useState("");
  const [selectedVenues, setSelectedVenues] = useState<string[]>(["arXiv", "NeurIPS", "ICML", "ICLR"]);
  const [venueDraft, setVenueDraft] = useState("");
  const [fromYear, setFromYear] = useState("2024");
  const [fromMonth, setFromMonth] = useState("01");
  const [toYear, setToYear] = useState("2026");
  const [toMonth, setToMonth] = useState("12");
  const [limit, setLimit] = useState("25");
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [page, setPage] = useState(1);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paperStates, setPaperStates] = useState<Record<string, PaperState>>({});
  const [hideRead, setHideRead] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  const sortedPapers = useMemo(() => {
    const cloned = [...papers];
    if (sortKey === "citations") {
      return cloned.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
    }
    if (sortKey === "time") {
      return cloned.sort((a, b) => getPaperTime(b) - getPaperTime(a));
    }
    return cloned;
  }, [papers, sortKey]);

  const displayPapers = useMemo(
    () =>
      sortedPapers.filter((paper) => {
        const state = paperStates[paper.paperId];
        if (state?.is_dismissed) return false;
        if (hideRead && state?.is_read) return false;
        return true;
      }),
    [hideRead, paperStates, sortedPapers],
  );

  const selectedPapers = useMemo(
    () => displayPapers.filter((paper) => selected.has(paper.paperId)),
    [displayPapers, selected],
  );
  const totalPages = Math.max(1, Math.ceil(displayPapers.length / PAGE_SIZE));
  const visiblePapers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return displayPapers.slice(start, start + PAGE_SIZE);
  }, [displayPapers, page]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setPaperStates({});
      setMemoryStatus("");
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void loadPaperStates(papers);
  }, [papers, session]);

  async function searchPapers() {
    setLoading(true);
    setError("");
    setImportStatus("");
    setSearchNotice("");
    setSelected(new Set());
    setPage(1);

    try {
      const params = new URLSearchParams({
        query: query.trim() || "*",
        limit,
      });
      if (researchIntent.trim()) params.set("context", researchIntent.trim());

      const { dateFrom, dateTo } = buildDateRange(`${fromYear}-${fromMonth}`, `${toYear}-${toMonth}`);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      selectedVenues.forEach((venue) => params.append("venue", venue));

      const response = await fetch(`/api/papers?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`论文源返回 ${response.status}。稍后重试，或减少筛选条件。`);
      }

      const json = (await response.json()) as SearchResponse;
      setPapers(json.data ?? []);
      setTotal(json.total ?? null);
      setSearchNotice(json.fallbackReason ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败。");
      setPapers([]);
      setTotal(null);
      setSearchNotice("");
    } finally {
      setLoading(false);
    }
  }

  function togglePaper(paperId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === displayPapers.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(displayPapers.map((paper) => paper.paperId)));
  }

  function toggleVenue(venue: string) {
    setPage(1);
    setSelectedVenues((current) =>
      current.includes(venue) ? current.filter((item) => item !== venue) : [...current, venue],
    );
  }

  function addVenue() {
    const nextVenue = venueDraft.trim();
    if (!nextVenue || selectedVenues.includes(nextVenue)) return;
    setSelectedVenues((current) => [...current, nextVenue]);
    setVenueDraft("");
  }

  function updateSortKey(value: SortKey) {
    setSortKey(value);
    setPage(1);
  }

  async function importSelectedToZotero() {
    const target = selectedPapers.length > 0 ? selectedPapers : displayPapers;
    setImporting(true);
    setImportStatus("");

    try {
      const response = await fetch("/api/zotero/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ papers: target }),
      });
      const json = (await response.json()) as { imported?: number; error?: string };

      if (!response.ok) {
        throw new Error(json.error || "导入 Zotero 失败。");
      }

      setImportStatus(`已发送 ${json.imported ?? target.length} 篇论文到 Zotero。`);
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "导入 Zotero 失败。请确认 Zotero 桌面端已打开。");
    } finally {
      setImporting(false);
    }
  }

  async function signIn() {
    if (!supabase) {
      setMemoryStatus("Supabase 尚未配置。请先填写 .env。");
      return;
    }
    if (!email.trim() || !password) {
      setMemoryStatus("请输入邮箱和密码。");
      return;
    }
    setAuthLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setMemoryStatus(signInError ? signInError.message : "已登录，阅读记忆会自动同步。");
    setAuthLoading(false);
  }

  async function signUp() {
    if (!supabase) {
      setMemoryStatus("Supabase 尚未配置。请先填写 .env。");
      return;
    }
    if (!email.trim() || !password) {
      setMemoryStatus("请输入邮箱和密码。");
      return;
    }
    if (password.length < 6) {
      setMemoryStatus("密码至少需要 6 位。");
      return;
    }
    setAuthLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (signUpError) {
      setMemoryStatus(signUpError.message);
    } else if (data.session) {
      setMemoryStatus("注册成功，已登录。");
    } else {
      setMemoryStatus("注册成功。若后台开启了邮箱确认，请先完成确认后再登录。");
    }
    setAuthLoading(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setPaperStates({});
  }

  async function loadPaperStates(targetPapers: Paper[]) {
    if (!supabase || !session || targetPapers.length === 0) return;
    const ids = [...new Set(targetPapers.map((paper) => paper.paperId))];
    const { data, error: stateError } = await supabase
      .from("user_paper_states")
      .select("paper_id,is_read,is_saved,is_dismissed,read_at,saved_at,dismissed_at,updated_at")
      .in("paper_id", ids);

    if (stateError) {
      setMemoryStatus(`读取阅读状态失败：${stateError.message}`);
      return;
    }

    setPaperStates((current) => {
      const next = { ...current };
      (data as PaperState[] | null)?.forEach((item) => {
        next[item.paper_id] = item;
      });
      return next;
    });
  }

  async function updatePaperState(paper: Paper, patch: Partial<PaperState>) {
    if (!supabase || !session) {
      setMemoryStatus("登录 Supabase 后才能同步已读和收藏状态。");
      return;
    }

    const now = new Date().toISOString();
    const current = paperStates[paper.paperId] ?? {
      paper_id: paper.paperId,
      is_read: false,
      is_saved: false,
      is_dismissed: false,
    };
    const next = {
      ...current,
      ...patch,
      updated_at: now,
    };

    const { error: paperError } = await supabase.from("papers").upsert(toPaperRecord(paper), { onConflict: "id" });
    if (paperError) {
      setMemoryStatus(`保存论文失败：${paperError.message}`);
      return;
    }

    const { error: stateError } = await supabase.from("user_paper_states").upsert(
      {
        user_id: session.user.id,
        paper_id: paper.paperId,
        is_read: next.is_read,
        is_saved: next.is_saved,
        is_dismissed: next.is_dismissed,
        read_at: next.is_read ? next.read_at || now : null,
        saved_at: next.is_saved ? next.saved_at || now : null,
        dismissed_at: next.is_dismissed ? next.dismissed_at || now : null,
        updated_at: now,
      },
      { onConflict: "user_id,paper_id" },
    );

    if (stateError) {
      setMemoryStatus(`保存阅读状态失败：${stateError.message}`);
      return;
    }

    setPaperStates((currentStates) => ({
      ...currentStates,
      [paper.paperId]: {
        ...next,
        read_at: next.is_read ? next.read_at || now : null,
        saved_at: next.is_saved ? next.saved_at || now : null,
        dismissed_at: next.is_dismissed ? next.dismissed_at || now : null,
      },
    }));
    setMemoryStatus("阅读状态已同步。");
  }

  async function recommendFromRecentReads() {
    if (!supabase || !session) {
      setMemoryStatus("登录 Supabase 后才能根据已读论文推荐。");
      return;
    }
    setRecommending(true);
    setError("");
    setImportStatus("");
    setSearchNotice("");
    setSelected(new Set());
    setPage(1);

    try {
      const { data: recentStates, error: recentError } = await supabase
        .from("user_paper_states")
        .select(
          "paper_id,papers(title,abstract,tldr,venue,year,url,publication_date,authors_json,open_access_pdf,doi,arxiv_id)",
        )
        .eq("is_read", true)
        .eq("is_dismissed", false)
        .order("read_at", { ascending: false })
        .limit(12);

      if (recentError) throw new Error(recentError.message);
      const recentPapers = ((recentStates ?? []) as unknown as Array<{
        paper_id: string;
        papers: StoredPaper | StoredPaper[] | null;
      }>).flatMap((item) => {
        const storedPaper = Array.isArray(item.papers) ? item.papers[0] : item.papers;
        return storedPaper ? [fromStoredPaper(item.paper_id, storedPaper)] : [];
      });
      if (recentPapers.length === 0) {
        setMemoryStatus("还没有已读论文。先标记几篇已读，再生成推荐。");
        return;
      }

      const recommendationQuery = buildRecommendationQuery(recentPapers);
      const params = new URLSearchParams({
        query: recommendationQuery,
        context: recentPapers.map((paper) => `${paper.title} ${paper.tldr?.text ?? ""}`).join(" "),
        limit,
      });
      const { dateFrom, dateTo } = buildDateRange(`${fromYear}-${fromMonth}`, `${toYear}-${toMonth}`);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      selectedVenues.forEach((venue) => params.append("venue", venue));

      const response = await fetch(`/api/papers?${params.toString()}`);
      if (!response.ok) throw new Error(`推荐检索返回 ${response.status}`);
      const json = (await response.json()) as SearchResponse;
      const { data: blockedStates } = await supabase
        .from("user_paper_states")
        .select("paper_id")
        .or("is_read.eq.true,is_dismissed.eq.true")
        .limit(1000);
      const blocked = new Set([
        ...recentPapers.map((paper) => normalizeText(paper.title)),
        ...((blockedStates ?? []) as Array<{ paper_id: string }>).map((state) => state.paper_id),
        ...Object.values(paperStates)
          .filter((state) => state.is_read || state.is_dismissed)
          .map((state) => state.paper_id),
      ]);
      const recommended = (json.data ?? []).filter(
        (paper) => !blocked.has(paper.paperId) && !blocked.has(normalizeText(paper.title)),
      );

      setQuery(recommendationQuery);
      setResearchIntent("根据最近已读论文自动推荐相似文献。");
      setPapers(recommended);
      setTotal(json.total ?? recommended.length);
      setSearchNotice(json.fallbackReason ?? "");
      setMemoryStatus(`已根据最近 ${recentPapers.length} 篇已读论文生成推荐。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "推荐失败。");
    } finally {
      setRecommending(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="toolbar">
        <div>
          <p className="eyebrow">PaperReader</p>
          <h1>论文搜索与 Zotero 导入助手</h1>
          <p className="subtitle">按主题、研究意图、会议集合和月份范围检索论文，筛出高相关结果后导入 Zotero。</p>
        </div>
        <div className="auth-panel">
          <span>{isSupabaseConfigured ? (session ? `已登录 ${session.user.email ?? ""}` : "登录后同步阅读记忆") : "未配置 Supabase"}</span>
          {session ? (
            <button onClick={signOut} type="button">
              退出
            </button>
          ) : (
            <div className="auth-form">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="邮箱"
                disabled={!isSupabaseConfigured}
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
                type="password"
                disabled={!isSupabaseConfigured}
              />
              <button onClick={signIn} disabled={!isSupabaseConfigured || authLoading} type="button">
                登录
              </button>
              <button className="secondary-auth" onClick={signUp} disabled={!isSupabaseConfigured || authLoading} type="button">
                注册
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="workbench">
        <aside className="query-pane">
          <section className="search-panel" aria-label="论文搜索条件">
            <label className="field query-field">
              <span>研究主题 / 精确短语</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>

            <label className="field intent-field">
              <span>研究意图 / 推荐说明</span>
              <textarea
                value={researchIntent}
                onChange={(event) => setResearchIntent(event.target.value)}
                placeholder="描述你的研究背景、参考论文和筛选偏好。例如：关注 LLM reasoning 中的 test-time compute，希望找到与 nabla-reasoner 方法相近但技术路线不同的工作。"
              />
              <p className="field-hint">会抽取论文名、缩写和方向词，用于扩展检索与相关性排序。</p>
            </label>

            <div className="field venue-field">
              <span>会议 / 期刊</span>
              <div className="venue-chips">
                {PRESET_VENUES.map((item) => (
                  <button
                    className={selectedVenues.includes(item) ? "chip chip-active" : "chip"}
                    key={item}
                    onClick={() => toggleVenue(item)}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="venue-add">
                <input
                  value={venueDraft}
                  onChange={(event) => setVenueDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addVenue();
                  }}
                  placeholder="添加其他会议或期刊"
                />
                <button onClick={addVenue} type="button">
                  添加
                </button>
              </div>
              {selectedVenues.length > 0 ? (
                <div className="selected-strip">
                  {selectedVenues.map((item) => (
                    <button className="selected-chip" key={item} onClick={() => toggleVenue(item)} type="button">
                      {item} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="field-hint">未选择会议时会在全库搜索。</p>
              )}
            </div>

            <label className="field month-field">
              <span>起始月份</span>
              <div className="month-pair">
                <select value={fromYear} onChange={(event) => setFromYear(event.target.value)} aria-label="起始年份">
                  {YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}年
                    </option>
                  ))}
                </select>
                <select value={fromMonth} onChange={(event) => setFromMonth(event.target.value)} aria-label="起始月份">
                  {MONTHS.map((month) => (
                    <option key={month} value={month}>
                      {Number(month)}月
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="field month-field">
              <span>结束月份</span>
              <div className="month-pair">
                <select value={toYear} onChange={(event) => setToYear(event.target.value)} aria-label="结束年份">
                  {YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}年
                    </option>
                  ))}
                </select>
                <select value={toMonth} onChange={(event) => setToMonth(event.target.value)} aria-label="结束月份">
                  {MONTHS.map((month) => (
                    <option key={month} value={month}>
                      {Number(month)}月
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="field limit-field">
              <span>数量</span>
              <select value={limit} onChange={(event) => setLimit(event.target.value)}>
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>

            <label className="field sort-field">
              <span>排序</span>
              <select value={sortKey} onChange={(event) => updateSortKey(event.target.value as SortKey)}>
                <option value="relevance">按相关性排序</option>
                <option value="citations">按引用排序</option>
                <option value="time">按时间排序</option>
              </select>
            </label>

            <button className="primary" onClick={searchPapers} disabled={loading}>
              {loading ? "搜索中..." : "搜索论文"}
            </button>
          </section>
        </aside>

        <section className="results-pane" aria-label="论文搜索结果">
          <section className="results-header">
            <div>
              <strong>{displayPapers.length}</strong> 篇结果
              {displayPapers.length !== sortedPapers.length ? (
                <span className="muted"> / 已隐藏 {sortedPapers.length - displayPapers.length} 篇</span>
              ) : null}
              {total !== null ? (
                <span className="muted">
                  {" "}
                  / {searchNotice ? "回退全库匹配约" : "API 匹配约"} {total.toLocaleString()} 篇
                </span>
              ) : null}
            </div>
            <div className="result-controls">
              <label className="toggle-control">
                <input checked={hideRead} onChange={(event) => setHideRead(event.target.checked)} type="checkbox" />
                隐藏已读
              </label>
              <button onClick={recommendFromRecentReads} disabled={!session || recommending} type="button">
                {recommending ? "推荐中..." : "根据已读推荐"}
              </button>
              <button
                aria-label="直接发送论文条目到本地 Zotero"
                onClick={importSelectedToZotero}
                disabled={displayPapers.length === 0 || importing}
                title="需要本地 Zotero 桌面端正在运行"
              >
                {importing ? "导入中..." : "导入 Zotero"}
              </button>
              <button onClick={toggleAll} disabled={displayPapers.length === 0}>
                {displayPapers.length > 0 && selected.size === displayPapers.length ? "取消全选" : "全选"}
              </button>
            </div>
          </section>

          {error ? <div className="error">{error}</div> : null}
          {importStatus ? <div className="import-status">{importStatus}</div> : null}
          {memoryStatus ? <div className="memory-status">{memoryStatus}</div> : null}
          {searchNotice ? <div className="search-notice">{searchNotice}</div> : null}

          <section className="paper-list">
            {visiblePapers.map((paper) => (
              <article className="paper-card" key={paper.paperId}>
                <input
                  className="paper-check"
                  type="checkbox"
                  checked={selected.has(paper.paperId)}
                  onChange={() => togglePaper(paper.paperId)}
                  aria-label={`选择 ${paper.title}`}
                />
                <div className="paper-body">
                  <div className="paper-meta">
                    <span>{paper.publicationDate ?? paper.year ?? "未知日期"}</span>
                    <span>{paper.venue || "未知 venue"}</span>
                    <span>匹配度 {paper.relevanceScore ?? 0}</span>
                    <span>{paper.citationCount ?? 0} citations</span>
                    {paperStates[paper.paperId]?.is_read ? <span>已读</span> : null}
                    {paperStates[paper.paperId]?.is_saved ? <span>收藏</span> : null}
                  </div>
                  <h2>
                    {paper.url ? (
                      <a className="paper-title-link" href={paper.url} target="_blank" rel="noreferrer">
                        {paper.title}
                      </a>
                    ) : (
                      paper.title
                    )}
                  </h2>
                  <p className="authors">{formatAuthors(paper.authors)}</p>
                  {paper.tldr?.text ? <p className="tldr">{paper.tldr.text}</p> : null}
                  {paper.abstract ? <p className="abstract">{paper.abstract}</p> : null}
                  <div className="paper-links">
                    {paper.url ? (
                      <a href={paper.url} target="_blank" rel="noreferrer">
                        论文网页
                      </a>
                    ) : null}
                    {paper.externalIds?.DOI ? (
                      <a href={`https://doi.org/${paper.externalIds.DOI}`} target="_blank" rel="noreferrer">
                        DOI
                      </a>
                    ) : null}
                    {paper.openAccessPdf?.url ? (
                      <a href={paper.openAccessPdf.url} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    ) : null}
                  </div>
                  <div className="memory-actions">
                    <button
                      onClick={() =>
                        updatePaperState(paper, {
                          is_read: !paperStates[paper.paperId]?.is_read,
                          read_at: paperStates[paper.paperId]?.is_read ? null : new Date().toISOString(),
                        })
                      }
                      type="button"
                    >
                      {paperStates[paper.paperId]?.is_read ? "取消已读" : "标记已读"}
                    </button>
                    <button
                      onClick={() =>
                        updatePaperState(paper, {
                          is_saved: !paperStates[paper.paperId]?.is_saved,
                          saved_at: paperStates[paper.paperId]?.is_saved ? null : new Date().toISOString(),
                        })
                      }
                      type="button"
                    >
                      {paperStates[paper.paperId]?.is_saved ? "取消收藏" : "收藏"}
                    </button>
                    <button
                      onClick={() =>
                        updatePaperState(paper, {
                          is_dismissed: true,
                          dismissed_at: new Date().toISOString(),
                        })
                      }
                      type="button"
                    >
                      不感兴趣
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {!loading && displayPapers.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-content">
                  <div className="empty-copy">
                    <p className="empty-kicker">开始检索</p>
                    <h2>把研究问题写清楚，结果会更接近你想读的论文</h2>
                    <p>
                      左侧的精确短语适合放核心关键词，研究意图适合写背景、参考论文和偏好。系统会抽取论文名、缩写和方向词，再结合会议与月份范围排序。
                    </p>
                    <div className="guide-panel">
                      <div>
                        <strong>可以这样写</strong>
                        <p>“我最近在看 LLM reasoning，nabla-reasoner 的 test-time gradient 思路很有意思，想找相近但方法不同的工作。”</p>
                      </div>
                      <div>
                        <strong>也可以更开放</strong>
                        <p>“最近 VLA 有什么值得读的新工作？我更关心真实机器人操作、数据效率和泛化能力。”</p>
                      </div>
                    </div>
                    <div className="empty-summary">
                      <span>关键词：{query || "未设置"}</span>
                      {researchIntent ? <span>意图：{researchIntent}</span> : null}
                      <span>来源：{selectedVenues.length ? selectedVenues.join(" / ") : "全库"}</span>
                      <span>
                        时间：{fromYear}年{Number(fromMonth)}月 - {toYear}年{Number(toMonth)}月
                      </span>
                      <span>排序：{formatSortLabel(sortKey)}</span>
                    </div>
                    <div className="empty-steps">
                      <span>1. 调整左侧筛选</span>
                      <span>2. 点击搜索论文</span>
                      <span>3. 勾选后导入 Zotero</span>
                    </div>
                  </div>
                  <div className="empty-preview" aria-hidden="true">
                    <div className="preview-orbit">
                      <span>topic</span>
                      <span>intent</span>
                      <span>venue</span>
                    </div>
                    <div className="preview-card">
                      <div className="preview-meta">
                        <span>2025-01-31</span>
                        <span>匹配度</span>
                      </div>
                      <div className="preview-title"></div>
                      <div className="preview-line short"></div>
                      <div className="preview-line"></div>
                    </div>
                    <div className="preview-card">
                      <div className="preview-meta">
                        <span>arXiv</span>
                        <span>PDF</span>
                      </div>
                      <div className="preview-title medium"></div>
                      <div className="preview-line"></div>
                      <div className="preview-line short"></div>
                    </div>
                    <div className="preview-footer">
                      <span>上一页</span>
                      <strong>第 1 / 5 页</strong>
                      <span>下一页</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {sortedPapers.length > 0 ? (
            <nav className="pagination" aria-label="结果分页">
              <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
                上一页
              </button>
              <span>
                第 {page} / {totalPages} 页
              </span>
              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
              >
                下一页
              </button>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function buildDateRange(fromMonth: string, toMonth: string) {
  const dateFrom = fromMonth ? `${fromMonth}-01` : "";
  const dateTo = toMonth ? lastDayOfMonth(toMonth) : "";
  return { dateFrom, dateTo };
}

function toPaperRecord(paper: Paper) {
  return {
    id: paper.paperId,
    title: paper.title,
    normalized_title: normalizeText(paper.title),
    doi: paper.externalIds?.DOI ?? null,
    arxiv_id: paper.externalIds?.ArXiv ?? extractArxivId(paper),
    url: paper.url ?? null,
    venue: paper.venue ?? null,
    year: paper.year ?? null,
    publication_date: paper.publicationDate ?? null,
    abstract: paper.abstract ?? null,
    tldr: paper.tldr?.text ?? null,
    authors_json: paper.authors ?? [],
    open_access_pdf: paper.openAccessPdf?.url ?? null,
    updated_at: new Date().toISOString(),
  };
}

function fromStoredPaper(id: string, paper: StoredPaper): Paper {
  return {
    paperId: id,
    title: paper.title,
    abstract: paper.abstract ?? undefined,
    year: paper.year ?? undefined,
    venue: paper.venue ?? undefined,
    publicationDate: paper.publication_date ?? undefined,
    authors: paper.authors_json ?? [],
    url: paper.url ?? undefined,
    externalIds: {
      DOI: paper.doi ?? undefined,
      ArXiv: paper.arxiv_id ?? undefined,
    },
    openAccessPdf: {
      url: paper.open_access_pdf ?? undefined,
    },
    tldr: paper.tldr ? { text: paper.tldr } : undefined,
  };
}

function buildRecommendationQuery(recentPapers: Paper[]) {
  const text = recentPapers
    .map((paper) => [paper.title, paper.tldr?.text, paper.abstract, paper.venue].filter(Boolean).join(" "))
    .join(" ");
  const tokens = normalizeText(text)
    .split(" ")
    .filter((token) => token.length > 2 && !RECOMMENDATION_STOPWORDS.has(token));
  const counts = new Map<string, number>();
  tokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));

  const phrases = [
    "test-time compute",
    "test-time scaling",
    "llm reasoning",
    "vision-language-action",
    "robot manipulation",
    "retrieval augmented generation",
    "multimodal reasoning",
    "tool use",
    "self verification",
  ].filter((phrase) => normalizeText(text).includes(normalizeText(phrase)));

  const topTokens = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token);
  return [...phrases, ...topTokens].slice(0, 12).join(" ");
}

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractArxivId(paper: Paper) {
  const values = [paper.externalIds?.DOI, paper.url, paper.openAccessPdf?.url];
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/(?:arxiv[.:/]|abs\/|pdf\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

const RECOMMENDATION_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "large",
  "model",
  "models",
  "our",
  "paper",
  "show",
  "that",
  "the",
  "their",
  "this",
  "using",
  "via",
  "with",
]);

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return "";
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function getPaperTime(paper: Paper) {
  if (paper.publicationDate) {
    const parsed = Date.parse(paper.publicationDate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return paper.year ? Date.UTC(paper.year, 0, 1) : 0;
}

function formatSortLabel(sortKey: SortKey) {
  if (sortKey === "citations") return "按引用排序";
  if (sortKey === "time") return "按时间排序";
  return "按相关性排序";
}

function formatAuthors(authors?: Author[]) {
  if (!authors?.length) return "作者未知";
  if (authors.length <= 4) return authors.map((author) => author.name).join(", ");
  return `${authors.slice(0, 4).map((author) => author.name).join(", ")} 等 ${authors.length} 位作者`;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
