'use client'

// AI-8762: Visual drip rules editor.
//
// Replaces the raw YAML textarea on /settings (Drip tab). Internally we
// keep a structured DripRulesModel; on every edit we serialize back to
// YAML and bubble that string up via onChange — the wire format
// (Supabase column `drip_rules_yaml`) is unchanged.

import { Trash2, Plus, AlertCircle, Code } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { defaultOpFor, defaultValueFor, operatorsFor } from '@/lib/drip-rules/expression'
import { parseDripYaml, serializeDripModel } from '@/lib/drip-rules/parser'
import {
  ACTION_NAMES,
  TERM_DEFS,
  type ActionName,
  type Condition,
  type Connector,
  type DripRulesModel,
  type Operator,
  type Rule,
  type Template,
  type TermName,
  type WhenExpr,
} from '@/lib/drip-rules/types'

type Props = {
  value: string
  onChange: (yaml: string) => void
}

export default function DripRuleBuilder({ value, onChange }: Props) {
  // We only re-parse the incoming YAML once on mount (or when the parent
  // resets us via a different YAML). Otherwise the visual edits become the
  // source of truth and we serialize down.
  const [model, setModel] = useState<DripRulesModel>(() => {
    const r = parseDripYaml(value)
    if (r.ok) return r.model
    return { templates: [], rules: [] }
  })
  const [parseError, setParseError] = useState<string | null>(() => {
    const r = parseDripYaml(value)
    return r.ok ? null : r.error
  })
  const [showRaw, setShowRaw] = useState<boolean>(() => !parseDripYaml(value).ok)
  const [rawValue, setRawValue] = useState<string>(value)

  // Track the last YAML we emitted so we don't fight the parent's state.
  const lastEmittedRef = useRef<string>(value)

  // If the parent feeds us a totally different YAML (e.g. user discarded
  // changes server-side), re-parse. Don't re-parse our own emissions.
  useEffect(() => {
    if (value === lastEmittedRef.current) return
    const r = parseDripYaml(value)
    if (r.ok) {
      setModel(r.model)
      setParseError(null)
      setShowRaw(false)
    } else {
      setParseError(r.error)
      setShowRaw(true)
      setRawValue(value)
    }
    lastEmittedRef.current = value
  }, [value])

  // When the structured model changes, serialize and bubble up.
  function commitModel(next: DripRulesModel) {
    setModel(next)
    const yamlOut = serializeDripModel(next)
    lastEmittedRef.current = yamlOut
    setRawValue(yamlOut)
    onChange(yamlOut)
  }

  function commitRaw(nextRaw: string) {
    setRawValue(nextRaw)
    lastEmittedRef.current = nextRaw
    const r = parseDripYaml(nextRaw)
    if (r.ok) {
      setModel(r.model)
      setParseError(null)
    } else {
      setParseError(r.error)
    }
    onChange(nextRaw)
  }

  // ─── Rule mutators ────────────────────────────────────────────────────
  function addRule() {
    const next: Rule = {
      id: `rule_${model.rules.length + 1}`,
      when: {
        conditions: [{ term: 'stage', op: '==', value: 'replying' }],
        connectors: [],
      },
      action: { name: 'send_ai_reply' },
    }
    commitModel({ ...model, rules: [...model.rules, next] })
  }
  function deleteRule(idx: number) {
    commitModel({ ...model, rules: model.rules.filter((_, i) => i !== idx) })
  }
  function updateRule(idx: number, patch: Partial<Rule>) {
    const rules = model.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    commitModel({ ...model, rules })
  }

  // ─── Template mutators ────────────────────────────────────────────────
  function addTemplate() {
    const next: Template = { name: `template_${model.templates.length + 1}`, body: '' }
    commitModel({ ...model, templates: [...model.templates, next] })
  }
  function deleteTemplate(idx: number) {
    commitModel({ ...model, templates: model.templates.filter((_, i) => i !== idx) })
  }
  function updateTemplate(idx: number, patch: Partial<Template>) {
    const templates = model.templates.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    commitModel({ ...model, templates })
  }

  // ──────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="drip-rule-builder">
      {parseError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">YAML couldn&apos;t be parsed.</div>
            <div className="text-red-200/80 text-xs mt-0.5">{parseError}</div>
            <div className="text-red-200/60 text-xs mt-1">
              Edit raw YAML below — your data is preserved.
            </div>
          </div>
        </div>
      )}

      {/* TEMPLATES */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-white/60 font-semibold">Templates</h3>
          <button
            type="button"
            onClick={addTemplate}
            className="flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-1 text-white/80"
          >
            <Plus className="size-3" /> Add template
          </button>
        </div>
        {model.templates.length === 0 && (
          <p className="text-xs text-white/40 italic">No templates defined.</p>
        )}
        {model.templates.map((tpl, i) => (
          <div
            key={i}
            className="bg-white/[0.03] border border-white/10 rounded-lg p-3 space-y-2"
            data-testid={`template-${i}`}
          >
            <div className="flex gap-2 items-start">
              <input
                aria-label={`Template ${i + 1} name`}
                value={tpl.name}
                onChange={e => updateTemplate(i, { name: e.target.value })}
                placeholder="template_name"
                className="flex-1 bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => deleteTemplate(i)}
                aria-label={`Delete template ${i + 1}`}
                className="text-white/40 hover:text-red-400 p-1"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              aria-label={`Template ${i + 1} body`}
              value={tpl.body}
              onChange={e => updateTemplate(i, { body: e.target.value })}
              rows={2}
              maxLength={500}
              placeholder="message body..."
              className="w-full bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-sm resize-y"
            />
          </div>
        ))}
      </section>

      {/* RULES */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-white/60 font-semibold">Rules</h3>
          <button
            type="button"
            onClick={addRule}
            className="flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-1 text-white/80"
          >
            <Plus className="size-3" /> Add rule
          </button>
        </div>
        {model.rules.length === 0 && (
          <p className="text-xs text-white/40 italic">No rules defined.</p>
        )}
        {model.rules.map((rule, i) => (
          <RuleRow
            key={i}
            index={i}
            rule={rule}
            templates={model.templates}
            onChange={patch => updateRule(i, patch)}
            onDelete={() => deleteRule(i)}
          />
        ))}
      </section>

      {/* RAW YAML */}
      <section className="border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={() => setShowRaw(s => !s)}
          className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/90"
        >
          <Code className="size-3.5" />
          {showRaw ? 'Hide raw YAML' : 'Edit raw YAML (advanced)'}
        </button>
        {showRaw && (
          <textarea
            aria-label="Raw drip rules YAML"
            value={rawValue}
            onChange={e => commitRaw(e.target.value)}
            rows={16}
            spellCheck={false}
            className="mt-3 w-full font-mono text-xs bg-white/[0.04] border border-white/10 rounded px-3 py-2"
          />
        )}
      </section>

      {/* TODO(AI-8762 follow-up): "Test against sample match" mini-simulator —
          let the user paste sample conversation context and see which rule
          fires first. Defer until we have a JS implementation of the agent
          rule evaluator (currently Python-only in agent/clapcheeks/conversation/drip.py). */}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// RuleRow — one rule's UI
// ─────────────────────────────────────────────────────────────────────────

function RuleRow({
  index,
  rule,
  templates,
  onChange,
  onDelete,
}: {
  index: number
  rule: Rule
  templates: Template[]
  onChange: (patch: Partial<Rule>) => void
  onDelete: () => void
}) {
  function setWhen(next: WhenExpr) {
    onChange({ when: next, rawWhen: undefined, rawWhenInvalid: undefined })
  }

  function addCondition(connector: Connector) {
    setWhen({
      conditions: [
        ...rule.when.conditions,
        { term: 'stage', op: '==', value: 'replying' },
      ],
      connectors: [...rule.when.connectors, connector],
    })
  }

  function deleteCondition(idx: number) {
    if (rule.when.conditions.length <= 1) return
    const conditions = rule.when.conditions.filter((_, i) => i !== idx)
    // Drop the connector before the deleted condition, or after if first.
    const connectors = [...rule.when.connectors]
    if (idx === 0) connectors.shift()
    else connectors.splice(idx - 1, 1)
    setWhen({ conditions, connectors })
  }

  function updateCondition(idx: number, patch: Partial<Condition>) {
    const conditions = rule.when.conditions.map((c, i) =>
      i === idx ? { ...c, ...patch } : c,
    )
    setWhen({ ...rule.when, conditions })
  }

  function updateConnector(idx: number, value: Connector) {
    const connectors = rule.when.connectors.map((c, i) => (i === idx ? value : c))
    setWhen({ ...rule.when, connectors })
  }

  function setActionName(name: ActionName) {
    let args: Record<string, string> | undefined
    if (name === 'send_template') args = { name: templates[0]?.name ?? '' }
    if (name === 'advance_stage') args = { to: 'replying' }
    onChange({ action: { name, args } })
  }
  function setActionArg(key: string, value: string) {
    onChange({ action: { ...rule.action, args: { ...(rule.action.args ?? {}), [key]: value } } })
  }

  const invalid = rule.rawWhenInvalid != null

  return (
    <div
      className={`border rounded-lg p-3 space-y-2 ${
        invalid ? 'bg-red-500/[0.03] border-red-500/40' : 'bg-white/[0.03] border-white/10'
      }`}
      data-testid={`rule-${index}`}
    >
      <div className="flex gap-2 items-start">
        <input
          aria-label={`Rule ${index + 1} ID`}
          value={rule.id}
          onChange={e => onChange({ id: e.target.value })}
          placeholder="rule_id"
          className="flex-1 bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-sm font-mono"
        />
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete rule ${index + 1}`}
          className="text-white/40 hover:text-red-400 p-1"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* WHEN */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-white/40">When</div>
        {invalid && (
          <div
            className="text-[11px] text-red-300 bg-red-500/10 rounded px-2 py-1 flex items-start gap-1.5"
            title={rule.rawWhenInvalid ?? ''}
          >
            <AlertCircle className="size-3 mt-0.5 shrink-0" />
            <span>
              Couldn&apos;t parse <code className="font-mono">{rule.rawWhen}</code> —
              fix in raw YAML or replace with a new condition.
            </span>
          </div>
        )}
        {rule.when.conditions.map((cond, ci) => (
          <div key={ci} className="space-y-1.5">
            {ci > 0 && (
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Rule ${index + 1} connector ${ci}`}
                  value={rule.when.connectors[ci - 1]}
                  onChange={e => updateConnector(ci - 1, e.target.value as Connector)}
                  className="bg-white/[0.04] border border-white/10 rounded px-1.5 py-0.5 text-xs text-white/70 uppercase"
                >
                  <option value="and" className="bg-black">AND</option>
                  <option value="or" className="bg-black">OR</option>
                </select>
              </div>
            )}
            <ConditionRow
              cond={cond}
              onChange={patch => updateCondition(ci, patch)}
              onDelete={rule.when.conditions.length > 1 ? () => deleteCondition(ci) : undefined}
              ariaPrefix={`Rule ${index + 1} condition ${ci + 1}`}
            />
          </div>
        ))}
        <div className="flex gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => addCondition('and')}
            className="text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-0.5 text-white/70"
          >
            + AND
          </button>
          <button
            type="button"
            onClick={() => addCondition('or')}
            className="text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 rounded px-2 py-0.5 text-white/70"
          >
            + OR
          </button>
        </div>
      </div>

      {/* DO */}
      <div className="space-y-1.5 pt-2 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-wider text-white/40">Do</div>
        <select
          aria-label={`Rule ${index + 1} action`}
          value={rule.action.name}
          onChange={e => setActionName(e.target.value as ActionName)}
          className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm appearance-none w-full"
        >
          {ACTION_NAMES.map(a => (
            <option key={a} value={a} className="bg-black">{a}</option>
          ))}
        </select>
        {rule.action.name === 'send_template' && (
          <select
            aria-label={`Rule ${index + 1} template arg`}
            value={rule.action.args?.name ?? ''}
            onChange={e => setActionArg('name', e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm appearance-none w-full"
          >
            <option value="" className="bg-black" disabled>-- pick a template --</option>
            {templates.map(t => (
              <option key={t.name} value={t.name} className="bg-black">{t.name}</option>
            ))}
          </select>
        )}
        {rule.action.name === 'advance_stage' && (
          <select
            aria-label={`Rule ${index + 1} stage arg`}
            value={rule.action.args?.to ?? 'replying'}
            onChange={e => setActionArg('to', e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm appearance-none w-full"
          >
            {TERM_DEFS.stage.options.map(s => (
              <option key={s} value={s} className="bg-black">{s}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ConditionRow — one term/op/value triple
// ─────────────────────────────────────────────────────────────────────────

function ConditionRow({
  cond,
  onChange,
  onDelete,
  ariaPrefix,
}: {
  cond: Condition
  onChange: (patch: Partial<Condition>) => void
  onDelete?: () => void
  ariaPrefix: string
}) {
  function setTerm(term: TermName) {
    // If the new term is incompatible with the current op, reset both.
    const ops = operatorsFor(term)
    const op = (ops as readonly Operator[]).includes(cond.op) ? cond.op : defaultOpFor(term)
    onChange({ term, op, value: defaultValueFor(term) })
  }

  const ops = operatorsFor(cond.term)
  const def = TERM_DEFS[cond.term]
  const isEnum = def.type === 'enum'
  const isBool = def.type === 'bool'
  const isList = cond.op === 'in' || cond.op === 'not in'

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <select
        aria-label={`${ariaPrefix} term`}
        value={cond.term}
        onChange={e => setTerm(e.target.value as TermName)}
        className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm appearance-none"
      >
        {(Object.keys(TERM_DEFS) as TermName[]).map(t => (
          <option key={t} value={t} className="bg-black">{t}</option>
        ))}
      </select>
      <select
        aria-label={`${ariaPrefix} operator`}
        value={cond.op}
        onChange={e => onChange({ op: e.target.value as Operator })}
        className="bg-white/[0.04] border border-white/10 rounded px-1.5 py-1 text-sm appearance-none"
      >
        {ops.map(o => (
          <option key={o} value={o} className="bg-black">{o}</option>
        ))}
      </select>
      {/* VALUE */}
      {isEnum && !isList && (
        <select
          aria-label={`${ariaPrefix} value`}
          value={cond.value}
          onChange={e => onChange({ value: e.target.value })}
          className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm appearance-none"
        >
          {(def as { options: readonly string[] }).options.map(opt => (
            <option key={opt} value={opt} className="bg-black">{opt}</option>
          ))}
        </select>
      )}
      {isEnum && isList && (
        <input
          aria-label={`${ariaPrefix} value list`}
          value={cond.value}
          onChange={e => onChange({ value: e.target.value })}
          placeholder="replying, opened"
          className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm flex-1 min-w-[160px] font-mono"
        />
      )}
      {isBool && (
        <select
          aria-label={`${ariaPrefix} value`}
          value={cond.value.toLowerCase() === 'true' ? 'true' : 'false'}
          onChange={e => onChange({ value: e.target.value })}
          className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm appearance-none"
        >
          <option value="true" className="bg-black">true</option>
          <option value="false" className="bg-black">false</option>
        </select>
      )}
      {!isEnum && !isBool && (
        <input
          aria-label={`${ariaPrefix} value`}
          value={cond.value}
          onChange={e => onChange({ value: e.target.value })}
          inputMode="numeric"
          className="bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-sm w-24 font-mono"
        />
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`${ariaPrefix} delete`}
          className="text-white/40 hover:text-red-400 p-1"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}
