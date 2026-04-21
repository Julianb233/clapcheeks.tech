"""Phase L (AI-8340) - Instagram content library + auto-posting.

Julian's IG presence is the second half of the dating funnel. Once a
match opens his profile a stale or thirsty grid tanks the conversion
rate. This package:

* picks candidate library rows for a 7-day schedule (``scheduler``),
* drains due rows into the Phase M agent-jobs queue for the extension
  to actually upload (``publisher``),
* exposes ``check_ig_freshness(user_id)`` so Phase G's drafter can
  gate high-score openers behind a recent story post.

Auto-categorization from Claude Vision lives in ``categorize``.
"""
from clapcheeks.content.scheduler import (  # noqa: F401
    build_weekly_plan,
    save_plan_to_queue,
    categories_ratio,
)
from clapcheeks.content.publisher import (  # noqa: F401
    drain_due,
    post_library_item_now,
    check_ig_freshness,
)
from clapcheeks.content.categorize import (  # noqa: F401
    categorize_with_vision,
    PERSONA_CATEGORY_KEYS,
)
