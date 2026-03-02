'use client'

import { useState } from 'react'

interface Report {
  id: string
  week_start: string
  week_end: string
  pdf_url: string | null
  metrics_snapshot: {
    rizzScore?: number
    stats?: { swipes?: number; matches?: number; dates?: number }
  }
  sent_at: string | null
  created_at: string
}

export default function ReportsList({ reports }: { reports: Report[] }) {
  const [generating, setGenerating] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        window.location.reload()
      }
    } catch (err) {
      console.error('Failed to generate report:', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
          Past Reports
        </h2>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {generating ? 'Generating...' : 'Generate This Week'}
        </button>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center">
          <p className="text-white/40 text-sm">
            No reports yet. Reports are generated weekly, or click the button above to generate one now.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-white text-sm font-medium">
                    {report.week_start} - {report.week_end}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    {report.metrics_snapshot?.rizzScore !== undefined && (
                      <span className="text-brand-400 text-xs">
                        Rizz: {report.metrics_snapshot.rizzScore}/100
                      </span>
                    )}
                    {report.metrics_snapshot?.stats?.matches !== undefined && (
                      <span className="text-white/30 text-xs">
                        {report.metrics_snapshot.stats.matches} matches
                      </span>
                    )}
                    {report.sent_at && (
                      <span className="text-green-400/50 text-xs">Emailed</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {report.pdf_url && (
                  <a
                    href={report.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-white/5 hover:bg-white/10 text-white/70 px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
                  >
                    Download PDF
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
