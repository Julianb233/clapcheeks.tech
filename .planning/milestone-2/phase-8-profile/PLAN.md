---
phase: 08-profile
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/outward/profile.py
  - agent/outward/commands/__init__.py
  - agent/outward/commands/profile.py
  - agent/outward/cli.py
  - agent/tests/test_profile.py
autonomous: true

must_haves:
  truths:
    - "User can run `outward profile setup` and complete an interactive wizard that saves preferences to ~/.clapcheeks/profile.json"
    - "User can run `outward profile show` and see their saved profile rendered in a rich table"
    - "User can run `outward profile edit` to update individual fields without re-running the full wizard"
    - "Profile data persists across CLI invocations via local JSON file"
    - "Profile file is never synced to cloud — purely local storage"
  artifacts:
    - path: "agent/outward/profile.py"
      provides: "Profile dataclass, load/save functions, JSON schema"
      exports: ["Profile", "load_profile", "save_profile", "PROFILE_PATH"]
    - path: "agent/outward/commands/profile.py"
      provides: "CLI commands: setup, show, edit"
      exports: ["profile"]
    - path: "agent/tests/test_profile.py"
      provides: "Unit tests for profile load/save/defaults"
  key_links:
    - from: "agent/outward/commands/profile.py"
      to: "agent/outward/profile.py"
      via: "imports Profile, load_profile, save_profile"
      pattern: "from outward\\.profile import"
    - from: "agent/outward/cli.py"
      to: "agent/outward/commands/profile.py"
      via: "click group registration"
      pattern: "main\\.add_command\\(profile\\)"
---

<objective>
Build the dating profile manager for the Outward CLI agent. Users define their preferences, attraction criteria, dealbreakers, and conversation style via an interactive wizard. Profile is stored locally at ~/.clapcheeks/profile.json and will be consumed by future automation phases (swiping logic, messaging AI).

Purpose: Without a profile, the agent has no context for making swipe decisions or generating personalized messages. This is the data backbone for all AI-powered features.
Output: Profile dataclass module, CLI commands (setup/show/edit), interactive wizard, unit tests.
</objective>

<context>
@.planning/ROADMAP.md
@agent/outward/cli.py — existing CLI entry point, click group named `main`
@agent/outward/config.py — existing config pattern (load/save to ~/.outward/config.yaml)
@agent/setup.py — package uses `outward` namespace, entry point is `outward.cli:main`
@agent/requirements.txt — click, rich, questionary already installed
</context>

<tasks>

<task type="auto">
  <name>Task 1: Profile dataclass and JSON persistence</name>
  <files>
    agent/outward/profile.py
    agent/tests/test_profile.py
  </files>
  <action>
Create `agent/outward/profile.py` with:

1. **PROFILE_DIR** = `Path.home() / ".clapcheeks"` and **PROFILE_PATH** = `PROFILE_DIR / "profile.json"`

2. **Profile dataclass** (use `@dataclass` from dataclasses) with these fields:
   - `name: str = ""`
   - `age: int = 0`
   - `location: str = ""`
   - `looking_for: str = ""` (relationship type: casual, serious, open, etc.)
   - `bio_summary: str = ""` (one-liner about themselves)
   - `pref_age_min: int = 18`
   - `pref_age_max: int = 99`
   - `pref_max_distance_miles: int = 25`
   - `pref_traits: list[str] = field(default_factory=list)` (physical/personality traits they care about)
   - `dealbreakers: list[str] = field(default_factory=list)` (hard nos, free-text list)
   - `convo_style: str = "balanced"` (options: shy, balanced, flirty, bold)
   - `topics_to_avoid: list[str] = field(default_factory=list)`
   - `updated_at: str = ""` (ISO timestamp of last save)

3. **`load_profile() -> Profile`**: Read PROFILE_PATH, return Profile instance. If file missing or corrupt, return Profile() defaults.

4. **`save_profile(profile: Profile) -> None`**: Set `updated_at` to current ISO timestamp, create PROFILE_DIR if needed, write JSON with `indent=2`. Use `dataclasses.asdict()` for serialization.

5. **`profile_exists() -> bool`**: Return whether PROFILE_PATH exists and is valid JSON.

