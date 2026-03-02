# Phase 26: Public Launch

## Status: NOT STARTED

## Overview

Coordinated public launch across Product Hunt, Twitter/X, Reddit, and press outreach. Goal: maximum day-one visibility, sign-ups, and social proof for the Clap Cheeks AI dating automation tool.

## Launch Channels

### 1. Product Hunt

**Timing:**
- Launch on Tuesday, Wednesday, or Thursday (highest traffic days)
- Launches go live at 12:01 AM PT; first 4 hours are critical
- PH hides upvote counts for first 4 hours to give fair exposure
- Schedule launch for 12:01 AM PT, have team ready from midnight

**Hunter Strategy:**
- Self-hunt (founder posts) or find a well-known Hunter with relevant audience
- If using a Hunter, build relationship 30+ days before launch
- Hunter's followers get notified on launch, driving initial traffic wave

**Product Hunt Listing:**
- Tagline: max 60 chars, compelling and clear
- Description: What it does, who it's for, what makes it unique
- Gallery: 5-6 images (hero screenshot, feature highlights, before/after results)
- Video: 60-90 second demo showing the local agent in action
- First comment: Founder's story -- why built it, personal angle, be genuine

**Upvote Strategy:**
- Do NOT buy votes or use fake accounts (PH detects and de-ranks)
- Notify existing users, email list, social followers at launch time
- Ask for genuine support, not "please upvote"
- Engage with every comment within minutes
- Votes from active PH accounts carry more weight

**Preparation (30 days before):**
- Create PH maker profile, fill out completely
- Start engaging on PH: upvote products, leave comments, be active
- Build a "Ship" page on PH to collect followers pre-launch
- Prepare all assets (screenshots, video, copy) 1 week before

### 2. Twitter/X Launch Thread

**Thread Structure:**
1. Hook: "I built an AI that automates your dating apps. Here's what happened." (screenshot of results)
2. Problem: The time sink of dating apps -- hours swiping, crafting messages, managing multiple apps
3. Solution: What Clap Cheeks does -- runs on your Mac, automates swiping, AI conversations
4. Demo: GIF or video clip showing the local agent working
5. Results: Specific metrics (matches per week, time saved, dates booked)
6. Tech: Brief technical angle (runs locally, privacy-first, no data leaves your Mac)
7. Pricing: Base $97/mo, Elite $197/mo -- "Your time is worth more than $3/day"
8. CTA: Link to clapcheeks.tech, launch-day discount or bonus

**Timing:** Post thread at 8-9 AM ET (peak Twitter engagement for US audience)

**Engagement Strategy:**
- Reply to every comment within the first 2 hours
- Quote-tweet with additional context
- Pin thread to profile
- Cross-post key tweets to Threads

### 3. Reddit

**Target Subreddits:**
| Subreddit | Approach | Notes |
|-----------|----------|-------|
| r/dating | Comment in relevant threads, not a direct promo post | Strict self-promo rules |
| r/Tinder | Share results, "I built something" angle | Receptive to tools |
| r/OnlineDating | Discussion about AI in dating | Active community |
| r/macapps | "New macOS app" announcement | Appropriate for launches |
| r/SideProject | "I built this" launch post | Very supportive community |
| r/startups | Launch announcement | Appropriate for Show HN style |
| r/IndieHackers | Cross-post from Indie Hackers site | Founder-friendly |

**Reddit Rules:**
- Never direct-post marketing links to dating subreddits
- Lead with value/story, mention the product naturally
- Engage genuinely in comments
- Post to r/SideProject and r/macapps where self-promo is welcomed
- Use text posts, not link posts

### 4. Press Kit

**Components:**

```
/public/press/
  logo-dark.svg
  logo-light.svg
  logo-icon.svg
  screenshot-dashboard.png
  screenshot-automation.png
  screenshot-analytics.png
  screenshot-pricing.png
  product-mockup.png          -- MacBook with app running
  founder-headshot.jpg
  press-kit.pdf               -- One-pager with all key info
```

**Press Kit PDF Contents:**
- Product name, tagline, URL
- What it does (2 sentences)
- Key features (5 bullet points)
- Pricing
- Founder bio and photo
- Company story (why built, personal angle)
- Key stats (if available: beta users, matches generated, time saved)
- Contact info
- High-res screenshots

**Press Page:** `/press` route with downloadable assets and copy-paste descriptions.

### 5. Influencer Outreach

**Target Niches:**
- Dating/relationships YouTube (50K-500K subscribers)
- Self-improvement/masculinity YouTube
- Mac app review channels
- Dating/lifestyle podcasts
- Twitter accounts with dating tips content

**Outreach Template:**
- Personal (reference their specific content)
- Brief product explanation
- Offer: free Elite account + affiliate commission (25% recurring via Rewardful from Phase 25)
- No pressure, genuine value proposition
- Send 2-3 weeks before launch

