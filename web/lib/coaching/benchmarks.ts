// Research-backed dating performance benchmarks
export const MATCH_RATE_GOOD = 0.15 // 15% swipe-to-match
export const CONVERSATION_RATE_GOOD = 0.40 // 40% match-to-conversation
export const DATE_RATE_GOOD = 0.15 // 15% match-to-date
export const LIKE_RATIO_OPTIMAL = 0.25 // 25% right-swipe ratio
export const LIKE_RATIO_WARNING = 0.40 // above this, algorithm penalizes
export const GIF_RESPONSE_BOOST = 0.30 // 30% higher response rate
export const OPTIMAL_MESSAGES_BEFORE_DATE_ASK = 7

export interface PerformanceMetrics {
  matchRate: number
  conversationRate: number
  dateRate: number
  likeRatio: number
}

export interface BenchmarkComparison {
  metric: string
  userValue: number
  benchmark: number
  delta: number
  status: 'above' | 'below' | 'at'
}

export function calculatePerformanceScore(metrics: PerformanceMetrics): number {
  const matchComponent = Math.min(1, metrics.matchRate / MATCH_RATE_GOOD) * 35
  const convoComponent = Math.min(1, metrics.conversationRate / CONVERSATION_RATE_GOOD) * 25
  const dateComponent = Math.min(1, metrics.dateRate / DATE_RATE_GOOD) * 30
  const likeComponent = Math.min(1, metrics.likeRatio / LIKE_RATIO_OPTIMAL) * 10

  const raw = matchComponent + convoComponent + dateComponent + likeComponent
  return Math.round(Math.max(0, Math.min(100, raw)))
}

export function compareToBenchmarks(metrics: PerformanceMetrics): BenchmarkComparison[] {
  const comparisons: { key: keyof PerformanceMetrics; label: string; benchmark: number }[] = [
    { key: 'matchRate', label: 'Match Rate', benchmark: MATCH_RATE_GOOD },
    { key: 'conversationRate', label: 'Conversation Rate', benchmark: CONVERSATION_RATE_GOOD },
    { key: 'dateRate', label: 'Date Rate', benchmark: DATE_RATE_GOOD },
    { key: 'likeRatio', label: 'Like Ratio', benchmark: LIKE_RATIO_OPTIMAL },
  ]

  return comparisons.map(({ key, label, benchmark }) => {
    const userValue = metrics[key]
    const delta = userValue - benchmark
    const threshold = benchmark * 0.10

    let status: 'above' | 'below' | 'at'
    if (Math.abs(delta) <= threshold) {
      status = 'at'
    } else if (delta > 0) {
      status = 'above'
    } else {
      status = 'below'
    }

    return { metric: label, userValue, benchmark, delta, status }
  })
}

export function getPositiveInsights(metrics: PerformanceMetrics): string[] {
  const insights: string[] = []

  if (metrics.matchRate >= MATCH_RATE_GOOD) {
    insights.push(
      `Your match rate of ${(metrics.matchRate * 100).toFixed(1)}% beats the ${(MATCH_RATE_GOOD * 100).toFixed(0)}% benchmark -- your profile is working`
    )
  }

  if (metrics.conversationRate >= CONVERSATION_RATE_GOOD) {
    insights.push(
      `${(metrics.conversationRate * 100).toFixed(1)}% of your matches turn into conversations -- your openers are landing`
    )
  }

  if (metrics.dateRate >= DATE_RATE_GOOD) {
    insights.push(
      `You're converting ${(metrics.dateRate * 100).toFixed(1)}% of matches to dates -- above the ${(DATE_RATE_GOOD * 100).toFixed(0)}% top performer benchmark`
    )
  }

  if (metrics.likeRatio >= LIKE_RATIO_OPTIMAL * 0.9 && metrics.likeRatio <= LIKE_RATIO_WARNING) {
    insights.push(
      `Your like ratio of ${(metrics.likeRatio * 100).toFixed(0)}% is in the algorithmic sweet spot -- apps are boosting your profile`
    )
  }

  return insights
}
