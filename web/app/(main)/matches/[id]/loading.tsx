export default function Loading() {
  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 animate-pulse">
      <div className="max-w-5xl mx-auto">
        <div className="h-4 w-28 rounded bg-white/10 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="aspect-[4/5] rounded-2xl bg-white/5 border border-white/10" />
          <div className="space-y-4">
            <div className="h-10 w-3/4 rounded bg-white/10" />
            <div className="h-4 w-1/2 rounded bg-white/5" />
            <div className="h-16 rounded-xl bg-white/5" />
            <div className="h-24 rounded-xl bg-white/5" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 rounded-xl bg-white/5 border border-white/10" />
          ))}
        </div>
      </div>
    </div>
  )
}
