"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

const STAGE_COLORS: Record<string, string> = {
  stranger: "bg-gray-700 text-gray-300",
  aware: "bg-blue-900 text-blue-300",
  warm: "bg-yellow-900 text-yellow-300",
  interested: "bg-orange-900 text-orange-300",
  invested: "bg-purple-900 text-purple-300",
  committed: "bg-green-900 text-green-300",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-400",
  lead: "bg-blue-400",
  paused: "bg-yellow-400",
  archived: "bg-gray-500",
};

type StatusFilter = "active" | "lead" | "paused" | "archived" | "ghosted" | "dating" | "ended";

function ScoreBar({ value, color }: { value?: number; color: string }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div className="flex items-center gap-1">
      <div className="h-1.5 w-16 rounded-full bg-gray-700">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500">{pct}</span>
    </div>
  );
}

function PersonRow({ person }: { person: any }) {
  const primaryHandle =
    person.handles?.find((h: any) => h.primary)?.value ??
    person.handles?.[0]?.value ??
    person.handle ??
    "—";

  const platforms: string[] = Array.from(
    new Set(
      (person.handles ?? []).map((h: any) => h.platform as string)
    )
  );

  return (
    <Link
      href={`/admin/clapcheeks-ops/people/${person._id}`}
      className="flex items-center gap-4 rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 transition hover:border-purple-700/50 hover:bg-gray-900"
    >
      {/* Status dot */}
      <span
        className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[person.status] ?? "bg-gray-600"}`}
      />

      {/* Name + handle */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-white">
          {person.display_name ?? person.name ?? "Unnamed"}
        </p>
        <p className="truncate text-sm text-gray-400">{primaryHandle}</p>
      </div>

      {/* Stage badge */}
      {person.courtship_stage && (
        <Badge
          className={`shrink-0 text-xs ${STAGE_COLORS[person.courtship_stage] ?? "bg-gray-700 text-gray-300"}`}
        >
          {person.courtship_stage}
        </Badge>
      )}

      {/* Trust / engagement mini bars */}
      <div className="hidden flex-col gap-1 sm:flex">
        <ScoreBar value={person.trust_score} color="bg-purple-500" />
        <ScoreBar value={person.engagement_score} color="bg-blue-500" />
      </div>

      {/* Platform badges */}
      <div className="hidden gap-1 lg:flex">
        {platforms.slice(0, 3).map((p) => (
          <Badge key={p} variant="outline" className="border-gray-700 text-xs text-gray-400">
            {p}
          </Badge>
        ))}
      </div>

      {/* Chevron */}
      <svg
        className="ml-2 h-4 w-4 shrink-0 text-gray-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default function NetworkPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const people = useQuery(api.people.list, {
    status: statusFilter,
  });

  const filters: { label: string; value: StatusFilter }[] = [
    { label: "Active", value: "active" },
    { label: "Leads", value: "lead" },
    { label: "Dating", value: "dating" },
    { label: "Paused", value: "paused" },
    { label: "Ghosted", value: "ghosted" },
    { label: "Ended", value: "ended" },
  ];

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Network</h1>
        <p className="mt-1 text-sm text-gray-400">
          Everyone you&apos;re building a connection with
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              statusFilter === f.value
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {people === undefined && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
        </div>
      )}

      {people !== undefined && people.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <span className="text-5xl">🤍</span>
          <p className="text-lg font-medium text-gray-300">No people here yet</p>
          <p className="text-sm text-gray-500">
            Import someone from a{" "}
            <Link
              href="/admin/clapcheeks-ops/profile-imports"
              className="text-purple-400 hover:underline"
            >
              profile screenshot
            </Link>{" "}
            to get started.
          </p>
        </div>
      )}

      {people !== undefined && people.length > 0 && (
        <div className="flex flex-col gap-2">
          {people.map((person: any) => (
            <PersonRow key={person._id} person={person} />
          ))}
        </div>
      )}
    </div>
  );
}
