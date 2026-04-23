# AI-8327 Phase 42: Scheduled Messaging — Visual Architecture

## ASCII

```
┌──────────────┐   ┌──────────────────────┐   ┌──────────────────┐
│   User UI    │──▶│ /settings/ai         │──▶│ followup_config  │
│ settings tab │   │ (delays + enabled)   │   │ (supabase)       │
└──────────────┘   └──────────────────────┘   └──────────────────┘
                                                        │
┌──────────────┐   ┌──────────────────────┐             ▼
│ Match detail │──▶│ POST /followup/      │   ┌──────────────────┐
│ "Follow up"  │   │   trigger            │──▶│ scheduled_msgs   │
└──────────────┘   │ - AI message         │   │ (pending)        │
                   │ - optimal timing     │   └──────────────────┘
                   └──────────────────────┘             │
                                                        ▼
┌──────────────┐   ┌──────────────────────┐   ┌──────────────────┐
│ Autonomy     │──▶│ POST /followup/      │──▶│ scheduled_msgs   │
│ (warmth≥T)   │   │   app-to-text        │   │ (app_to_text)    │
└──────────────┘   └──────────────────────┘   └──────────────────┘
                                                        │
┌──────────────┐   ┌──────────────────────┐             ▼
│ /scheduled   │──▶│ Approve / Reject     │──▶│ status:approved  │
│ page         │   │ One-tap actions      │   └──────────────────┘
└──────────────┘   └──────────────────────┘             │
                                                        ▼
                                              ┌──────────────────┐
                                              │ POST /send       │
                                              │ god draft --delay│
                                              └──────────────────┘
```

## Components

| Component | Purpose | In | Out |
|-----------|---------|----|----|
| followup_sequences table | Per-user config: delays, enabled, warmth threshold | user_id | delays_hours[], warmth_threshold |
| /api/followup-sequences | CRUD config | auth | config json |
| /api/followup-sequences/trigger | Create a follow-up for a match | match_name, phone, conv | scheduled_message |
| /api/followup-sequences/app-to-text | Create transition message when warmth≥threshold | match_name, warmth | scheduled_message |
| optimal-timing lib | Pick best local-time window | user tz, history | ISO datetime |
| settings UI | Configure delays + warmth | config | config PATCH |
