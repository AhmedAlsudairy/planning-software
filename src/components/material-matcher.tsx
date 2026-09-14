"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronDown, Clipboard, CloudUpload, Database, Download, FileSpreadsheet, LoaderCircle, Printer, Search, ShieldCheck, Sparkles, TriangleAlert, X } from "lucide-react";
import type { MaterialAttributes, MaterialMatch, SearchResponse, UploadSummary } from "@/types/material";

interface Stats {
  configured: boolean;
  materials: number;
  active: number;
  lastUpload: { file_name: string; created_at: string } | null;
  error?: string;
}

const EXAMPLE = "VALVE, BUTTERFLY, DN300, PN10, WAFER, EN593, BODY: CI, DISC/STEM: SS, EPDM, FF: 78MM";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function AttributePills({ attributes }: { attributes: MaterialAttributes }) {
  const values = [attributes.itemType, attributes.subtype, attributes.sizeDisplay, attributes.pressureClass, attributes.connection, attributes.faceToFaceMm == null ? null : `FF ${attributes.faceToFaceMm}MM`, ...attributes.materials, ...attributes.standards].filter(Boolean);
  return <div className="flex flex-wrap gap-2">{values.map((value, index) => <span key={`${value}-${index}`} className="rounded-md border border-emerald-900/10 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">{value}</span>)}</div>;
}

function confidenceTone(value: number): string {
  if (value >= 85) return "bg-emerald-500 text-white";
  if (value >= 65) return "bg-amber-400 text-amber-950";
  return "bg-rose-500 text-white";
}

