export interface DateQuestion {
  id: string
  prompt: string
  purpose: string
  whisperHint?: string
}

/**
 * Seed questions — always asked first so the AI has baseline context before
 * branching into adaptive follow-ups. Order matters: light → deeper.
 */
export const SEED_QUESTIONS: DateQuestion[] = [
  {
    id: 'intro',
    prompt: "Hey, thanks for doing this. I'm gonna ask you stuff like we're on a real first date — just talk, no right answers. Start easy: what do you do during the day and do you actually like it?",
    purpose: 'Daily life + work satisfaction',
  },
  {
    id: 'home',
    prompt: "Where do you live and how'd you end up there? Do you feel at home there, or is it more of a pit-stop?",
    purpose: 'Geography + rootedness',
  },
  {
    id: 'weekend',
    prompt: "What's a perfect weekend look like for you? Not Instagram-perfect — what actually makes you feel good by Sunday night?",
    purpose: 'Lifestyle + what recharges them',
  },
  {
    id: 'dating-history',
    prompt: "Been on dating apps much? What's been working, what hasn't, and what's your honest read on why?",
    purpose: 'Dating app context + self-awareness',
  },
  {
    id: 'ideal',
    prompt: "Describe the woman you actually want — not the checklist version, the one you'd be genuinely excited to text every morning.",
    purpose: 'Ideal partner (qualities not demographics)',
  },
  {
    id: 'dealbreakers',
    prompt: "What's a dealbreaker for you — something where you'd rather be alone than compromise on?",
    purpose: 'Non-negotiables',
    whisperHint: 'dealbreaker, values, compromise',
  },
  {
    id: 'last-great-date',
    prompt: "Tell me about the best date you've ever been on. Doesn't have to be with someone you ended up with — just the night itself.",
    purpose: 'Stories + what "connection" means to them',
  },
  {
    id: 'flirting-style',
    prompt: "When you like someone, how does it show? Do you tease, compliment, get shy, get direct — what's your actual vibe?",
    purpose: 'Flirting style the AI should mimic',
  },
  {
    id: 'bad-pattern',
    prompt: "Honest moment: what's a pattern you keep falling into with dating or relationships that you'd like to break?",
    purpose: 'Self-aware growth areas',
  },
  {
    id: 'turn-ons',
    prompt: "What makes you instantly more interested in someone — could be something she says, does, wears, whatever.",
    purpose: 'Attraction triggers',
  },
  {
    id: 'ick',
    prompt: "What gives you the ick? Something that kills it for you even if she's great on paper.",
    purpose: 'Turn-offs / icks',
  },
  {
    id: 'first-date-preference',
    prompt: "What's your go-to first date? And what would make a first date memorable to you — not to her, to you?",
    purpose: 'Date planning preferences',
  },
  {
    id: 'texting-style',
    prompt: "How do you like texting with someone you're into? Fast back-and-forth, slower and thoughtful, voice notes, memes, what?",
    purpose: 'Texting cadence the AI co-pilot should match',
  },
  {
    id: 'humor',
    prompt: "What's funny to you? Dry, absurd, dark, dirty, dad-joke-cringe — be specific. And what kind of humor do you want from her?",
    purpose: 'Humor matching',
  },
  {
    id: 'bragging',
    prompt: "Brag on yourself for a sec — what should I know about you that would make me go 'oh, okay, interesting guy'?",
    purpose: 'Confidence + bragging rights for profile',
  },
  {
    id: 'vulnerable',
    prompt: "Something most people don't know about you — or something you'd want a partner to eventually know.",
    purpose: 'Depth + vulnerability',
  },
  {
    id: 'life-goal',
    prompt: "What are you building toward in the next 2-3 years? Could be work, could be personal, could be weird.",
    purpose: 'Trajectory / ambition',
  },
  {
    id: 'family',
    prompt: "How do you feel about your family, and what's your read on what you want for your own someday — kids, marriage, none of the above?",
    purpose: 'Family + long-term posture',
  },
  {
    id: 'physical',
    prompt: "Without being creepy — what physically attracts you? Types, features, vibes, whatever feels true.",
    purpose: 'Physical attraction honesty',
  },
  {
    id: 'closing',
    prompt: "Last one: if I set you up with someone tonight, what's the one thing I should tell her about you so she'd actually want to show up?",
    purpose: 'Synthesized pitch / self-summary',
  },
]

export function getQuestionById(id: string): DateQuestion | undefined {
  return SEED_QUESTIONS.find((q) => q.id === id)
}

export function getNextSeedQuestion(answeredIds: string[]): DateQuestion | null {
  for (const q of SEED_QUESTIONS) {
    if (!answeredIds.includes(q.id)) return q
  }
  return null
}
