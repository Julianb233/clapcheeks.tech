'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PLAN_LIMITS, type PlanLevel } from '@/lib/plan'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

const PLATFORMS = [
  { id: 'tinder', name: 'Tinder', emoji: '🔥' },
  { id: 'bumble', name: 'Bumble', emoji: '🐝' },
  { id: 'hinge', name: 'Hinge', emoji: '💜' },
  { id: 'grindr', name: 'Grindr', emoji: '🟡' },
  { id: 'badoo', name: 'Badoo', emoji: '💬' },
  { id: 'happn', name: 'Happn', emoji: '📍' },
  { id: 'okcupid', name: 'OkCupid', emoji: '💘' },
  { id: 'pof', name: 'Plenty of Fish', emoji: '🐟' },
  { id: 'feeld', name: 'Feeld', emoji: '🌶️' },
  { id: 'cmb', name: 'Coffee Meets Bagel', emoji: '☕' },
]

const MODES = [
  {
    id: 'usb-iphone',
    title: 'USB iPhone',
    icon: '📱🔌',
    description: 'Connect your iPhone via USB cable. Agent controls apps directly.',
    pros: ['Fastest automation', 'Most reliable', 'All platforms supported'],
    cons: ['Requires Mac', 'Phone must stay connected'],
  },
  {
    id: 'wifi-iphone',
    title: 'WiFi iPhone',
    icon: '📱📶',
    description: 'Connect your iPhone over WiFi. Same control, no cable needed.',
    pros: ['No cable needed', 'Move freely', 'All platforms supported'],
    cons: ['Requires Mac', 'Slightly slower', 'Same network required'],
  },
  {
    id: 'cloud-browser',
    title: 'Mac Browser (Cloud)',
    icon: '☁️💻',
    description: 'Run everything in the cloud browser. No phone needed.',
    pros: ['No phone needed', 'Works on any device', 'Easiest setup'],
    cons: ['Web versions only', 'Some platforms limited'],
    recommended: true,
  },
]

const TERMINAL_LINES = [
  { text: '$ pip install clapcheeks[all]', delay: 0 },
  { text: 'Collecting clapcheeks[all]', delay: 600 },
  { text: '  Downloading clapcheeks-1.2.0-py3-none-any.whl (4.2 MB)', delay: 1200 },
  { text: 'Installing collected packages: clapcheeks', delay: 2000 },
  { text: 'Successfully installed clapcheeks-1.2.0', delay: 2600 },
  { text: '', delay: 3000 },
  { text: '$ clapcheeks setup', delay: 3400 },
  { text: '🔧 Configuring Clapcheeks AI Agent...', delay: 4000 },
  { text: '✓ API key validated', delay: 4600 },
  { text: '✓ Device connected', delay: 5200 },
  { text: '✓ Platforms detected: tinder, bumble, hinge', delay: 5800 },
  { text: '🚀 Setup complete! Run `clapcheeks start` to begin.', delay: 6400 },
]

interface OnboardingWizardProps {
  userId: string
  plan: string
}

