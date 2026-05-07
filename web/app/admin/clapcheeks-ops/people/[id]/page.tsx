"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { use, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Send,
  MessageCircle,
  Brain,
  Calendar,
  Image,
  User,
  FileText,
  Clock,
  TrendingUp,
  PenLine,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtMs(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function stageBadgeColor(stage?: string) {
  switch (stage) {
    case "matched":
    case "early_chat": return "bg-blue-500/20 text-blue-300";
    case "phone_swap":
    case "pre_date": return "bg-indigo-500/20 text-indigo-300";
    case "first_date_done":
    case "ongoing": return "bg-amber-500/20 text-amber-300";
    case "exclusive": return "bg-green-500/20 text-green-300";
    case "ghosted":
    case "ended": return "bg-gray-500/20 text-gray-400";
    default: return "bg-purple-500/20 text-purple-300";
  }
}

function ScoreBar({ label, value }: { label: string; value?: number }) {
  const pct = Math.min(Math.max((value ?? 0) * (value && value <= 1 ? 100 : 1), 0), 100);
  const display = value != null ? (value <= 1 ? Math.round(value * 100) : Math.round(value)) : undefined;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span>{display != null ? `${display}` : "—"}</span>
      </div>
      <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TouchStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/20 text-amber-300",
    approved: "bg-blue-500/20 text-blue-300",
    fired: "bg-green-500/20 text-green-300",
    cancelled: "bg-gray-500/20 text-gray-400",
    skipped: "bg-red-500/20 text-red-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${map[status] ?? "bg-gray-500/20 text-gray-400"}`}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────────────────

export default function PersonDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const person_id = id as Id<"people">;

  const dossier = useQuery(api.people.getDossier, { person_id });
  const scheduleOneFn = useMutation(api.people.scheduleOne);
  const commitDraftFn = useMutation(api.people.commitDraftedTouch);

  // ── Compose panel state ──────────────────────────────────────────────────
  type ComposeState = "idle" | "generating" | "drafted" | "sent";
  const [composeState, setComposeState] = useState<ComposeState>("idle");
  const [composeTemplate, setComposeTemplate] = useState<string>("reply");
  const [draftBody, setDraftBody] = useState<string>("");
  const [touchId, setTouchId] = useState<Id<"scheduled_touches"> | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<{ reason: string; colliding_touch_id?: string } | null>(null);

  async function handleSendTouchNow() {
    if (!dossier?.person) return;
    await scheduleOneFn({
      person_id,
      user_id: "fleet-julian",
      type: "reply",
      scheduled_for: Date.now() + 5 * 60 * 1000,
    });
  }

  async function handlePreview() {
    if (!dossier?.person) return;
    setComposeError(null);
    setSkipReason(null);
    setComposeState("generating");
    try {
      const result = await scheduleOneFn({
        person_id,
        user_id: "fleet-julian",
        type: composeTemplate,
        preview_only: true,
      }) as { touch_id: Id<"scheduled_touches">; preview: true; draft_body: string; template_kind: string } | Id<"scheduled_touches">;

      // scheduleOne returns {touch_id, preview, draft_body, ...} in preview mode
      if (result && typeof result === "object" && "preview" in result) {
        setTouchId(result.touch_id);
        setDraftBody(result.draft_body ?? "");
        setComposeState("drafted");
      } else {
        setComposeError("Unexpected response from server.");
        setComposeState("idle");
      }
    } catch (e: unknown) {
      setComposeError(e instanceof Error ? e.message : "Preview failed.");
      setComposeState("idle");
    }
  }

  async function handleSend() {
    if (!touchId || !draftBody.trim()) return;
    setComposeError(null);
    setSkipReason(null);
    try {
      const result = await commitDraftFn({
        touch_id: touchId,
        edited_body: draftBody,
      }) as { committed?: boolean; skipped?: boolean; not_found?: boolean; reason?: string };

      if (result?.committed) {
        setComposeState("sent");
        setTouchId(null);
      } else if (result?.skipped) {
        const reason = result.reason ?? "unknown";
        if (reason === "anti_loop_collision") {
          setSkipReason({ reason: "anti_loop_collision" });
        } else {
          setComposeError(`Send blocked: ${reason}`);
        }
        setComposeState("drafted");
      } else {
        setComposeError("Send failed — touch not found.");
        setComposeState("drafted");
      }
    } catch (e: unknown) {
      setComposeError(e instanceof Error ? e.message : "Send failed.");
      setComposeState("drafted");
    }
  }

  function handleReset() {
    setComposeState("idle");
    setDraftBody("");
    setTouchId(null);
    setComposeError(null);
    setSkipReason(null);
  }

  if (dossier === undefined) {
    return (
      <div className="p-8 text-gray-400 animate-pulse">Loading dossier…</div>
    );
  }

  if (dossier === null) {
    return (
      <div className="p-8">
        <p className="text-red-400">Person not found.</p>
        <Link href="/admin/clapcheeks-ops/network" className="text-purple-400 underline mt-2 inline-block">
          Back to network
        </Link>
      </div>
    );
  }

  const { person, messages, scheduledTouches, pendingTouches, mediaUses } = dossier;

  // Normalise Task H's handles array for display
  const primaryHandle = person.handles?.find((h: { primary: boolean }) => h.primary) ?? person.handles?.[0];
  const platforms = [...new Set((person.handles ?? []).map((h: { channel: string }) => h.channel))];

  // Normalise dossier-specific fields (Task A / Task B additions)
  const personalDetails: { key: string; value: string; noted_at?: number }[] =
    Array.isArray(person.personal_details) ? person.personal_details : [];
  const curiosityLedger: { topic: string; asked_at?: number }[] =
    Array.isArray(person.curiosity_ledger) ? person.curiosity_ledger : [];
  const lifeEvents: { event: string; date?: string }[] =
    Array.isArray(person.recent_life_events) ? person.recent_life_events : [];
  const openers: string[] =
    Array.isArray(person.opener_suggestions) ? person.opener_suggestions : [];

  // DISC — support both Task A's disc_inference blob and Task H's disc_primary/disc_type fields
  const discPrimary = person.disc_inference?.primary ?? person.disc_primary;
  const discTactics: string[] = Array.isArray(person.disc_inference?.tactics)
    ? person.disc_inference.tactics
    : [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Top bar ── */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/clapcheeks-ops/network"
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">{person.display_name}</h1>
            {primaryHandle && (
              <p className="text-xs text-gray-500">{primaryHandle.value}</p>
            )}
          </div>
        </div>
        <Button
          onClick={handleSendTouchNow}
          className="bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-2"
          size="sm"
        >
          <Send className="w-4 h-4" />
          Send a touch now
        </Button>
      </div>

      {/* ── Header card ── */}
      <div className="px-6 py-5 border-b border-gray-800">
        <div className="flex flex-wrap gap-4">
          {/* Stage */}
          {person.courtship_stage && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Stage</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${stageBadgeColor(person.courtship_stage)}`}>
                {person.courtship_stage.replace(/_/g, " ")}
              </span>
            </div>
          )}

          {/* Vibe (free-text from Task B, or enum from Task H) */}
          {(person.vibe || person.vibe_classification) && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Vibe</span>
              <span className="text-xs text-gray-200">
                {person.vibe ?? person.vibe_classification}
              </span>
            </div>
          )}

          {/* Platforms from handles */}
          {platforms.length > 0 && (
            <div className="flex items-center gap-1.5">
              {platforms.map((p: string) => (
                <Badge key={p} variant="outline" className="text-xs capitalize border-gray-700 text-gray-400">
                  {p}
                </Badge>
              ))}
            </div>
          )}

          {/* Zodiac */}
          {person.zodiac_sign && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Zodiac</span>
              <span className="text-xs text-gray-200">{person.zodiac_sign}</span>
            </div>
          )}

          {/* Pending touches count */}
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-400">
              {pendingTouches.length} pending touch{pendingTouches.length !== 1 ? "es" : ""}
            </span>
          </div>
        </div>

        {/* Score bars */}
        <div className="mt-4 grid grid-cols-3 gap-4 max-w-lg">
          <ScoreBar label="Trust" value={person.trust_score} />
          <ScoreBar label="Engagement" value={person.engagement_score} />
          <ScoreBar label="Ask-readiness" value={person.ask_readiness} />
        </div>

        {/* Next best move */}
        {person.next_best_move && (
          <div className="mt-3 bg-purple-900/20 border border-purple-800/30 rounded-lg px-4 py-2">
            <p className="text-xs text-purple-300">
              <span className="font-medium">Next move: </span>
              {person.next_best_move}
            </p>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="px-6 py-4">
        <Tabs defaultValue="timeline" className="w-full">
          <TabsList className="bg-gray-900 border border-gray-800 mb-4">
            <TabsTrigger value="timeline" className="flex items-center gap-1.5 text-xs">
              <MessageCircle className="w-3.5 h-3.5" />
              Timeline
              <span className="ml-1 text-gray-500">({messages.length})</span>
            </TabsTrigger>
            <TabsTrigger value="memory" className="flex items-center gap-1.5 text-xs">
              <Brain className="w-3.5 h-3.5" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5" />
              Schedule
              <span className="ml-1 text-gray-500">({scheduledTouches.length})</span>
            </TabsTrigger>
            <TabsTrigger value="media" className="flex items-center gap-1.5 text-xs">
              <Image className="w-3.5 h-3.5" />
              Media
              <span className="ml-1 text-gray-500">({mediaUses.length})</span>
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex items-center gap-1.5 text-xs">
              <User className="w-3.5 h-3.5" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex items-center gap-1.5 text-xs">
              <FileText className="w-3.5 h-3.5" />
              Notes
            </TabsTrigger>
            <TabsTrigger value="compose" className="flex items-center gap-1.5 text-xs">
              <PenLine className="w-3.5 h-3.5" />
              Compose
            </TabsTrigger>
          </TabsList>

          {/* ── TIMELINE ── */}
          <TabsContent value="timeline">
            {messages.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                No messages found.{" "}
                {!primaryHandle && "Add a handle in Obsidian or Google Contacts to link messages."}
              </p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                {messages.map((msg: { _id: string; direction: string; body: string; sent_at: number }) => {
                  const isOut = msg.direction === "outbound";
                  return (
                    <div
                      key={msg._id}
                      className={`flex ${isOut ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm ${
                          isOut
                            ? "bg-purple-700 text-white rounded-br-sm"
                            : "bg-gray-800 text-gray-100 rounded-bl-sm"
                        }`}
                      >
                        <p className="break-words">{msg.body}</p>
                        <p className="text-xs mt-1 opacity-50 text-right">
                          {fmtMs(msg.sent_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── MEMORY ── */}
          <TabsContent value="memory">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Personal details */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-gray-300">Personal Details</CardTitle>
                </CardHeader>
                <CardContent>
                  {personalDetails.length === 0 ? (
                    <p className="text-xs text-gray-500">Nothing recorded yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {personalDetails.map((d, i) => (
                        <li key={i} className="text-xs">
                          <span className="text-gray-400 font-medium">{d.key}:</span>{" "}
                          <span className="text-gray-200">{d.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Curiosity ledger */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-gray-300">Curiosity Ledger</CardTitle>
                </CardHeader>
                <CardContent>
                  {curiosityLedger.length === 0 ? (
                    <p className="text-xs text-gray-500">No topics noted.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {curiosityLedger.map((c, i) => (
                        <li key={i} className="text-xs text-gray-300">• {c.topic}</li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Recent life events */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-gray-300">Recent Life Events</CardTitle>
                </CardHeader>
                <CardContent>
                  {lifeEvents.length === 0 ? (
                    <p className="text-xs text-gray-500">None recorded.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {lifeEvents.map((e, i) => (
                        <li key={i} className="text-xs">
                          <span className="text-gray-200">{e.event}</span>
                          {e.date && <span className="text-gray-500 ml-2">{e.date}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Emotional state */}
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-gray-300 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Emotional State
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!Array.isArray(person.emotional_state_recent) || person.emotional_state_recent.length === 0 ? (
                    // Fallback to Task H's sentiment fields
                    <div className="space-y-1">
                      {person.sentiment_trend && (
                        <p className="text-xs text-gray-300">
                          Sentiment: <span className="text-gray-200">{person.sentiment_trend}</span>
                        </p>
                      )}
                      {person.avg_sentiment_score != null && (
                        <p className="text-xs text-gray-400">
                          Avg score: {(person.avg_sentiment_score * 100).toFixed(0)}%
                        </p>
                      )}
                      {!person.sentiment_trend && (
                        <p className="text-xs text-gray-500">Not tracked yet.</p>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-1">
                      {(person.emotional_state_recent as { state: string; ts: number }[]).map(
                        (s, i) => (
                          <li key={i} className="flex items-center justify-between text-xs">
                            <span className="text-gray-200">{s.state}</span>
                            <span className="text-gray-500">{fmtMs(s.ts)}</span>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Things she loves / dislikes from Task H */}
              {(Array.isArray(person.things_she_loves) && person.things_she_loves.length > 0) && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-300">Hooks & Interests</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {person.things_she_loves.map((t: string, i: number) => (
                        <span key={i} className="text-xs bg-green-900/30 text-green-300 px-2 py-0.5 rounded-full">
                          {t}
                        </span>
                      ))}
                    </div>
                    {Array.isArray(person.boundaries_stated) && person.boundaries_stated.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {person.boundaries_stated.map((b: string, i: number) => (
                          <span key={i} className="text-xs bg-red-900/30 text-red-300 px-2 py-0.5 rounded-full">
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ── SCHEDULE ── */}
          <TabsContent value="schedule">
            {scheduledTouches.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No touches scheduled.</p>
            ) : (
              <div className="space-y-2">
                {scheduledTouches.map((t: {
                  _id: string;
                  type: string;
                  template_name?: string;
                  status: string;
                  draft_body?: string;
                  skip_reason?: string;
                  scheduled_for: number;
                  fired_at?: number;
                }) => (
                  <div
                    key={t._id}
                    className="flex items-start justify-between bg-gray-900 border border-gray-800 rounded-lg px-4 py-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white capitalize">
                          {t.type.replace(/_/g, " ")}
                        </span>
                        {t.template_name && (
                          <span className="text-xs text-gray-500">({t.template_name})</span>
                        )}
                        <TouchStatusBadge status={t.status} />
                      </div>
                      {t.draft_body && (
                        <p className="text-xs text-gray-400 italic line-clamp-2">
                          "{t.draft_body}"
                        </p>
                      )}
                      {t.skip_reason && (
                        <p className="text-xs text-red-400 mt-0.5">Skip: {t.skip_reason}</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-gray-500 shrink-0 ml-4">
                      <p>{fmtMs(t.scheduled_for)}</p>
                      {t.fired_at && (
                        <p className="text-green-400">Fired {fmtMs(t.fired_at)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── MEDIA ── */}
          <TabsContent value="media">
            {mediaUses.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No media sent yet.</p>
            ) : (
              <div className="space-y-2">
                {mediaUses.map((m: {
                  _id: string;
                  asset_url?: string;
                  asset_label?: string;
                  asset_id?: string;
                  notes?: string;
                  sent_at: number;
                }) => (
                  <div
                    key={m._id}
                    className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center">
                        {m.asset_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={m.asset_url}
                            alt={m.asset_label ?? "media"}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Image className="w-5 h-5 text-gray-600" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm text-white">
                          {m.asset_label ?? m.asset_id ?? "Unknown asset"}
                        </p>
                        {m.notes && <p className="text-xs text-gray-400">{m.notes}</p>}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">{fmtMs(m.sent_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── PROFILE ── */}
          <TabsContent value="profile">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Zodiac block */}
              {person.zodiac_analysis ? (
                <Card className="bg-gray-900 border-gray-800 md:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-300">
                      Zodiac — {person.zodiac_sign ?? "Unknown"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words font-mono bg-gray-950 rounded p-3">
                      {typeof person.zodiac_analysis === "string"
                        ? person.zodiac_analysis
                        : JSON.stringify(person.zodiac_analysis, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              ) : (
                person.zodiac_sign && (
                  <Card className="bg-gray-900 border-gray-800">
                    <CardContent className="pt-4">
                      <p className="text-sm text-gray-300">☽ {person.zodiac_sign}</p>
                      <p className="text-xs text-gray-500 mt-1">No detailed analysis yet.</p>
                    </CardContent>
                  </Card>
                )
              )}

              {/* DISC — supports both Task A blob and Task H individual fields */}
              {(discPrimary || discTactics.length > 0 || person.disc_type) && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-300">DISC Profile</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-purple-300 font-medium mb-2">
                      Primary: {person.disc_type ?? discPrimary ?? "—"}
                    </p>
                    {person.communication_style && (
                      <p className="text-xs text-gray-400 mb-2">{person.communication_style}</p>
                    )}
                    {discTactics.length > 0 && (
                      <ul className="space-y-1">
                        {discTactics.map((t: string, i: number) => (
                          <li key={i} className="text-xs text-gray-300">• {t}</li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Opener suggestions */}
              {openers.length > 0 && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-300">Opener Suggestions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {openers.map((o, i) => (
                        <li key={i} className="text-xs text-gray-200 bg-gray-800 rounded p-2">
                          "{o}"
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Green/red flags from Task H */}
              {(Array.isArray(person.green_flags) || Array.isArray(person.red_flags)) && (
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-gray-300">Flags</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {Array.isArray(person.green_flags) && person.green_flags.map((f: string, i: number) => (
                      <p key={i} className="text-xs text-green-300">✓ {f}</p>
                    ))}
                    {Array.isArray(person.red_flags) && person.red_flags.map((f: string, i: number) => (
                      <p key={i} className="text-xs text-red-300">⚠ {f}</p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ── NOTES ── */}
          <TabsContent value="notes">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                {person.notes ? (
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{person.notes}</p>
                ) : person.context_notes ? (
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{person.context_notes}</p>
                ) : (
                  <p className="text-sm text-gray-500">No notes added yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── COMPOSE (AI-9500-G) ── */}
          <TabsContent value="compose">
            <Card className="bg-gray-900 border-gray-800 max-w-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-gray-300 flex items-center gap-1.5">
                  <PenLine className="w-3.5 h-3.5" />
                  Compose a Touch
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Whitelist brake warning */}
                {!person.whitelist_for_autoreply && (
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
                    <p className="text-xs text-amber-300">
                      This person is not whitelisted for autoreply.
                      Preview works — but Send is disabled until you enable{" "}
                      <code className="text-amber-200">whitelist_for_autoreply</code> in Obsidian.
                    </p>
                  </div>
                )}

                {/* Template picker */}
                {composeState !== "sent" && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                      Template
                    </label>
                    <select
                      value={composeTemplate}
                      onChange={(e) => {
                        setComposeTemplate(e.target.value);
                        handleReset();
                      }}
                      disabled={composeState === "generating"}
                      className="w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-50"
                    >
                      <option value="reply">Reply — standard cadence follow-up</option>
                      <option value="pattern_interrupt">Pattern Interrupt — soft restart</option>
                      <option value="callback_reference">Callback — "did you end up doing X?"</option>
                      <option value="digest_inclusion">Digest Inclusion — week check-in</option>
                      <option value="date_ask">Date Ask — propose meeting</option>
                      <option value="nudge">Nudge — soft re-engage</option>
                      <option value="morning_text">Morning Text</option>
                      <option value="reengage_low_temp">Re-engage (low temp)</option>
                      <option value="birthday_wish">Birthday Wish</option>
                      <option value="event_day_check">Event Day Check-in</option>
                      <option value="phone_swap_followup">Phone Swap Followup</option>
                      <option value="first_call_invite">First Call Invite</option>
                      <option value="date_confirm_24h">Date Confirm (T-24h)</option>
                      <option value="date_dayof">Date Day-Of</option>
                      <option value="date_postmortem">Date Post-Mortem</option>
                    </select>
                  </div>
                )}

                {/* Anti-loop collision banner */}
                {skipReason?.reason === "anti_loop_collision" && (
                  <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-300 font-medium">
                      Blocked: anti-loop collision
                    </p>
                    <p className="text-xs text-red-400 mt-0.5">
                      The same message pattern was sent to a different person in the last 7 days.
                      Edit the draft to make it more unique, then send again.
                    </p>
                    {skipReason.colliding_touch_id && (
                      <p className="text-xs text-red-500 mt-0.5">
                        Colliding touch: {skipReason.colliding_touch_id}
                      </p>
                    )}
                  </div>
                )}

                {/* Generic error */}
                {composeError && (
                  <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-300">{composeError}</p>
                  </div>
                )}

                {/* Draft textarea — shown after preview */}
                {(composeState === "drafted" || composeState === "sent") && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">
                      Draft Message
                      {composeState === "drafted" && (
                        <span className="ml-2 text-purple-400 normal-case">(edit before sending)</span>
                      )}
                    </label>
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      disabled={composeState === "sent"}
                      rows={5}
                      className="w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-purple-500 resize-y disabled:opacity-60"
                      placeholder="Your message will appear here…"
                    />
                  </div>
                )}

                {/* Sent confirmation */}
                {composeState === "sent" && (
                  <div className="bg-green-900/20 border border-green-700/40 rounded-lg px-3 py-2">
                    <p className="text-xs text-green-300 font-medium">
                      Touch committed — fires in ~30 seconds.
                    </p>
                    <p className="text-xs text-green-400 mt-0.5">
                      Check the Schedule tab to see it. The fireOne engine (with D&apos;s anti-loop check) handles the actual send.
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-1">
                  {composeState === "idle" && (
                    <Button
                      onClick={handlePreview}
                      className="bg-purple-700 hover:bg-purple-600 text-white text-xs"
                      size="sm"
                    >
                      <PenLine className="w-3.5 h-3.5 mr-1.5" />
                      Preview Draft
                    </Button>
                  )}

                  {composeState === "generating" && (
                    <Button disabled className="bg-gray-700 text-gray-400 text-xs" size="sm">
                      <Clock className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
                      Generating…
                    </Button>
                  )}

                  {composeState === "drafted" && (
                    <>
                      <Button
                        onClick={handleSend}
                        disabled={!person.whitelist_for_autoreply || !draftBody.trim()}
                        title={
                          !person.whitelist_for_autoreply
                            ? "Enable whitelist_for_autoreply in Obsidian first"
                            : undefined
                        }
                        className="bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs"
                        size="sm"
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Send
                      </Button>
                      <Button
                        onClick={handlePreview}
                        variant="outline"
                        className="border-gray-700 text-gray-300 hover:text-white text-xs"
                        size="sm"
                      >
                        Re-generate
                      </Button>
                    </>
                  )}

                  {composeState === "sent" && (
                    <Button
                      onClick={handleReset}
                      variant="outline"
                      className="border-gray-700 text-gray-300 hover:text-white text-xs"
                      size="sm"
                    >
                      Compose Another
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