**Outreach Volume:** 30-50 targeted creators, expect 5-10 responses, aim for 3-5 launch-day mentions.

## Launch Day Checklist

### 1 Week Before
- [ ] All launch assets created and reviewed (screenshots, video, copy)
- [ ] Product Hunt listing drafted (tagline, description, gallery, first comment)
- [ ] Twitter thread written and scheduled
- [ ] Reddit posts drafted
- [ ] Press kit page live at `/press`
- [ ] Email blast to waitlist/beta users drafted
- [ ] Influencer outreach completed
- [ ] Monitoring tools set up (analytics, social mentions)

### Day Before
- [ ] Final review of all content
- [ ] Test all links (checkout, sign-up, download)
- [ ] Verify Stripe products/prices are live (not test mode)
- [ ] Verify webhook endpoint is registered and working
- [ ] Set up launch-day analytics tracking (UTM params per channel)
- [ ] Brief anyone helping with launch-day engagement

### Launch Day (12:01 AM PT)
- [ ] Product Hunt listing goes live
- [ ] Post founder's first comment on PH immediately
- [ ] Send launch email to waitlist
- [ ] Post Twitter thread (8-9 AM ET)
- [ ] Post to r/SideProject, r/macapps
- [ ] Notify affiliates to post
- [ ] Monitor PH comments -- reply to every one within 15 min
- [ ] Monitor Twitter mentions -- engage with everything
- [ ] Track signups and conversions in real-time

### Day After
- [ ] Thank PH community in maker comment
- [ ] Share results on Twitter (signups, rank, feedback)
- [ ] Follow up with press/influencer contacts who expressed interest
- [ ] Compile launch metrics: PH rank, signups, revenue, traffic sources
- [ ] Identify and fix any bugs reported during launch

## Launch-Day Offer (Optional)

Consider a launch-day incentive:
- First 100 subscribers get 50% off first month (Stripe coupon)
- Launch-day bonus: free Profile Doctor add-on with any plan
- Extended trial: 14 days free instead of standard 7

Create Stripe coupon in advance:
```
stripe coupons create \
  --percent-off=50 \
  --duration=once \
  --max-redemptions=100 \
  --name="Launch Day 50% Off" \
  --id=LAUNCH50
```

## Technical Preparation

### UTM Tracking

Use consistent UTM parameters across all channels:
```
?utm_source=producthunt&utm_medium=launch&utm_campaign=public-launch
?utm_source=twitter&utm_medium=thread&utm_campaign=public-launch
?utm_source=reddit&utm_medium=post&utm_campaign=public-launch&utm_content=sideproject
```

### Analytics Events

Track launch-specific events:
- `launch_visit` -- with source/medium
- `launch_signup` -- new account from launch traffic
- `launch_subscribe` -- conversion to paid from launch traffic

### Press Page Route

```
web/app/(main)/press/
  page.tsx -- Public press kit page with download links
```

## Implementation Steps

1. **Create Press Kit Assets**
   - Logo files in multiple formats
   - High-res product screenshots
   - Product mockup (MacBook)
   - Founder headshot
   - Press kit PDF one-pager

2. **Build Press Page**
   - `/press` route with asset downloads
   - Copy-paste product descriptions
   - Contact information

3. **Write Launch Content**
   - Product Hunt listing copy (tagline, description, first comment)
   - Twitter thread (8 tweets)
   - Reddit posts for each target subreddit
   - Email blast to waitlist

4. **Set Up Product Hunt**
   - Create/polish maker profile (30 days before)
   - Start engaging on PH community
   - Create "Ship" page for pre-launch followers
   - Upload gallery images and video

5. **Prepare Launch-Day Coupon**
   - Create Stripe coupon for launch offer
   - Add coupon support to checkout flow (accept `coupon` param)

6. **Set Up UTM Tracking**
   - Add UTM parameter capture to landing page
   - Store source/medium in signup metadata

7. **Create Launch Day War Room Plan**
   - Assign roles: PH monitor, Twitter engagement, Reddit, support
   - Set up real-time dashboard for signups and revenue

8. **Execute Launch**
   - Follow launch day checklist
   - Monitor and engage for full 24 hours

9. **Post-Launch Analysis**
   - Compile metrics by channel
   - Document lessons learned
   - Plan follow-up marketing

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PH listing gets unfeatured | No PH traffic | Follow rules strictly; no vote manipulation; be genuine |
| Infrastructure can't handle traffic | Bad first impression | Load test before launch; ensure Vercel auto-scales |
| Negative feedback about "dating automation" | PR issue | Prepare responses; emphasize privacy, time-saving, not catfishing |
| Low conversion from traffic | Wasted launch | Have clear CTAs, simple onboarding, launch-day offer |
| Bug on launch day | User churn | Feature freeze 1 week before; test everything day before |
| Reddit self-promo removal | Lost channel | Only post where allowed; lead with value/story |
