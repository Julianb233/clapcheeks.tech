import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const publicRoutes = [
    "/",
    "/auth/login",
    "/auth/sign-up",
    "/auth/sign-up-success",
    "/auth/verify-email",
    "/diagnostics",
  ]
  const isPublicRoute = publicRoutes.some((route) => request.nextUrl.pathname.startsWith(route))

  // Redirect unauthenticated users to login (except for public routes)
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return NextResponse.redirect(url)
  }

  if (user && !user.email_confirmed_at && !isPublicRoute && !request.nextUrl.pathname.startsWith("/complete-profile")) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/verify-email"
    return NextResponse.redirect(url)
  }

  if (user && user.email_confirmed_at && !request.nextUrl.pathname.startsWith("/complete-profile") && !isPublicRoute) {
    const { data: profile } = await supabase.from("profiles").select("profile_completed").eq("id", user.id).single()

    // Redirect to profile completion if not completed
    if (profile && !profile.profile_completed) {
      const url = request.nextUrl.clone()
      url.pathname = "/complete-profile"
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
