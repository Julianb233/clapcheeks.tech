export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-black px-6 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-8">
          <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
          <div className="h-6 w-20 bg-white/5 rounded animate-pulse" />
        </div>

        {/* Badge skeleton */}
        <div className="h-7 w-40 bg-white/5 rounded-full animate-pulse mb-6" />

        {/* Title skeleton */}
        <div className="h-9 w-64 bg-white/10 rounded animate-pulse mb-2" />
        <div className="h-4 w-48 bg-white/5 rounded animate-pulse mb-8" />

        {/* Stats grid skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
              <div className="h-8 w-12 bg-white/10 rounded animate-pulse mx-auto mb-2" />
              <div className="h-3 w-20 bg-white/5 rounded animate-pulse mx-auto" />
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
          <div className="h-4 w-40 bg-white/10 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-20 bg-white/10 rounded animate-pulse" />
                <div className="flex gap-6">
                  <div className="h-4 w-16 bg-white/5 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-white/5 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
