"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, Loader2, RefreshCw, Shield, Smartphone } from "lucide-react"

type DeviceControlStatus = {
  safety?: {
    personal_line_blocked?: boolean
    live_swipes_require_approval?: boolean
    live_messages_require_approval?: boolean
    outbound_send_requires_second_confirmation?: boolean
    approval_failures_fail_closed?: boolean
  }
  physical_ios?: {
    selected_line?: number
    selected_phone?: string
    selected_udid?: string
    selected_device?: string
    observed_connection?: string
    current_blocker?: string
    latest_known_blockers?: string[]
    latest_blockers_source?: string
    next_step?: string
  }
  live_action_gate?: {
    physical_ios_live_actions_enabled?: boolean
    env_var?: string
    required_value?: string
    default_state?: string
    action_surface?: string
    current_state?: string
    note?: string
  }
  sendbird?: {
    present?: boolean
    status?: string
    missing?: string[]
    mode?: string
    source?: string
    updated_at?: string | null
    age_minutes?: number | null
    capture_status?: {
      status?: string
      proxy_host?: string | null
      proxy_port?: number | null
      proxy_listening?: boolean
      snapshot_exists?: boolean
      app_id_present?: boolean
      user_id_present?: boolean
      session_key_present?: boolean
      api_token_present?: boolean
      missing_fields?: string[]
      captured_at_ms?: number | null
      snapshot_mtime_ms?: number | null
      next_step?: string | null
    } | null
  }
  blockers?: string[]
  audit?: {
    screenshot_dir?: string
    proof_run_dir?: string
  }
  inbound_watcher?: {
    ok?: boolean
    running?: boolean
    can_read_chatdb?: boolean | null
    blocker?: string | null
    status_path?: string
    fda_alert_imessage_enabled?: boolean
    required_python_app?: string
    repair_verify_command?: string
    unblock_command?: string
    restart_command?: string
    verify_command?: string
    next_step?: string
    terminal_read_proof?: {
      ok?: boolean
      path?: string
      count?: number | null
      inbound?: number | null
      outbound?: number | null
      no_send?: boolean
      mutation?: boolean
      bodies_written?: boolean
      raw_handles_written?: boolean
    }
    tcc?: {
      status?: string
      evidence_path?: string
      real_python?: string | null
      required_python_app?: string | null
      service?: string
      python_row_count?: number | null
      python_authorized?: boolean
      python_denied_or_off?: boolean
      rows?: Array<{
        database_path?: string | null
        client?: string | null
        client_type?: number | null
        auth_value?: number | null
        authorized?: boolean
      }>
    }
  }
	  proof_runner?: {
	    readiness_command?: string
	    transport_diagnostics_command?: string
	    prepare_developer_mode_command?: string
	    prepare_coredevice_command?: string
    command?: string
    all_platforms_command?: string
    watch_command?: string
    completion_audit_command?: string
	    script?: string
	    cwd?: string
	  }
	  completion_audit?: {
	    decision_rule?: string
	    command?: string
	    latest_result_path?: string
	    latest_result?: {
	      status?: string
	      timestamp?: string | null
	      platform?: string | null
	      audit_log?: string | null
	      failed_checks?: string[]
	      blockers?: string[]
	      next_unblock_steps?: string[]
	      readiness_command?: string
	      transport_diagnostics_command?: string
	      completion_audit_command?: string
	      physical_png_required?: boolean
	      path?: string
	      error?: string
	    }
	    success_criteria?: string[]
	    artifact_checklist?: Array<{ requirement?: string; evidence?: string }>
	  }
	}

type QueueResult = {
  queued?: boolean
  job_id?: string
  job_ids?: string[]
  jobs?: Array<{ platform?: string; job_id?: string }>
  error?: string
}

type JobStatus = {
  status?: string
  job_type?: string
  last_error?: string
  result?: {
    status?: string
    details?: {
      reason?: string
      screenshot_type?: string
      screenshot_path?: string
    }
  }
}

const PLATFORM_OPTIONS = ["hinge", "tinder", "bumble"] as const

