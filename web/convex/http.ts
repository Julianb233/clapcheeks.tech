/**
 * AI-9449 Wave 2.3C — Convex HTTP endpoints.
 *
 * Public iPhone-Shortcut + webhook surfaces:
 *   POST /clapcheeks/media-upload  — iPhone Shortcut posts an image with
 *                                    a caption + optional kind hint header.
 *                                    Auto-routes to autoTagMedia (default) or
 *                                    profile-screenshot analysis when kind=profile.
 *
 * Auth: shared HMAC token in `x-cc-token` header (env CC_MEDIA_UPLOAD_TOKEN).
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/clapcheeks/media-upload",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.CC_MEDIA_UPLOAD_TOKEN;
    const provided = req.headers.get("x-cc-token");
    if (!expected) {
      return new Response(JSON.stringify({ error: "server_token_unset" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
    if (provided !== expected) {
      return new Response(JSON.stringify({ error: "auth" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }

    const caption = req.headers.get("x-cc-caption") ?? "";
    const kind_hint = (req.headers.get("x-cc-kind") ?? "media").toLowerCase();
    const platform = req.headers.get("x-cc-platform") ?? "";
    const mime = req.headers.get("content-type") ?? "image/jpeg";
    const blob = await req.blob();
    if (!blob.size) {
      return new Response(JSON.stringify({ error: "empty_body" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const storageId = await ctx.storage.store(blob);
    const storageUrl = await ctx.storage.getUrl(storageId);
    if (!storageUrl) {
      return new Response(JSON.stringify({ error: "storage_url_failed" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const assetId = `iphone-${storageId.toString().slice(0, 24)}`;
    const kind = mime.startsWith("video/") ? "video"
              : mime.includes("gif") ? "gif" : "image";

    const isProfile = kind_hint === "profile" || kind_hint === "profile_screenshot";

    const result: any = await ctx.runMutation(api.media.upload, {
      user_id: process.env.CONVEX_FLEET_USER_ID ?? "fleet-julian",
      asset_id: assetId,
      kind: kind as any,
      storage_url: storageUrl,
      mime_type: mime,
      file_size_bytes: blob.size,
      caption: isProfile
        ? `Profile screenshot${platform ? ` (${platform})` : ""}: ${caption}`
        : caption,
      upload_source: "iphone",
    });

    if (isProfile && result?.asset_id) {
      await ctx.runMutation(api.media.markAsProfileScreenshot, {
        asset_id: result.asset_id,
        platform: platform || undefined,
      });
      await ctx.scheduler.runAfter(0, internal.profile_import.analyzeAsProfile, {
        media_id: result.asset_id,
      });
    }

    return new Response(JSON.stringify({
      asset_id: assetId,
      convex_id: result?._id,
      storage_url: storageUrl,
      bytes: blob.size,
      caption,
      kind: isProfile ? "profile_screenshot" : "media",
    }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/clapcheeks/media-upload",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-cc-token, x-cc-caption, x-cc-kind, x-cc-platform",
    },
  })),
});

export default http;
