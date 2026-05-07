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
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as drip from "../drip.js";
import type * as messages from "../messages.js";
import type * as people from "../people.js";
import type * as scheduled_messages from "../scheduled_messages.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent_jobs: typeof agent_jobs;
  conversations: typeof conversations;
  crons: typeof crons;
  drip: typeof drip;
  messages: typeof messages;
  people: typeof people;
  scheduled_messages: typeof scheduled_messages;
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
