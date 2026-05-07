/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentDeviceTokens from "../agentDeviceTokens.js";
import type * as agent_jobs from "../agent_jobs.js";
import type * as backfill from "../backfill.js";
import type * as billing from "../billing.js";
import type * as calendar from "../calendar.js";
import type * as calendarTokens from "../calendarTokens.js";
import type * as calls from "../calls.js";
import type * as coach from "../coach.js";
import type * as coaching from "../coaching.js";
import type * as cohort_retro from "../cohort_retro.js";
import type * as conversation_stats from "../conversation_stats.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as date_logistics from "../date_logistics.js";
import type * as debrief from "../debrief.js";
import type * as devices from "../devices.js";
import type * as digest from "../digest.js";
import type * as drip from "../drip.js";
import type * as drips from "../drips.js";
import type * as enrichment from "../enrichment.js";
import type * as http from "../http.js";
import type * as inbound from "../inbound.js";
import type * as matches from "../matches.js";
import type * as media from "../media.js";
import type * as media_assets from "../media_assets.js";
import type * as memos from "../memos.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as opener from "../opener.js";
import type * as outbound from "../outbound.js";
import type * as people from "../people.js";
import type * as platformTokens from "../platformTokens.js";
import type * as profile_import from "../profile_import.js";
import type * as queues from "../queues.js";
import type * as referrals from "../referrals.js";
import type * as reportPreferences from "../reportPreferences.js";
import type * as reports from "../reports.js";
import type * as scheduled_messages from "../scheduled_messages.js";
import type * as spending from "../spending.js";
import type * as telemetry from "../telemetry.js";
import type * as touches from "../touches.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentDeviceTokens: typeof agentDeviceTokens;
  agent_jobs: typeof agent_jobs;
  backfill: typeof backfill;
  billing: typeof billing;
  calendar: typeof calendar;
  calendarTokens: typeof calendarTokens;
  calls: typeof calls;
  coach: typeof coach;
  coaching: typeof coaching;
  cohort_retro: typeof cohort_retro;
  conversation_stats: typeof conversation_stats;
  conversations: typeof conversations;
  crons: typeof crons;
  date_logistics: typeof date_logistics;
  debrief: typeof debrief;
  devices: typeof devices;
  digest: typeof digest;
  drip: typeof drip;
  drips: typeof drips;
  enrichment: typeof enrichment;
  http: typeof http;
  inbound: typeof inbound;
  matches: typeof matches;
  media: typeof media;
  media_assets: typeof media_assets;
  memos: typeof memos;
  messages: typeof messages;
  notifications: typeof notifications;
  opener: typeof opener;
  outbound: typeof outbound;
  people: typeof people;
  platformTokens: typeof platformTokens;
  profile_import: typeof profile_import;
  queues: typeof queues;
  referrals: typeof referrals;
  reportPreferences: typeof reportPreferences;
  reports: typeof reports;
  scheduled_messages: typeof scheduled_messages;
  spending: typeof spending;
  telemetry: typeof telemetry;
  touches: typeof touches;
  voice: typeof voice;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
