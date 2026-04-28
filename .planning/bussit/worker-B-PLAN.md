# Worker-B Plan — AI-8815 Reactivation Playbook

**Status:** In Progress  
**Branch:** AI-8815-reactivation-playbook  

## Files to Create

1. `docs/playbooks/README.md` — playbook system overview
2. `docs/playbooks/reactivation-campaign.md` — THE main playbook (3000+ words)
3. `docs/playbooks/banned-phrases.json` — machine-readable banned phrases
4. `docs/playbooks/templates/reactivation-tracker.md` — non-tech operator tracker
5. `docs/playbooks/templates/reactivation-decision-tree.md` — decision tree
6. Update `agent/clapcheeks/followup/reactivation.py` — add doc-string pointing to playbook

## Key Research Findings Shaping the Playbook

1. **MIT Sloan dormant ties research**: dormant contacts provide MORE novel value than active ones because they accumulated new experiences during the gap. This reframes reactivation from "fixing failure" to "activating latent value."
2. **Gap-acknowledgment psychology**: naming the gap forces the recipient to relitigate why they stopped responding. Jumping over it (Manson, Kennedy, every email marketing playbook) converts better because it treats the silence as neutral.
3. **Cross-domain attempt caps**: Manson's 3 chances, Klaviyo's 3-email winback, Bloomreach sunset rule — all converge on 2-3 attempts max. Clapcheeks uses 2, which is appropriate and validated.

## Ethical Frame
The playbook is about respect and honest outreach — not manipulation. Every technique documented enables genuine reconnection that respects recipient agency. Anything coercive, guilt-inducing, or high-pressure is explicitly documented as wrong and why.
