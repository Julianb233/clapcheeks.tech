# Phase 3: Auth

## Goal
User authentication via Supabase Auth (email + Google OAuth).

## Tasks
- [ ] Set up Supabase project (reuse fleet Supabase or create new)
- [ ] Add @supabase/supabase-js and @supabase/ssr to web/
- [ ] Create /login page (email + Google OAuth buttons)
- [ ] Create /signup page
- [ ] Create Supabase middleware for protected routes
- [ ] Protect /dashboard behind auth
- [ ] Add user profile table migration
- [ ] Test full auth flow

## Acceptance Criteria
- Unauthenticated users redirected to /login when accessing /dashboard
- Email/password signup and login works
- Google OAuth works
- User session persists across page refreshes
