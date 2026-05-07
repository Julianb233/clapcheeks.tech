// Single-tenant MVP indirection. All Convex data is stored under one
// canonical operator user_id ("fleet-julian"). Auth still happens via
// Supabase, but every Convex query/mutation must use this helper instead
// of supabase.auth.getUser().id.
//
// When this product becomes multi-tenant, swap this for a real lookup
// (Supabase user.id -> Convex users.byEmail row -> stored fleet user_id).
export function getFleetUserId(): string {
  return process.env.NEXT_PUBLIC_CONVEX_FLEET_USER_ID || 'fleet-julian'
}
