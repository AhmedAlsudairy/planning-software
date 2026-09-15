import Link from "next/link";
import { Activity, AlertCircle, AlertTriangle, ArrowRight, BarChart3, BrainCircuit, CheckCircle2, CircleGauge, Database, FileSpreadsheet, Layers3, RefreshCw, Search, ShieldCheck, Sparkles, Warehouse, XCircle } from "lucide-react";
import type { DashboardAnalytics, DashboardInsight, DistributionItem, QualityMetric } from "@/types/dashboard";

function number(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function date(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Card({ label, value, detail, icon, tone = "emerald" }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: "emerald" | "blue" | "amber" | "slate" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className={`mb-5 grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}>{icon}</div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p><strong className="mt-2 block text-3xl tracking-[-0.04em] text-slate-950">{value}</strong><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></div>;
}

function Section({ title, subtitle, children, action }: { title: string; subtitle: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold tracking-tight text-slate-950">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p></div>{action}</div>{children}</section>;
}

function Bar({ value, color = "bg-emerald-500" }: { value: number; color?: string }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function DistributionBars({ items, color = "bg-emerald-500" }: { items: DistributionItem[]; color?: string }) {
  const largest = Math.max(...items.map((item) => item.count), 1);
  return <div className="space-y-4 p-5">{items.map((item) => <div key={item.label}><div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className="truncate font-semibold text-slate-700" title={item.label}>{item.label}</span><span className="shrink-0 font-mono text-xs text-slate-500">{number(item.count)} · {item.percentage}%</span></div><Bar value={(item.count / largest) * 100} color={color} /></div>)}</div>;
}

function QualityRow({ metric }: { metric: QualityMetric }) {
  const color = metric.percentage >= 75 ? "bg-emerald-500" : metric.percentage >= 40 ? "bg-amber-400" : "bg-rose-500";
  return <div className="grid grid-cols-[minmax(130px,1fr)_2fr_56px] items-center gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700">{metric.critical && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}{metric.label}</div><Bar value={metric.percentage} color={color} /><span className="text-right font-mono text-xs font-bold text-slate-600">{metric.percentage}%</span></div>;
}

function HeatCell({ value }: { value: number }) {
  const tone = value >= 70 ? "bg-emerald-100 text-emerald-800" : value >= 35 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700";
  return <span className={`inline-flex min-w-12 justify-center rounded-md px-2 py-1 font-mono text-[11px] font-bold ${tone}`}>{value}%</span>;
}

function InsightCard({ insight }: { insight: DashboardInsight }) {
  const config = {
    critical: { icon: <AlertCircle size={18} />, box: "border-rose-200 bg-rose-50", iconTone: "bg-rose-100 text-rose-700", value: "text-rose-700" },
    warning: { icon: <AlertTriangle size={18} />, box: "border-amber-200 bg-amber-50", iconTone: "bg-amber-100 text-amber-700", value: "text-amber-700" },
    positive: { icon: <CheckCircle2 size={18} />, box: "border-emerald-200 bg-emerald-50", iconTone: "bg-emerald-100 text-emerald-700", value: "text-emerald-700" },
    info: { icon: <Activity size={18} />, box: "border-blue-200 bg-blue-50", iconTone: "bg-blue-100 text-blue-700", value: "text-blue-700" },
  }[insight.severity];
  return <div className={`rounded-xl border p-4 ${config.box}`}><div className="flex items-start gap-3"><div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${config.iconTone}`}>{config.icon}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-bold text-slate-900">{insight.title}</h3><strong className={`font-mono text-sm ${config.value}`}>{insight.value}</strong></div><p className="mt-1 text-xs leading-5 text-slate-600">{insight.description}</p></div></div></div>;
}

function EmptyDashboard() {
  return <main className="grid min-h-screen place-items-center bg-[#f4f6f4] p-6"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><AlertCircle className="mx-auto text-amber-500" size={38} /><h1 className="mt-4 text-xl font-bold">Analytics unavailable</h1><p className="mt-2 text-sm leading-6 text-slate-500">Connect Neon and import a material workbook before opening the dashboard.</p><Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white">Go to material search <ArrowRight size={16} /></Link></div></main>;
}

export default function DashboardView({ data }: { data?: DashboardAnalytics }) {
  if (!data) return <EmptyDashboard />;
  const { summary } = data;
  const readinessColors: Record<string, string> = { Strong: "bg-emerald-500", Partial: "bg-amber-400", Sparse: "bg-rose-500" };
  return (
    <main className="min-h-screen bg-[#f4f6f4] text-slate-900">
      <header className="border-b border-white/10 bg-[#0e2823] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 text-emerald-950"><Sparkles size={21} /></div><div><div className="text-sm font-bold tracking-tight">Material Match AI</div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">SAP Intelligence</div></div></Link>
          <nav className="flex items-center rounded-xl border border-white/10 bg-white/5 p-1 text-xs font-bold"><Link href="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-300 hover:text-white"><Search size={14} />Search</Link><span className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-emerald-950"><BarChart3 size={14} />Dashboard</span></nav>
        </div>
      </header>

      <section className="border-b border-emerald-900/10 bg-[#0e2823] px-5 pb-24 pt-10 text-white lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 lg:flex-row lg:items-end"><div><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-emerald-300"><BrainCircuit size={14} />Deep data analysis</div><h1 className="text-4xl font-bold tracking-[-0.04em]">Material intelligence dashboard</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Operational coverage, master-data quality, search readiness, and prioritized actions across the complete uploaded dataset.</p></div><div className="flex items-center gap-3"><Link href="/dashboard" className="flex h-10 items-center gap-2 rounded-xl border border-white/15 px-3 text-xs font-bold text-slate-200 hover:bg-white/5"><RefreshCw size={14} />Refresh</Link><Link href="/" className="flex h-10 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-xs font-bold text-emerald-950 hover:bg-emerald-300"><Search size={14} />Find materials</Link></div></div>
      </section>

      <div className="mx-auto -mt-14 max-w-7xl space-y-6 px-5 pb-16 lg:px-8">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="Total imported" value={number(summary.totalRecords)} detail="Every row from the active workbook" icon={<Database size={20} />} tone="slate" />
          <Card label="Searchable" value={number(summary.searchableRecords)} detail={`${summary.searchableRate}% of imported records`} icon={<ShieldCheck size={20} />} />
          <Card label="Excluded" value={number(summary.excludedRecords)} detail="Deleted or deletion-staged records" icon={<XCircle size={20} />} tone="amber" />
          <Card label="Unique materials" value={number(summary.uniqueMaterials)} detail={`${number(summary.duplicateRows)} duplicate plant rows`} icon={<Layers3 size={20} />} tone="blue" />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card label="Final ERP codes" value={number(summary.numericSapRecords)} detail={`${Math.round((summary.numericSapRecords / Math.max(summary.totalRecords, 1)) * 1000) / 10}% use numeric SAP identifiers`} icon={<CheckCircle2 size={20} />} />
          <Card label="Provisional NIR" value={number(summary.provisionalSapRecords)} detail="Records awaiting or using provisional identifiers" icon={<Activity size={20} />} tone="amber" />
          <Card label="Repeated descriptions" value={number(summary.duplicateDescriptionRows)} detail={`${number(summary.duplicateDescriptionGroups)} exact-description groups`} icon={<Layers3 size={20} />} tone="blue" />
          <Card label="Description depth" value={`${number(summary.averageDescriptionLength)} chars`} detail={`${number(summary.datedRecords)} records have a usable created year`} icon={<FileSpreadsheet size={20} />} tone="slate" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Section title="Match readiness" subtitle="Weighted completeness across searchable records" action={<CircleGauge className="text-slate-300" size={22} />}>
            <div className="grid gap-6 p-5 sm:grid-cols-[150px_1fr] sm:items-center">
              <div className="relative mx-auto grid h-36 w-36 place-items-center rounded-full" style={{ background: `conic-gradient(#10b981 ${summary.matchReadiness}%, #e2e8f0 0)` }}><div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center"><div><strong className="block text-3xl tracking-tight">{summary.matchReadiness}%</strong><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Readiness</span></div></div></div>
              <div className="space-y-4">{data.readinessDistribution.map((item) => <div key={item.label}><div className="mb-1.5 flex justify-between text-sm"><span className="flex items-center gap-2 font-semibold"><span className={`h-2.5 w-2.5 rounded-full ${readinessColors[item.label] || "bg-slate-400"}`} />{item.label}</span><span className="font-mono text-xs text-slate-500">{number(item.count)} · {item.percentage}%</span></div><Bar value={item.percentage} color={readinessColors[item.label] || "bg-slate-400"} /></div>)}</div>
            </div>
          </Section>

          <Section title="Engineering attribute coverage" subtitle="Red dot marks attributes that materially affect matching confidence" action={<Activity className="text-slate-300" size={22} />}>
            <div className="grid gap-4 p-5 sm:grid-cols-2">{data.qualityMetrics.map((metric) => <QualityRow key={metric.key} metric={metric} />)}</div>
            <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Coverage is measured across {number(summary.searchableRecords)} searchable records. Missing values reduce confidence but are not reported as mismatches.</div>
          </Section>
        </section>

        <Section title="Priority analysis" subtitle="Deterministic findings generated from the current material master" action={<BrainCircuit className="text-slate-300" size={22} />}>
          <div className="grid gap-3 p-5 md:grid-cols-2">{data.insights.map((insight) => <InsightCard key={insight.title} insight={insight} />)}</div>
        </Section>

        <section className="grid gap-6 lg:grid-cols-3">
          <Section title="SAP code maturity" subtitle="Final ERP codes versus provisional identifiers" action={<CheckCircle2 className="text-slate-300" size={20} />}><DistributionBars items={data.sapMaturityDistribution} color="bg-emerald-500" /></Section>
          <Section title="Description richness" subtitle="Searchable records grouped by long-description length" action={<FileSpreadsheet className="text-slate-300" size={20} />}><DistributionBars items={data.descriptionLengthDistribution} color="bg-blue-500" /></Section>
          <Section title="Creation-year profile" subtitle={`Year extracted for ${number(summary.datedRecords)} rows`} action={<Activity className="text-slate-300" size={20} />}><DistributionBars items={data.createdYearDistribution} color="bg-violet-500" /></Section>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Section title="Common engineering gaps" subtitle="Most frequent combinations of absent matching attributes" action={<AlertTriangle className="text-slate-300" size={22} />}><DistributionBars items={data.missingPatterns} color="bg-rose-400" /><div className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500">These are descriptive gaps across mixed classes. A field may be irrelevant for some classes, so use the class matrix before deciding what to enrich.</div></Section>
          <Section title="Class attribute matrix" subtitle="Coverage within the 15 largest classes; use this to prioritize class-specific parsing" action={<Layers3 className="text-slate-300" size={22} />}>
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400"><tr><th className="px-4 py-3">Class</th><th className="px-3 py-3 text-right">Active</th><th className="px-3 py-3 text-center">Ready</th><th className="px-3 py-3 text-center">Size</th><th className="px-3 py-3 text-center">Pressure</th><th className="px-3 py-3 text-center">Connection</th><th className="px-3 py-3 text-center">MOC</th><th className="px-4 py-3 text-center">Standard</th></tr></thead><tbody>{data.classQuality.map((item) => <tr key={item.label} className="border-t border-slate-100"><td className="max-w-56 truncate px-4 py-3 font-semibold text-slate-700" title={item.label}>{item.label}</td><td className="px-3 py-3 text-right font-mono text-xs">{number(item.active)}</td><td className="px-3 py-3 text-center"><HeatCell value={item.readiness} /></td><td className="px-3 py-3 text-center"><HeatCell value={item.sizeCoverage} /></td><td className="px-3 py-3 text-center"><HeatCell value={item.pressureCoverage} /></td><td className="px-3 py-3 text-center"><HeatCell value={item.connectionCoverage} /></td><td className="px-3 py-3 text-center"><HeatCell value={item.materialCoverage} /></td><td className="px-4 py-3 text-center"><HeatCell value={item.standardCoverage} /></td></tr>)}</tbody></table></div>
          </Section>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <Section title="Status distribution" subtitle={`Why ${number(summary.searchableRecords)} of ${number(summary.totalRecords)} rows enter normal matching`} action={<ShieldCheck className="text-slate-300" size={22} />}><DistributionBars items={data.statusDistribution.slice(0, 10)} /></Section>
          <Section title="Largest material classes" subtitle="Volume and average readiness of the top 12 classes" action={<Layers3 className="text-slate-300" size={22} />}>
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400"><tr><th className="px-5 py-3">Class</th><th className="px-4 py-3 text-right">Rows</th><th className="px-4 py-3 text-right">Active</th><th className="px-5 py-3 text-right">Readiness</th></tr></thead><tbody>{data.classDistribution.map((item) => <tr key={item.label} className="border-t border-slate-100"><td className="max-w-64 truncate px-5 py-3 font-semibold text-slate-700" title={item.label}>{item.label}</td><td className="px-4 py-3 text-right font-mono text-xs">{number(item.count)}</td><td className="px-4 py-3 text-right font-mono text-xs text-emerald-700">{number(item.active || 0)}</td><td className="px-5 py-3"><div className="flex items-center justify-end gap-2"><div className="w-20"><Bar value={item.readiness || 0} color="bg-blue-500" /></div><span className="w-10 text-right font-mono text-xs">{item.readiness}%</span></div></td></tr>)}</tbody></table></div>
          </Section>
        </section>

        <Section title="Plant health analysis" subtitle="Search eligibility and average matching readiness by plant" action={<Warehouse className="text-slate-300" size={22} />}>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400"><tr><th className="px-5 py-3">Plant</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Searchable</th><th className="px-4 py-3 text-right">Excluded</th><th className="px-4 py-3 text-right">Eligibility</th><th className="px-5 py-3">Readiness</th></tr></thead><tbody>{data.plantHealth.map((item) => <tr key={item.label} className="border-t border-slate-100"><td className="px-5 py-3 font-bold text-slate-700">{item.label}</td><td className="px-4 py-3 text-right font-mono text-xs">{number(item.count)}</td><td className="px-4 py-3 text-right font-mono text-xs text-emerald-700">{number(item.searchable)}</td><td className="px-4 py-3 text-right font-mono text-xs text-rose-600">{number(item.excluded)}</td><td className="px-4 py-3 text-right"><HeatCell value={item.searchableRate} /></td><td className="px-5 py-3"><div className="flex items-center gap-2"><div className="w-full min-w-24"><Bar value={item.readiness} color="bg-blue-500" /></div><span className="w-12 text-right font-mono text-xs">{item.readiness}%</span></div></td></tr>)}</tbody></table></div>
        </Section>

        <section className="grid gap-6 lg:grid-cols-3">
          <Section title="Plant coverage" subtitle={`${summary.plants} plants represented`} action={<Warehouse className="text-slate-300" size={20} />}><DistributionBars items={data.plantDistribution.slice(0, 8)} color="bg-blue-500" /></Section>
          <Section title="Material types" subtitle="ERP type composition" action={<BarChart3 className="text-slate-300" size={20} />}><DistributionBars items={data.materialTypeDistribution.slice(0, 8)} color="bg-violet-500" /></Section>
          <Section title="Semantic coverage" subtitle="Gemini embeddings available for vector retrieval" action={<BrainCircuit className="text-slate-300" size={20} />}>
            <div className="p-5"><strong className="text-4xl tracking-[-0.04em]">{summary.embeddingCoverage}%</strong><p className="mt-2 text-sm text-slate-500">{number(summary.embeddedRecords)} of {number(summary.searchableRecords)} searchable records embedded</p><div className="mt-5"><Bar value={summary.embeddingCoverage} color="bg-violet-500" /></div><div className="mt-6 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">Embeddings are currently created and cached for shortlisted candidates. Full background indexing would improve semantic recall across the complete database.</div></div>
          </Section>
        </section>

        <Section title="Methodology and interpretation" subtitle="Definitions used by this dashboard" action={<CircleGauge className="text-slate-300" size={22} />}>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Searchable</p><p className="mt-2 text-sm leading-6 text-slate-600">All imported rows except statuses containing DELETED, RFD STAGED, or RFUD STAGED. Excluded rows remain stored for audit.</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Readiness</p><p className="mt-2 text-sm leading-6 text-slate-600">Weighted completeness: description 20%, item type 15%, size 15%, subtype 10%, pressure 10%, connection 10%, MOC 10%, standards 5%, actuation 5%.</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Repeated descriptions</p><p className="mt-2 text-sm leading-6 text-slate-600">Active records sharing the same trimmed, case-normalized long description of at least 10 characters. Review is required before calling them duplicates.</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Coverage caveat</p><p className="mt-2 text-sm leading-6 text-slate-600">Not every attribute applies to every class. Overall gaps guide investigation; class-level coverage should drive enrichment decisions.</p></div>
          </div>
        </Section>

        {data.upload && <section className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center"><div className="flex items-center gap-4"><div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><FileSpreadsheet size={22} /></div><div><p className="text-xs font-bold uppercase tracking-widest text-slate-400">Active data source</p><p className="mt-1 font-bold text-slate-800">{data.upload.fileName}</p><p className="mt-1 text-xs text-slate-500">Sheet {data.upload.sheetName} · imported {date(data.upload.createdAt)}</p></div></div><div className="text-left sm:text-right"><p className="font-mono text-sm font-bold">{number(data.upload.rowCount)} rows</p><p className="mt-1 text-xs text-slate-500">Analysis refreshed {date(data.generatedAt)}</p></div></section>}
      </div>
    </main>
  );
}