Then create `agent/tests/test_profile.py` with:
- Test save then load roundtrip (use tmp_path fixture to override PROFILE_PATH via monkeypatch)
- Test load returns defaults when file missing
- Test load returns defaults when file is corrupt JSON
- Test updated_at is set on save
- Test profile_exists returns False when no file, True after save
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python -m pytest tests/test_profile.py -v
  </verify>
  <done>Profile dataclass with all fields defined. load_profile/save_profile roundtrip works. All 5 tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: CLI commands and interactive wizard</name>
  <files>
    agent/outward/commands/__init__.py
    agent/outward/commands/profile.py
    agent/outward/cli.py
  </files>
  <action>
Create `agent/outward/commands/__init__.py` (empty file).

Create `agent/outward/commands/profile.py` with a click group and three subcommands:

1. **`@click.group() def profile()`** — "Manage your dating profile and preferences."

2. **`@profile.command() def setup()`** — Interactive wizard using `rich.prompt.Prompt` and `rich.prompt.Confirm`:
   - Print a welcome panel: "Let's set up your dating profile. All data stays on this device."
   - Step through sections with rich formatting:
     - **About You**: name, age (IntPrompt), location, looking_for (Prompt with choices: "casual / serious / open / friends / not sure"), bio_summary
     - **Attraction Preferences**: pref_age_min (IntPrompt, default 18), pref_age_max (IntPrompt, default 35), pref_max_distance_miles (IntPrompt, default 25), pref_traits (comma-separated string, split into list)
     - **Dealbreakers**: dealbreakers (comma-separated, prompt: "Hard dealbreakers, comma-separated (e.g. smoking, long distance, no humor)")
     - **Conversation Style**: convo_style (Prompt with choices: "shy / balanced / flirty / bold"), topics_to_avoid (comma-separated)
   - After all input, display a summary table using `rich.table.Table`
   - Ask `Confirm("Save this profile?")` — if yes, call `save_profile()`, print success. If no, print "Discarded."
   - If profile already exists, warn and ask `Confirm("Overwrite existing profile?")`

3. **`@profile.command() def show()`** — Load profile, display using rich:
   - If no profile exists, print "[yellow]No profile found. Run `outward profile setup` first.[/yellow]" and return
   - Render a Panel with sections: About You, Preferences, Dealbreakers, Conversation Style
   - Show `updated_at` at the bottom in dim text

4. **`@profile.command() @click.argument("field_name") @click.argument("value") def edit(field_name, value)`** — Update a single field:
   - Load profile, check field_name is a valid Profile field (use `dataclasses.fields()`)
   - For list fields (pref_traits, dealbreakers, topics_to_avoid): split value by comma
   - For int fields (age, pref_age_min, pref_age_max, pref_max_distance_miles): cast to int
   - Save and print confirmation
   - If field_name invalid, print available fields and exit with error

Wire into CLI: In `agent/outward/cli.py`, add:
```python
from outward.commands.profile import profile
main.add_command(profile)
```
Add this after the existing command definitions, before the `_nullctx` class.
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from outward.cli import main; print('CLI loads OK')" && python -c "from outward.commands.profile import profile; print('Profile commands load OK')"
  </verify>
  <done>
    - `outward profile setup` launches interactive wizard with all four sections, displays summary, saves to ~/.clapcheeks/profile.json
    - `outward profile show` renders saved profile in rich formatted output
    - `outward profile edit age 28` updates a single field and saves
    - `outward profile edit dealbreakers "smoking, no humor"` updates list field correctly
    - All three subcommands registered under `outward profile` group
  </done>
</task>

</tasks>

<verification>
1. `cd /opt/agency-workspace/clapcheeks.tech/agent && python -m pytest tests/test_profile.py -v` — all tests pass
2. `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from outward.cli import main; print([c.name for c in main.commands.values()])"` — output includes "profile"
3. `cd /opt/agency-workspace/clapcheeks.tech/agent && python -m outward.cli profile --help` — shows setup, show, edit subcommands
4. `ls ~/.clapcheeks/profile.json` after running setup — file exists with valid JSON
</verification>

<success_criteria>
- Profile dataclass defines all fields (personal info, preferences, dealbreakers, conversation style)
- JSON persistence works: save then load returns identical data
- Interactive wizard walks through all four sections with rich UI
- `outward profile show` renders a readable summary
- `outward profile edit <field> <value>` updates individual fields
- Profile group is wired into main CLI
- Unit tests pass for persistence layer
- No data ever leaves the local machine
</success_criteria>

<output>
After completion, create `.planning/milestone-2/phase-8-profile/SUMMARY.md`
</output>
