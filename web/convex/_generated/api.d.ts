/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_jobs from "../agent_jobs.js";
import type * as backfill from "../backfill.js";
import type * as calendar from "../calendar.js";
import type * as coach from "../coach.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as digest from "../digest.js";
import type * as drip from "../drip.js";
import type * as enrichment from "../enrichment.js";
import type * as http from "../http.js";
import type * as inbound from "../inbound.js";
import type * as media from "../media.js";
import type * as messages from "../messages.js";
import type * as opener from "../opener.js";
import type * as people from "../people.js";
import type * as profile_import from "../profile_import.js";
import type * as scheduled_messages from "../scheduled_messages.js";
import type * as touches from "../touches.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent_jobs: typeof agent_jobs;
  backfill: typeof backfill;
  calendar: typeof calendar;
  coach: typeof coach;
  conversations: typeof conversations;
  crons: typeof crons;
  digest: typeof digest;
  drip: typeof drip;
  enrichment: typeof enrichment;
  http: typeof http;
  inbound: typeof inbound;
  media: typeof media;
  messages: typeof messages;
  opener: typeof opener;
  people: typeof people;
  profile_import: typeof profile_import;
  scheduled_messages: typeof scheduled_messages;
  touches: typeof touches;
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