export function OnboardingWizard({ userId, plan }: OnboardingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [selectedMode, setSelectedMode] = useState<string | null>(null)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const terminalStarted = useRef(false)

  const planLevel = (plan || 'free') as PlanLevel
  const limits = PLAN_LIMITS[planLevel] ?? PLAN_LIMITS.free
  const allowedPlatforms = limits.platforms

  const startTerminalAnimation = useCallback(() => {
    if (terminalStarted.current) return
    terminalStarted.current = true
    setTerminalLines([])
    TERMINAL_LINES.forEach(({ text, delay }) => {
      setTimeout(() => {
        setTerminalLines((prev) => [...prev, text])
      }, delay)
    })
  }, [])

  useEffect(() => {
    if (step === 4) {
      startTerminalAnimation()
    }
  }, [step, startTerminalAnimation])

  function togglePlatform(id: string) {
    if (!allowedPlatforms.includes(id)) return
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  async function completeOnboarding() {
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({
        onboarding_completed: true,
        selected_mode: selectedMode,
        selected_platforms: selectedPlatforms,
      })
      .eq('id', userId)
    router.push('/dashboard')
  }

  const progressValue = (step / 5) * 100

  return (
    <div className="flex min-h-screen flex-col" style={{ background: '#0a0a0f' }}>
      {/* Progress bar */}
      <div className="w-full px-6 pt-6">
        <div className="mx-auto max-w-2xl">
          <div className="mb-2 flex items-center justify-between text-sm text-gray-400">
            <span>Step {step} of 5</span>
            <span>{Math.round(progressValue)}%</span>
          </div>
          <Progress
            value={progressValue}
            className="h-2 bg-gray-800 [&>div]:bg-violet-500"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          {/* Step 1: Welcome */}
          {step === 1 && (
            <div className="text-center">
              <h1 className="mb-4 text-4xl font-bold text-white sm:text-5xl">
                Welcome to <span className="text-violet-400">Clapcheeks</span>
              </h1>
              <p className="mx-auto mb-8 max-w-md text-lg text-gray-400">
                Let&apos;s get you set up in 5 steps. Takes about 3 minutes.
              </p>
              <div className="mx-auto flex max-w-sm flex-col gap-3 text-left text-sm text-gray-300">
                <div className="flex items-center gap-3 rounded-lg border border-gray-800 p-3">
                  <span className="text-lg">1</span>
                  <span>Choose your connection mode</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-gray-800 p-3">
                  <span className="text-lg">2</span>
                  <span>Pick your dating platforms</span>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-gray-800 p-3">
                  <span className="text-lg">3</span>
                  <span>Install the agent</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Choose Mode */}
          {step === 2 && (
            <div>
              <h2 className="mb-2 text-center text-3xl font-bold text-white">
                Choose Your Mode
              </h2>
              <p className="mb-8 text-center text-gray-400">
                How do you want to connect the agent?
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.id)}
                    className={`relative rounded-xl border-2 p-5 text-left transition-all ${
                      selectedMode === mode.id
                        ? 'border-violet-500 bg-violet-500/10'
                        : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                    }`}
                  >
                    {mode.recommended && (
                      <span className="absolute -top-3 left-4 rounded-full bg-violet-500 px-2 py-0.5 text-xs font-medium text-white">
                        Recommended
                      </span>
                    )}
                    <div className="mb-3 text-3xl">{mode.icon}</div>
                    <h3 className="mb-1 text-lg font-semibold text-white">
                      {mode.title}
                    </h3>
                    <p className="mb-3 text-sm text-gray-400">{mode.description}</p>
                    <div className="mb-2">
                      {mode.pros.map((pro) => (
                        <div key={pro} className="text-xs text-green-400">
                          + {pro}
                        </div>
                      ))}
                    </div>
                    <div>
                      {mode.cons.map((con) => (
                        <div key={con} className="text-xs text-gray-500">
                          - {con}
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Pick Platforms */}
          {step === 3 && (
            <div>
              <h2 className="mb-2 text-center text-3xl font-bold text-white">
                Pick Your Platforms
              </h2>
              <p className="mb-8 text-center text-gray-400">
                Select the dating apps you use
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {PLATFORMS.map((platform) => {
                  const isAllowed = allowedPlatforms.includes(platform.id)
                  const isSelected = selectedPlatforms.includes(platform.id)
                  return (
                    <button
                      key={platform.id}
                      onClick={() => togglePlatform(platform.id)}
                      disabled={!isAllowed}
                      className={`relative rounded-xl border-2 p-4 text-center transition-all ${
                        isSelected
                          ? 'border-violet-500 bg-violet-500/10'
                          : isAllowed
                            ? 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                            : 'cursor-not-allowed border-gray-800/50 bg-gray-900/20 opacity-50'
                      }`}
                    >
                      {!isAllowed && (
                        <span className="absolute -top-2 right-2 rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          Upgrade
                        </span>
                      )}
                      <div className="mb-1 text-2xl">{platform.emoji}</div>
                      <div className="text-xs font-medium text-white">
                        {platform.name}
                      </div>
                    </button>
                  )
                })}
              </div>
              {planLevel === 'free' && (
                <p className="mt-4 text-center text-sm text-gray-500">
                  Free plan includes Tinder only.{' '}
                  <a href="/pricing" className="text-violet-400 underline">
                    Upgrade for more platforms
                  </a>
                </p>
              )}
            </div>
          )}

          {/* Step 4: Install */}
          {step === 4 && (
            <div>
              <h2 className="mb-2 text-center text-3xl font-bold text-white">
                Install the Agent
              </h2>
              <p className="mb-8 text-center text-gray-400">
                Run these commands to get started
              </p>

              <div className="mx-auto max-w-lg space-y-4">
                {/* Install command */}
                <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <code className="flex-1 text-sm text-green-400">
                    pip install clapcheeks[all]
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard('pip install clapcheeks[all]', 'install')}
                    className="shrink-0 text-gray-400 hover:text-white"
                  >
                    {copied === 'install' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>

                {/* Setup command */}
                <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 p-3">
                  <code className="flex-1 text-sm text-green-400">
                    clapcheeks setup
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard('clapcheeks setup', 'setup')}
                    className="shrink-0 text-gray-400 hover:text-white"
                  >
                    {copied === 'setup' ? 'Copied!' : 'Copy'}
                  </Button>
                </div>

                {/* Terminal animation */}
                <div className="rounded-lg border border-gray-800 bg-black p-4 font-mono text-xs">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-500" />
                    <span className="h-3 w-3 rounded-full bg-yellow-500" />
                    <span className="h-3 w-3 rounded-full bg-green-500" />
                    <span className="ml-2 text-gray-500">terminal</span>
                  </div>
                  <div className="h-52 overflow-y-auto">
                    {terminalLines.map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.startsWith('$')
                            ? 'text-green-400'
                            : line.startsWith('✓')
                              ? 'text-emerald-400'
                              : line.startsWith('🚀') || line.startsWith('🔧')
                                ? 'text-violet-400'
                                : 'text-gray-400'
                        }
                      >
                        {line || '\u00A0'}
                      </div>
                    ))}
                    {terminalLines.length < TERMINAL_LINES.length && (
                      <span className="inline-block h-4 w-2 animate-pulse bg-green-400" />
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setStep(5)}
                  className="mt-2 text-sm text-gray-500 underline hover:text-gray-300"
                >
                  Already installed? Skip this step
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 5 && (
            <div className="text-center">
              {/* CSS confetti burst */}
              <div className="pointer-events-none fixed inset-0 overflow-hidden">
                {Array.from({ length: 40 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute animate-bounce"
                    style={{
                      left: `${Math.random() * 100}%`,
                      top: `-10%`,
                      width: `${6 + Math.random() * 8}px`,
                      height: `${6 + Math.random() * 8}px`,
                      background: ['#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'][
                        Math.floor(Math.random() * 5)
                      ],
                      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                      animation: `confetti-fall ${2 + Math.random() * 3}s ease-in forwards`,
                      animationDelay: `${Math.random() * 1.5}s`,
                    }}
                  />
                ))}
              </div>

              <style jsx>{`
                @keyframes confetti-fall {
                  0% {
                    transform: translateY(0) rotate(0deg);
                    opacity: 1;
                  }
                  100% {
                    transform: translateY(110vh) rotate(${360 + Math.random() * 360}deg);
                    opacity: 0;
                  }
                }
              `}</style>

              <div className="mb-6 text-6xl">🎉</div>
              <h2 className="mb-2 text-3xl font-bold text-white">
                You&apos;re All Set!
              </h2>
              <p className="mb-8 text-gray-400">
                Here&apos;s a summary of your setup
              </p>

              <div className="mx-auto mb-8 max-w-sm space-y-3 text-left">
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                  <div className="mb-1 text-xs text-gray-500">Connection Mode</div>
                  <div className="text-white">
                    {MODES.find((m) => m.id === selectedMode)?.title ?? 'Not selected'}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                  <div className="mb-1 text-xs text-gray-500">Platforms</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedPlatforms.length > 0 ? (
                      selectedPlatforms.map((id) => {
                        const p = PLATFORMS.find((pl) => pl.id === id)
                        return (
                          <span
                            key={id}
                            className="rounded-full bg-violet-500/20 px-2 py-0.5 text-sm text-violet-300"
                          >
                            {p?.emoji} {p?.name}
                          </span>
                        )
                      })
                    ) : (
                      <span className="text-gray-500">None selected</span>
                    )}
                  </div>
                </div>
              </div>

              <Button
                onClick={completeOnboarding}
                disabled={saving}
                className="bg-violet-600 px-8 py-3 text-lg font-semibold text-white hover:bg-violet-500"
                size="lg"
              >
                {saving ? 'Saving...' : 'Go to Dashboard →'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation buttons */}
      {step < 5 && (
        <div className="border-t border-gray-800 px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="text-gray-400 hover:text-white"
            >
              Back
            </Button>
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 2 && !selectedMode}
              className="bg-violet-600 text-white hover:bg-violet-500"
            >
              {step === 1 ? "Let's Go" : 'Next'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
