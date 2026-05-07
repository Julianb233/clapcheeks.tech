/**
 * AI-9500 Wave 2 #I — Date logistics checklist.
 *
 * When a date_ask touch gets ask_outcome="yes", a checklist row is
 * auto-created via _createForTouch (internalMutation). The operator
 * ticks items off from the dossier Schedule tab or the upcoming-dates
 * operator view at /admin/clapcheeks-ops/upcoming-dates.
 *
 * Default items (in order):
 *   reservation_made       — Make / confirm the reservation
 *   meeting_place_sent     — Send her the address / meet-up spot
 *   weather_backup         — Check forecast; have a backup plan
 *   drink_pre_order        — Pre-order a signature drink or know the menu
 *   transit_ping_scheduled — Schedule a "heading out" transit ping
 *   outfit_set             — Outfit decided
 *   post_date_recovery_plan — Recovery plan (next-morning follow-up idea)
 */

import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Default item definitions
// ---------------------------------------------------------------------------

const DEFAULT_ITEMS: Array<{ key: string; label: string }> = [
  { key: "reservation_made",       label: "Make / confirm the reservation" },
  { key: "meeting_place_sent",     label: "Send her the address / meet-up spot" },
  { key: "weather_backup",         label: "Check forecast & have a backup plan" },
  { key: "drink_pre_order",        label: "Pre-order / know the menu" },
  { key: "transit_ping_scheduled", label: "Schedule a 'heading out' transit ping" },
  { key: "outfit_set",             label: "Outfit decided" },
  { key: "post_date_recovery_plan",label: "Plan next-morning follow-up idea" },
];

// ---------------------------------------------------------------------------
// _createForTouch — internalMutation
// Called from messages.ts ask_outcome classifier when outcome === "yes".
// Idempotent: if a checklist already exists for this touch, returns existing.
// ---------------------------------------------------------------------------

export const _createForTouch = internalMutation({
  args: {
    touch_id:  v.id("scheduled_touches"),
    person_id: v.id("people"),
    user_id:   v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotency: skip if a checklist already exists for this touch.
    const existing = await ctx.db
      .query("date_logistics_checklists")
      .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
      .filter((q) => q.eq(q.field("touch_id"), args.touch_id))
      .first();
    if (existing) return existing._id;

    const now = Date.now();

    // Pull date_time_ms from the touch's prompt_template (JSON blob).
    const touch = await ctx.db.get(args.touch_id);
    let date_time_ms = now + 7 * 24 * 60 * 60 * 1000; // fallback: 1 week out
    let venue: string | undefined;
    if (touch?.prompt_template) {
      try {
        const meta = JSON.parse(touch.prompt_template);
        if (meta.date_time_ms) date_time_ms = meta.date_time_ms;
        if (meta.venue) venue = meta.venue;
      } catch { /* ignore malformed JSON */ }
    }

    const items = DEFAULT_ITEMS.map((item) => ({
      key:   item.key,
      label: item.label,
      done:  false,
    }));

    const checklistId = await ctx.db.insert("date_logistics_checklists", {
      user_id:     args.user_id,
      person_id:   args.person_id,
      touch_id:    args.touch_id,
      date_time_ms,
      venue,
      items,
      status:      "active",
      created_at:  now,
      updated_at:  now,
    });

    return checklistId;
  },
});

// ---------------------------------------------------------------------------
// listForUser — query
// Returns all active checklists for an operator, ordered by date_time_ms.
// ---------------------------------------------------------------------------

export const listForUser = query({
  args: {
    user_id: v.string(),
    include_completed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("date_logistics_checklists")
      .withIndex("by_user", (q) => q.eq("user_id", args.user_id))
      .collect();

    if (!args.include_completed) {
      rows = rows.filter((r) => r.status === "active");
    }

    // Enrich each checklist with person display_name for the operator view.
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const person = await ctx.db.get(r.person_id);
        return {
          ...r,
          person_name: person?.display_name ?? "Unknown",
          person_courtship_stage: person?.courtship_stage,
        };
      })
    );

    // Sort by date_time_ms ascending (soonest first).
    enriched.sort((a, b) => a.date_time_ms - b.date_time_ms);
    return enriched;
  },
});

// ---------------------------------------------------------------------------
// listForPerson — query
// Returns all checklists for a specific person (used in dossier Schedule tab).
// ---------------------------------------------------------------------------

export const listForPerson = query({
  args: {
    person_id: v.id("people"),
    include_completed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("date_logistics_checklists")
      .withIndex("by_person", (q) => q.eq("person_id", args.person_id))
      .collect();

    if (!args.include_completed) {
      rows = rows.filter((r) => r.status === "active");
    }

    rows.sort((a, b) => a.date_time_ms - b.date_time_ms);
    return rows;
  },
});

// ---------------------------------------------------------------------------
// tickItem — mutation
// Toggle one checklist item done/undone. Optionally attach notes.
// ---------------------------------------------------------------------------

export const tickItem = mutation({
  args: {
    checklist_id: v.id("date_logistics_checklists"),
    key:          v.string(),
    done:         v.boolean(),
    notes:        v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const checklist = await ctx.db.get(args.checklist_id);
    if (!checklist) throw new Error(`Checklist ${args.checklist_id} not found`);

    const now = Date.now();
    const updatedItems = checklist.items.map((item) => {
      if (item.key !== args.key) return item;
      return {
        ...item,
        done:       args.done,
        done_at_ms: args.done ? now : undefined,
        notes:      args.notes !== undefined ? args.notes : item.notes,
      };
    });

    await ctx.db.patch(args.checklist_id, {
      items:      updatedItems,
      updated_at: now,
    });

    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// complete — mutation
// Mark an entire checklist as completed (all items ticked, date happened).
// ---------------------------------------------------------------------------

export const complete = mutation({
  args: {
    checklist_id: v.id("date_logistics_checklists"),
  },
  handler: async (ctx, args) => {
    const checklist = await ctx.db.get(args.checklist_id);
    if (!checklist) throw new Error(`Checklist ${args.checklist_id} not found`);

    const now = Date.now();
    // Tick any remaining items as done.
    const completedItems = checklist.items.map((item) => ({
      ...item,
      done:       true,
      done_at_ms: item.done_at_ms ?? now,
    }));

    await ctx.db.patch(args.checklist_id, {
      items:      completedItems,
      status:     "completed",
      updated_at: now,
    });

    return { ok: true };
  },
});