export function DeviceControlPanel() {
  const [status, setStatus] = useState<DeviceControlStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [platform, setPlatform] = useState<(typeof PLATFORM_OPTIONS)[number]>("hinge")
  const [queueState, setQueueState] = useState<"idle" | "observe" | "proof" | "proof-all">("idle")
  const [queueResult, setQueueResult] = useState<QueueResult | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [jobStatusError, setJobStatusError] = useState<string | null>(null)

  async function refreshStatus() {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const response = await fetch("/api/device-control/status", { cache: "no-store" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Unable to load device-control status")
      setStatus(data)
    } catch (error) {
      setStatus(null)
      setStatusError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingStatus(false)
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  const physicalReady = status?.physical_ios?.current_blocker === "none"
  const blockerLabel = status?.physical_ios?.current_blocker || status?.blockers?.[0] || "unknown"
  const selectedLine = status?.physical_ios?.selected_line ?? 2
  const liveActionGate = status?.live_action_gate
  const liveActionGateEnabled = liveActionGate?.physical_ios_live_actions_enabled === true
  const sendBirdCapture = status?.sendbird?.capture_status
  const sendBirdCaptureReady = status?.sendbird?.present === true
  const sendBirdCaptureUpdated = sendBirdCapture?.snapshot_mtime_ms
    ? new Date(sendBirdCapture.snapshot_mtime_ms).toLocaleString()
    : sendBirdCapture?.captured_at_ms
      ? new Date(sendBirdCapture.captured_at_ms).toLocaleString()
      : null
  const readinessBlockers = useMemo(() => {
    const blockers = status?.physical_ios?.latest_known_blockers?.length
      ? status.physical_ios.latest_known_blockers
      : status?.blockers || []
    return Array.from(new Set(blockers)).filter((blocker) => blocker && blocker !== "first_live_tap_swipe_or_send_requires_explicit_operator_approval")
  }, [status])

  const safetyItems = useMemo(
    () => [
      ["Line 1 blocked", status?.safety?.personal_line_blocked],
      ["Live swipes need approval", status?.safety?.live_swipes_require_approval],
      ["Messages need approval", status?.safety?.live_messages_require_approval],
      ["Sends need second confirmation", status?.safety?.outbound_send_requires_second_confirmation],
      ["Approval failures fail closed", status?.safety?.approval_failures_fail_closed],
    ],
    [status],
  )

  async function refreshJobStatus(jobId: string) {
    setJobStatusError(null)
    try {
      const response = await fetch(`/api/device-control/jobs/${jobId}`, { cache: "no-store" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Unable to load job status")
      setJobStatus(data.job || null)
    } catch (error) {
      setJobStatus(null)
      setJobStatusError(error instanceof Error ? error.message : String(error))
    }
  }

  async function enqueue(kind: "observe" | "proof" | "proof-all") {
    setQueueState(kind)
    setQueueResult(null)
    setJobStatus(null)
    setJobStatusError(null)
    try {
      const response = await fetch(`/api/device-control/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, line: selectedLine }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `Unable to enqueue ${kind} job`)
      setQueueResult(data)
      if (data.job_id) await refreshJobStatus(data.job_id)
      else if (Array.isArray(data.job_ids) && data.job_ids[0]) await refreshJobStatus(data.job_ids[0])
    } catch (error) {
      setQueueResult({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setQueueState("idle")
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-6 pt-6">
      <div className="rounded-xl border border-white/10 bg-[#08080d] p-5 shadow-2xl shadow-black/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Smartphone className="h-4 w-4 text-brand-300" />
              iPhone device control
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/55">
              Observe-only control for the bound secondary iPhone. Physical PNG proof must pass before any live tap, swipe, type, or send control is exposed here.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshStatus}
            disabled={loadingStatus}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-60"
          >
            {loadingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mt-5 grid min-w-0 gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-white/35">Bound device</div>
                <div className="mt-2 break-words text-lg font-semibold text-white">
                  {status?.physical_ios?.selected_device || "Julian Bradley's iPhone (2)"}
                </div>
                <div className="mt-1 break-words text-xs text-white/45">
                  Line {selectedLine} | {status?.physical_ios?.selected_phone || "+16199919355"} | {status?.physical_ios?.observed_connection || "wifi"}
                </div>
                <div className="mt-1 break-words text-[11px] text-white/35">
                  Blockers: {status?.physical_ios?.latest_blockers_source === "latest_completion_audit_json" ? "latest audit JSON" : "fallback readiness map"}
                </div>
              </div>
              <div className={`w-fit rounded-full px-3 py-1 text-xs font-semibold sm:shrink-0 ${physicalReady ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}>
                {physicalReady ? "Proof ready" : blockerLabel.replace(/_/g, " ")}
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm leading-relaxed text-amber-100">
              <div className="flex min-w-0 gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                <span className="min-w-0 break-words">{status?.physical_ios?.next_step || "Enable Developer Mode on the iPhone, approve restart, and confirm after boot."}</span>
              </div>
            </div>

            {readinessBlockers.length > 0 ? (
              <div className="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
                <div className="text-[10px] uppercase tracking-widest text-white/35">Physical readiness blockers</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {readinessBlockers.map((blocker) => (
                    <span key={blocker} className="rounded-md bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-100">
                      {blocker.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {sendBirdCapture ? (
              <div className="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-widest text-white/35">Hinge proxy capture</div>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                    sendBirdCaptureReady
                      ? "bg-emerald-400/15 text-emerald-200"
                      : sendBirdCapture.proxy_listening
                        ? "bg-amber-400/15 text-amber-100"
                        : "bg-red-400/15 text-red-100"
                  }`}>
                    {(sendBirdCapture.status || "unknown").replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                    Proxy: {sendBirdCapture.proxy_listening ? "listening" : "offline"} on {sendBirdCapture.proxy_host || "127.0.0.1"}:{sendBirdCapture.proxy_port || 8080}
                  </div>
                  <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                    Session: {sendBirdCaptureReady ? "ready" : (sendBirdCapture.missing_fields || status?.sendbird?.missing || []).join(", ") || "missing"}
                  </div>
                  <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                    Snapshot: {sendBirdCapture.snapshot_exists ? "present" : "missing"}
                  </div>
                  <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                    Updated: {sendBirdCaptureUpdated || status?.sendbird?.updated_at || "unknown"}
                  </div>
                </div>
                <div className={`mt-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
                  sendBirdCaptureReady
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                    : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                }`}>
                  {sendBirdCapture.next_step || "Open Hinge chat through the proxied device to refresh SendBird capture."}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2">
              <code className="block min-w-0 overflow-hidden rounded-md bg-white/[0.04] px-3 py-2 text-xs text-white/45">
                {status?.physical_ios?.selected_udid || "00008150-00093C9C3C7A401C"}
              </code>
              <code className="block min-w-0 overflow-hidden rounded-md bg-white/[0.04] px-3 py-2 text-xs text-white/45">
                {status?.audit?.screenshot_dir || "~/.clapcheeks-local/device-control/screenshots"}
              </code>
            </div>

	            <div className="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
	              <div className="text-[10px] uppercase tracking-widest text-white/35">Post-unlock proof runner</div>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.readiness_command || "cd ~/clapcheeks-local && scripts/prepare-device-control-readiness.sh 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.transport_diagnostics_command || "cd ~/clapcheeks-local && scripts/run-device-control-transport-diagnostics.sh 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.prepare_developer_mode_command || "cd ~/clapcheeks-local && scripts/prepare-device-control-developer-mode.sh 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.prepare_coredevice_command || "cd ~/clapcheeks-local && scripts/prepare-device-control-coredevice.sh 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.command || "cd ~/clapcheeks-local && scripts/run-device-control-physical-proof.sh hinge 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.all_platforms_command || "cd ~/clapcheeks-local && scripts/run-device-control-all-platform-proofs.sh 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.watch_command || "cd ~/clapcheeks-local && scripts/watch-device-control-physical-proof.sh 2"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.proof_runner?.completion_audit_command || "cd ~/clapcheeks-local && scripts/run-device-control-completion-audit.sh 2 hinge"}
              </code>
              <div className="mt-2 text-xs text-white/35">
	                Logs: {status?.audit?.proof_run_dir || "~/.clapcheeks-local/device-control/proof-runs"}
	              </div>
	            </div>

            {status?.completion_audit ? (
	              <div className="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
	                <div className="text-[10px] uppercase tracking-widest text-white/35">Completion audit checklist</div>
	                <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
	                  {status.completion_audit.decision_rule || "Physical PNG proof must pass before completion."}
	                </div>
	                <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
	                  {status.completion_audit.command || "cd ~/clapcheeks-local && scripts/run-device-control-completion-audit.sh 2 hinge"}
	                </code>
	                <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/45">
	                  {status.completion_audit.latest_result_path || "~/.clapcheeks-local/device-control/proof-runs/latest-completion-audit.json"}
	                </code>
	                <div className={`mt-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
	                  status.completion_audit.latest_result?.status === "passed"
	                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
	                    : "border-amber-400/20 bg-amber-400/10 text-amber-100"
	                }`}>
	                  Latest audit result: {status.completion_audit.latest_result?.status || "missing"}
	                  {status.completion_audit.latest_result?.timestamp ? ` | ${status.completion_audit.latest_result.timestamp}` : ""}
	                  {status.completion_audit.latest_result?.audit_log ? ` | ${status.completion_audit.latest_result.audit_log}` : ""}
	                </div>
	                {status.completion_audit.latest_result?.blockers?.length ? (
	                  <div className="mt-2 flex flex-wrap gap-2">
	                    {status.completion_audit.latest_result.blockers.map((blocker) => (
	                      <span key={blocker} className="rounded-md bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-100">
	                        {blocker.replace(/_/g, " ")}
	                      </span>
	                    ))}
	                  </div>
	                ) : null}
	                {status.completion_audit.latest_result?.failed_checks?.length ? (
	                  <div className="mt-2 text-xs leading-relaxed text-white/40">
	                    Failed gates: {status.completion_audit.latest_result.failed_checks.join(", ")}
	                  </div>
	                ) : null}
	                {status.completion_audit.latest_result?.next_unblock_steps?.length ? (
	                  <div className="mt-3 rounded-md border border-white/10 bg-black/25 p-3">
	                    <div className="text-[10px] uppercase tracking-widest text-white/35">Next physical unblock</div>
	                    <div className="mt-2 grid gap-2">
	                      {status.completion_audit.latest_result.next_unblock_steps.map((step) => (
	                        <div key={step} className="text-xs leading-relaxed text-white/55">
	                          {step}
	                        </div>
	                      ))}
	                    </div>
	                    <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/45">
	                      {status.completion_audit.latest_result.transport_diagnostics_command || "cd ~/clapcheeks-local && scripts/run-device-control-transport-diagnostics.sh 2"}
	                    </code>
	                    <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/45">
	                      {status.completion_audit.latest_result.readiness_command || "cd ~/clapcheeks-local && scripts/prepare-device-control-readiness.sh 2"}
	                    </code>
	                  </div>
	                ) : null}
	                <div className="mt-3 grid gap-2">
	                  {(status.completion_audit.success_criteria || []).slice(0, 4).map((criterion) => (
	                    <div key={criterion} className="rounded-md bg-white/[0.035] px-3 py-2 text-xs leading-relaxed text-white/55">
	                      {criterion}
	                    </div>
	                  ))}
	                </div>
	                <div className="mt-3 flex flex-wrap gap-2">
	                  {(status.completion_audit.artifact_checklist || []).map((item) => (
	                    <span key={item.requirement} className="rounded-md bg-white/[0.05] px-2 py-1 text-[11px] font-medium text-white/55" title={item.evidence}>
	                      {item.requirement?.replace(/_/g, " ")}
	                    </span>
	                  ))}
	                </div>
	              </div>
	            ) : null}

            <div className="mt-3 min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="text-[10px] uppercase tracking-widest text-white/35">Inbound watcher unblock</div>
              <div className={`mt-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${
                status?.inbound_watcher?.ok
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                  : "border-amber-400/20 bg-amber-400/10 text-amber-100"
              }`}>
                {status?.inbound_watcher?.ok
                  ? "chat.db tailer can read Messages"
                  : (status?.inbound_watcher?.next_step || "Grant Full Disk Access to launchd Python, restart the watcher, then rerun runtime smoke.")}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                  Status: {status?.inbound_watcher?.running ? "running" : "not running"} | chat.db: {status?.inbound_watcher?.can_read_chatdb === true ? "readable" : "blocked"}
                </div>
                <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                  Terminal proof: {status?.inbound_watcher?.terminal_read_proof?.ok ? `passed (${status.inbound_watcher.terminal_read_proof.count ?? 0} rows)` : "missing"}
                </div>
                <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                  TCC python: {status?.inbound_watcher?.tcc?.python_authorized ? "authorized" : status?.inbound_watcher?.tcc?.python_denied_or_off ? "off" : "unknown"}
                </div>
                <div className="min-w-0 break-words rounded-md bg-black/25 px-3 py-2 text-xs text-white/50">
                  TCC rows: {status?.inbound_watcher?.tcc?.python_row_count ?? "n/a"} | auth: {status?.inbound_watcher?.tcc?.rows?.[0]?.auth_value ?? "n/a"}
                </div>
              </div>
              {status?.inbound_watcher?.tcc ? (
                <div className="mt-2 min-w-0 break-all rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs leading-relaxed text-white/45">
                  Full Disk Access TCC: {status.inbound_watcher.tcc.python_authorized ? "authorized" : "not authorized"}
                  {status.inbound_watcher.tcc.real_python ? ` | ${status.inbound_watcher.tcc.real_python}` : ""}
                </div>
              ) : null}
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/45">
                {status?.inbound_watcher?.required_python_app || "/opt/homebrew/Cellar/python@3.14/3.14.5/Frameworks/Python.framework/Versions/3.14/Resources/Python.app"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.inbound_watcher?.repair_verify_command || "cd ~/clapcheeks-local && scripts/repair-inbound-watcher-fda.sh"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/55">
                {status?.inbound_watcher?.unblock_command || "cd ~/clapcheeks-local && scripts/open-inbound-watcher-fda-settings.sh"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/45">
                {status?.inbound_watcher?.restart_command || "launchctl kickstart -k gui/$(id -u)/tech.clapcheeks.inbound-watcher"}
              </code>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/40 px-3 py-2 text-xs text-white/45">
                {status?.inbound_watcher?.verify_command || "cd ~/clapcheeks-local && scripts/launchd_doctor.sh && cd ~/clapcheeks.tech/web && npm run test:e2e:runtime"}
              </code>
            </div>
	          </div>

          <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield className="h-4 w-4 text-emerald-300" />
              Approval gates
            </div>
            <div className="mt-3 space-y-2">
              {safetyItems.map(([label, ok]) => (
                <div key={String(label)} className="flex items-center justify-between gap-3 rounded-md bg-white/[0.035] px-3 py-2 text-xs">
                  <span className="text-white/55">{label}</span>
                  {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />}
                </div>
              ))}
            </div>

            <div className={`mt-3 rounded-lg border px-3 py-3 text-xs leading-relaxed ${
              liveActionGateEnabled
                ? "border-red-400/25 bg-red-400/10 text-red-100"
                : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
            }`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">Live action env gate</span>
                <span className="rounded-md bg-black/25 px-2 py-1 font-semibold">
                  {liveActionGate?.current_state || "disabled"}
                </span>
              </div>
              <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-md bg-black/35 px-3 py-2 text-[11px] text-white/55">
                {liveActionGate?.env_var || "CLAPCHEEKS_PHYSICAL_IOS_ENABLE_LIVE_ACTIONS"}={liveActionGate?.required_value || "1"}
              </code>
              <div className="mt-2 text-white/55">
                {liveActionGate?.note || "Physical iOS live actions stay disabled unless this env gate is deliberately enabled, and all approval, proof, and send gates still apply."}
              </div>
              <div className="mt-2 text-white/40">
                Surface: {liveActionGate?.action_surface || "physical_ios_appium_xcuitest"} | Default: {liveActionGate?.default_state || "disabled"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-white/8 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <label className="text-xs font-medium text-white/45">
            Platform
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as (typeof PLATFORM_OPTIONS)[number])}
              className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition focus:border-brand-400/60 sm:w-44"
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => enqueue("observe")}
              disabled={queueState !== "idle"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/75 transition hover:bg-white/10 disabled:opacity-60"
            >
              {queueState === "observe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Queue observe
            </button>
            <button
              type="button"
              onClick={() => enqueue("proof")}
              disabled={queueState !== "idle"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-60"
            >
              {queueState === "proof" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Queue PNG proof
            </button>
            <button
              type="button"
              onClick={() => enqueue("proof-all")}
              disabled={queueState !== "idle"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 text-sm font-semibold text-brand-100 transition hover:bg-brand-500/20 disabled:opacity-60"
            >
              {queueState === "proof-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Queue all-platform proof
            </button>
          </div>
        </div>

        {(queueResult || statusError) && (
          <div className={`mt-4 rounded-lg border px-3 py-2 text-sm ${queueResult?.queued ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100" : "border-red-500/25 bg-red-500/10 text-red-100"}`}>
            {statusError || queueResult?.error || (queueResult?.job_ids?.length ? `Queued ${queueResult.job_ids.length} proof jobs` : queueResult?.job_id ? `Queued ${queueResult.job_id}` : "Queued device-control job")}
          </div>
        )}

        {(jobStatus || jobStatusError) && (
          <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/65">
            {jobStatusError ? (
              <span className="text-amber-200">{jobStatusError}</span>
            ) : (
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Job status: <span className="font-semibold text-white">{jobStatus?.status || "unknown"}</span>
                  {jobStatus?.last_error ? <span className="text-amber-200"> | {jobStatus.last_error}</span> : null}
                  {jobStatus?.result?.details?.reason ? <span className="text-amber-200"> | {jobStatus.result.details.reason}</span> : null}
                </span>
                {queueResult?.job_id ? (
                  <button
                    type="button"
                    onClick={() => refreshJobStatus(queueResult.job_id!)}
                    className="text-xs font-semibold text-brand-200 hover:text-brand-100"
                  >
                    Refresh job
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
