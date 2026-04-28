# Playbooks — Clapcheeks Methodology Library

This directory contains teachable, domain-agnostic methodology playbooks extracted from the Clapcheeks AI Dating Co-Pilot system.

## What a Playbook Is

A playbook documents a battle-tested methodology in a format that any operator — technical or not — can pick up and apply the same day. Playbooks:

- Are grounded in research and data, not opinion
- Include concrete examples (good and bad)
- Work with or without the Clapcheeks tooling
- Map explicitly to cross-domain use cases (dating, sales, networking, client recovery)
- Respect recipient agency — nothing coercive or manipulative

## Available Playbooks

| Playbook | Description | Cross-domain |
|----------|-------------|--------------|
| [reactivation-campaign.md](./reactivation-campaign.md) | Ghost-recovery and re-engagement methodology | Dating, sales, networking, lapsed clients |

## Playbook Structure Standard

Every playbook follows this structure:

```
Part 1: Universal Strategy      — works for any domain, no tooling required
Part 2: Clapcheeks Implementation — how it maps to the codebase
Part 3: Cross-Domain Adaptations  — 4 explicit non-dating use cases
Part 4: Operator Manual           — non-technical step-by-step guide
Bibliography                      — cited research sources
```

## Adding a New Playbook

1. Create `docs/playbooks/<name>.md` using the structure above
2. If it introduces new banned phrases or replacement patterns, add them to `banned-phrases.json`
3. Add a row to the table in this README
4. If the playbook maps to agent behavior, add a doc-string reference in the relevant agent module

## Templates

- `templates/reactivation-tracker.md` — copy-paste table for tracking ghosted contacts (no tooling needed)
- `templates/reactivation-decision-tree.md` — decision tree for when to reach out, when to wait, when to walk away

## Machine-Readable Data

- `banned-phrases.json` — structured list of phrases the AI sanitizer enforces, loadable by any domain configuration
