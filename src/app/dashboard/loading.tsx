export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-[#f4f6f4]">
      <div className="h-16 bg-[#0e2823]" />
      <div className="mx-auto max-w-7xl animate-pulse space-y-6 px-5 py-10 lg:px-8">
        <div className="h-28 rounded-2xl bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 rounded-2xl bg-white" />)}
        </div>
        <div className="grid gap-6 lg:grid-cols-2"><div className="h-96 rounded-2xl bg-white" /><div className="h-96 rounded-2xl bg-white" /></div>
      </div>
    </main>
  );
}
