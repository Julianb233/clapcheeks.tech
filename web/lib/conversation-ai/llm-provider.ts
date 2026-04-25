/**
 * LLM provider abstraction. Routes to Ollama (free, local on Julian's Mac)
 * by default, with optional Anthropic fallback.
 *
 * Env:
 *   OLLAMA_URL          — base, e.g. https://ollama-macbook.aiacrobatics.com (no trailing slash)
 *   OLLAMA_MODEL        — default model, e.g. qwen2.5:7b
 *   OLLAMA_FAST_MODEL   — fast path model, e.g. llama3.2:3b
 *   OLLAMA_TIMEOUT_MS   — default 60000
 *   ANTHROPIC_API_KEY   — optional fallback
 *   LLM_PROVIDER        — 'ollama' (default) | 'anthropic'
 */

import Anthropic from '@anthropic-ai/sdk'

export type LLMProvider = 'ollama' | 'anthropic'

export interface ChatRequest {
  systemPrompt: string
  userPrompt: string
  json?: boolean
  maxTokens?: number
  temperature?: number
  /** Pick fast model when latency matters more than quality. */
  fast?: boolean
}

export interface ChatResponse {
  text: string
  provider: LLMProvider
  model: string
  durationMs: number
}

function pickProvider(): LLMProvider {
  const v = (process.env.LLM_PROVIDER || 'ollama').toLowerCase()
  return v === 'anthropic' ? 'anthropic' : 'ollama'
}

export async function chatComplete(req: ChatRequest): Promise<ChatResponse> {
  const provider = pickProvider()
  if (provider === 'ollama') {
    try {
      return await ollamaChat(req)
    } catch (e) {
      // If Anthropic is configured, fall back. Otherwise rethrow.
      if (process.env.ANTHROPIC_API_KEY) {
        console.warn('[llm] ollama failed, falling back to anthropic:', e instanceof Error ? e.message : e)
        return await anthropicChat(req)
      }
      throw e
    }
  }
  return await anthropicChat(req)
}

async function ollamaChat(req: ChatRequest): Promise<ChatResponse> {
  const base = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
  const model = req.fast
    ? (process.env.OLLAMA_FAST_MODEL || 'llama3.2:3b')
    : (process.env.OLLAMA_MODEL || 'qwen2.5:7b')
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || '60000')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
        stream: false,
        format: req.json ? 'json' : undefined,
        options: {
          temperature: req.temperature ?? 0.7,
          num_predict: req.maxTokens ?? 768,
        },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const data: { message?: { content?: string }; response?: string; error?: string } = await res.json()
    if (data.error) throw new Error(`Ollama error: ${data.error}`)
    const text = data.message?.content || data.response || ''
    return { text, provider: 'ollama', model, durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(t)
  }
}

async function anthropicChat(req: ChatRequest): Promise<ChatResponse> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set and Ollama unavailable')
  const model = 'claude-sonnet-4-6'
  const startedAt = Date.now()
  const anthropic = new Anthropic({ apiKey: key })
  const message = await anthropic.messages.create({
    model,
    max_tokens: req.maxTokens ?? 768,
    system: req.systemPrompt,
    messages: [{ role: 'user', content: req.userPrompt }],
    temperature: req.temperature ?? 0.7,
  })
  const text = message.content[0]?.type === 'text' ? message.content[0].text : ''
  return { text, provider: 'anthropic', model, durationMs: Date.now() - startedAt }
}

export function extractJsonArray<T = unknown>(text: string): T[] {
  // Try direct parse first.
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed as T[]
    // Some models wrap the array in {options: [...]} or {suggestions: [...]}.
    if (parsed && typeof parsed === 'object') {
      for (const key of ['options', 'suggestions', 'replies', 'items', 'data']) {
        const v = (parsed as Record<string, unknown>)[key]
        if (Array.isArray(v)) return v as T[]
      }
    }
  } catch {}
  // Fall back to regex match for the first array.
  const m = text.match(/\[[\s\S]*\]/)
  if (m) {
    try { return JSON.parse(m[0]) as T[] } catch {}
  }
  throw new Error(`Could not extract JSON array from response: ${text.slice(0, 300)}`)
}
