// AI-9545 — runner-compat shim. The Mac Mini runner calls the function path
// `media_assets:get` (mirroring the table name) but the canonical media
// module lives at `media.ts`. This file re-exports the same query at the
// path the runner expects.

import { query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { id: v.id("media_assets") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
