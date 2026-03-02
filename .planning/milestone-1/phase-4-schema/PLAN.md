# Phase 4: Database Schema

## Goal
Create all Supabase tables needed for the SaaS platform.

## Tables

### users_profile
Extends Supabase auth.users with app-specific fields.
- id (uuid, FK to auth.users)
- plan (text: starter/pro/elite)
- stripe_customer_id
- trial_ends_at
- created_at

### devices
Registered local agents for each user.
- id, user_id, device_name, platform, agent_version
- last_seen_at, is_active

### analytics_daily
Daily anonymized metrics per user.
- user_id, date
- swipes_right, swipes_left, matches, conversations_started
- dates_booked, money_spent
- apps: tinder|bumble|hinge

### ai_suggestions
AI coaching suggestions generated for users.
- user_id, suggestion_text, category, was_helpful

### subscriptions
Stripe subscription tracking.
- user_id, stripe_subscription_id, plan, status
- current_period_start, current_period_end

## Tasks
- [ ] Write migration SQL for all tables
- [ ] Apply to Supabase
- [ ] Add RLS policies (users only see their own data)
- [ ] Create TypeScript types for web/ and api/

## Acceptance Criteria
- All tables created in Supabase
- RLS enabled on all tables
- TypeScript types auto-generated