function MatchCard({ match }: { match: MaterialMatch }) {
  const [copied, setCopied] = useState(false);
  const copySap = async () => {
    await navigator.clipboard.writeText(match.sapNo);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-emerald-800/30 hover:shadow-md print:break-inside-avoid">
      <div className="grid gap-5 p-5 lg:grid-cols-[72px_1fr_auto] lg:items-start">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-xl font-bold text-slate-500">#{match.rank}</div>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white">{match.className}</span>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{match.status}</span>
            <span className="text-xs text-slate-400">Plant {match.plant || "—"}</span>
          </div>
          <h3 className="text-lg font-bold tracking-tight text-slate-950">{match.shortDescription}</h3>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{match.longDescription}</p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span><span className="text-slate-400">Corporate</span> <strong className="ml-1 text-slate-800">{match.corporateNo}</strong></span>
            <button onClick={copySap} className="inline-flex items-center gap-1.5 text-left"><span className="text-slate-400">SAP</span> <strong className="font-mono text-slate-800">{match.sapNo}</strong>{copied ? <Check size={14} className="text-emerald-600" /> : <Clipboard size={14} className="text-slate-400" />}</button>
          </div>
        </div>
        <div className={`flex min-w-28 flex-col items-center rounded-xl px-4 py-3 ${confidenceTone(match.confidence)}`}>
          <strong className="text-2xl leading-none">{match.confidence}%</strong>
          <span className="mt-1 text-[11px] font-bold uppercase tracking-widest opacity-80">Match</span>
        </div>
      </div>
      <div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/70 text-center text-xs">
        <div className="px-3 py-3"><span className="block text-slate-400">Parametric</span><strong className="text-slate-800">{match.parametricScore}%</strong></div>
        <div className="border-x border-slate-200 px-3 py-3"><span className="block text-slate-400">Semantic</span><strong className="text-slate-800">{match.semanticScore}%</strong></div>
        <div className="px-3 py-3"><span className="block text-slate-400">Lexical</span><strong className="text-slate-800">{match.lexicalScore}%</strong></div>
      </div>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
          Attribute comparison
          <ChevronDown size={18} className="transition group-open:rotate-180" />
        </summary>
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Parameter</th><th className="px-5 py-3">Query</th><th className="px-5 py-3">Candidate</th><th className="px-5 py-3">Result</th></tr></thead>
            <tbody>{match.comparisons.map((item) => <tr key={item.key} className="border-t border-slate-100"><td className="px-5 py-3 font-semibold text-slate-700">{item.label}</td><td className="px-5 py-3 text-slate-600">{item.query}</td><td className="px-5 py-3 text-slate-600">{item.candidate}</td><td className="px-5 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${item.state === "exact" ? "bg-emerald-100 text-emerald-800" : item.state === "compatible" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"}`}>{item.state === "exact" ? <Check size={12} /> : item.state === "compatible" ? <TriangleAlert size={12} /> : <X size={12} />}{item.state}</span></td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export default function MaterialMatcher() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<Stats>({ configured: false, materials: 0, active: 0, lastUpload: null });
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");

  const loadStats = async () => {
    try {
      const response = await fetch("/api/stats", { cache: "no-store" });
      setStats(await response.json());
    } catch {
      setStats((current) => ({ ...current, error: "Status unavailable" }));
    }
  };

  useEffect(() => {
    let active = true;
    fetch("/api/stats", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => { if (active) setStats(data); })
      .catch(() => { if (active) setStats((current) => ({ ...current, error: "Status unavailable" })); });
    return () => { active = false; };
  }, []);

  const chooseFile = (selected?: File) => {
    if (!selected) return;
    if (!/\.(xlsx|csv)$/i.test(selected.name)) return setError("Choose an .xlsx or .csv file");
    setError("");
    setFile(selected);
    setUploadSummary(null);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      setUploadSummary(data);
      await loadStats();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const search = async () => {
    if (query.trim().length < 3) return setError("Enter a material specification");
    setSearching(true);
    setError("");
    setResults(null);
    try {
      const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit: 5 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");
      setResults(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const exportResults = async () => {
    if (!results) return;
    const response = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: results.query, matches: results.matches }) });
    if (!response.ok) return setError("Export failed");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `material-matches-${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-[#f4f6f4] text-slate-900">
      <header className="border-b border-white/10 bg-[#0e2823] text-white print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 text-emerald-950"><Sparkles size={21} /></div><div><div className="text-sm font-bold tracking-tight">Material Match AI</div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">SAP Intelligence</div></div></div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-emerald-100"><span className={`h-2 w-2 rounded-full ${stats.configured && !stats.error ? "bg-emerald-400" : "bg-amber-400"}`} />{stats.configured ? `${formatNumber(stats.active)} active records` : "Neon setup required"}</div>
        </div>
      </header>

      <section className="bg-[#0e2823] px-5 pb-28 pt-14 text-white print:hidden lg:px-8">
        <div className="mx-auto max-w-7xl"><div className="max-w-3xl"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-emerald-300"><ShieldCheck size={14} />Engineering-aware matching</div><h1 className="text-4xl font-bold leading-tight tracking-[-0.04em] sm:text-5xl">Find the right material code.<br/><span className="text-emerald-300">With evidence, not guesses.</span></h1><p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">Upload your SAP material master, describe the target specification, and compare ranked candidates across dimensions, pressure, connection, materials, standards, and meaning.</p></div></div>
      </section>

      <div className="mx-auto -mt-16 max-w-7xl space-y-6 px-5 pb-16 print:mt-0 print:px-0 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] print:hidden">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
            <div className="mb-4 flex items-center justify-between"><div><span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Step 01</span><h2 className="mt-1 text-xl font-bold">Material database</h2></div><Database className="text-slate-300" /></div>
            <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }} onClick={() => inputRef.current?.click()} className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-400 hover:bg-slate-50"}`}>
              <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0])} />
              <CloudUpload className="mx-auto text-emerald-700" size={30} /><p className="mt-3 text-sm font-bold">Drop Excel or CSV here</p><p className="mt-1 text-xs text-slate-400">Maximum 25 MB · up to 50,000 rows</p>
            </div>
            {file && <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-3"><FileSpreadsheet className="text-emerald-700" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.name}</p><p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p></div><button onClick={(event) => { event.stopPropagation(); setFile(null); setUploadSummary(null); }} className="rounded-lg p-2 hover:bg-slate-200"><X size={16} /></button></div>}
            <button onClick={upload} disabled={!file || uploading || !stats.configured} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-bold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-40">{uploading ? <LoaderCircle className="animate-spin" size={17} /> : <CloudUpload size={17} />}{uploading ? "Parsing and importing…" : "Import material master"}</button>
            {uploadSummary && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><div className="flex items-center gap-2 font-bold"><Check size={17} />Import complete</div><div className="mt-2 grid grid-cols-3 gap-2 text-center"><div><strong className="block">{formatNumber(uploadSummary.importedRows)}</strong><span className="text-xs">Rows</span></div><div><strong className="block">{formatNumber(uploadSummary.uniqueMaterials)}</strong><span className="text-xs">Unique</span></div><div><strong className="block">{formatNumber(uploadSummary.activeRows)}</strong><span className="text-xs">Active</span></div></div></div>}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-900/5">
            <div className="mb-4 flex items-center justify-between"><div><span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Step 02</span><h2 className="mt-1 text-xl font-bold">Target specification</h2></div><Search className="text-slate-300" /></div>
            <textarea value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe item type, size, pressure, connection, materials and standards…" className="h-36 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-600/10" />
            <div className="mt-3 flex items-center justify-between gap-4"><button onClick={() => setQuery(EXAMPLE)} className="text-left text-xs font-semibold text-emerald-700 hover:text-emerald-900">Use butterfly valve example</button><span className="text-xs text-slate-400">{query.length}/2,000</span></div>
            <button onClick={search} disabled={searching || query.trim().length < 3 || !stats.materials} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">{searching ? <LoaderCircle className="animate-spin" size={18} /> : <Sparkles size={18} />}{searching ? "Parsing and ranking candidates…" : "Find matching materials"}<ArrowRight size={17} /></button>
          </div>
        </section>

        {error && <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 print:hidden"><AlertCircle className="mt-0.5 shrink-0" size={18} /><div><strong className="block">Action required</strong>{error}</div></div>}
        {!stats.configured && <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 print:hidden"><TriangleAlert className="mt-0.5 shrink-0" size={18} /><div><strong className="block">Connect Neon to begin</strong>Add <code className="rounded bg-amber-100 px-1">DATABASE_URL</code> and <code className="rounded bg-amber-100 px-1">GEMINI_API_KEY</code> to <code className="rounded bg-amber-100 px-1">.env.local</code>, then restart the app.</div></div>}

        {results && <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="flex items-center gap-2"><h2 className="text-2xl font-bold tracking-tight">Top material matches</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{results.matches.length}</span></div><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">{results.query}</p><div className="mt-4"><AttributePills attributes={results.parsedQuery} /></div><p className="mt-3 text-xs text-slate-400">{results.semanticMode === "gemini" ? "Gemini semantic ranking" : "Lexical fallback"} · {results.elapsedMs.toLocaleString()} ms</p></div><div className="flex shrink-0 gap-2 print:hidden"><button onClick={() => window.print()} className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold hover:bg-slate-50"><Printer size={16} />PDF</button><button onClick={exportResults} className="flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-800"><Download size={16} />Excel</button></div></div>
            {results.warnings.map((warning) => <div key={warning} className="mt-3 flex items-center gap-2 text-xs text-amber-700"><TriangleAlert size={14} />{warning}</div>)}
          </div>
          {results.matches.length ? <div className="space-y-4">{results.matches.map((match) => <MatchCard key={match.id} match={match} />)}</div> : <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center"><AlertCircle className="mx-auto text-slate-300" size={36} /><h3 className="mt-4 font-bold">No eligible matches found</h3><p className="mt-1 text-sm text-slate-500">Try a broader item description or upload additional material records.</p></div>}
        </section>}
      </div>
    </main>
  );
}
