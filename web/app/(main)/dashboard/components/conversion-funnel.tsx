'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

interface FunnelStep {
  stage: string
  value: number
}

interface ConversionFunnelProps {
  data: FunnelStep[]
}

const COLORS = ['#a855f7', '#c084fc', '#ec4899', '#f472b6']

export function ConversionFunnel({ data }: ConversionFunnelProps) {
  const withRates = data.map((step, i) => ({
    ...step,
    rate: i > 0 && data[i - 1].value > 0
      ? ((step.value / data[i - 1].value) * 100).toFixed(1) + '%'
      : '',
  }))

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5">
      <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
        Conversion Funnel
      </h2>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={withRates} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
            <XAxis
              type="number"
              tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
              axisLine={false} tickLine={false}
            />
            <YAxis
              type="category" dataKey="stage" width={100}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(0,0,0,0.9)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, color: '#fff', fontSize: 12,
              }}
              formatter={(value: number, _name: string, props: { payload?: { rate: string } }) => [
                `${value}${props.payload?.rate ? ` (${props.payload.rate})` : ''}`,
                'Count',
              ]}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {withRates.map((_entry, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
