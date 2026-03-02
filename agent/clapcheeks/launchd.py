"""Launchd plist generation and management for macOS auto-start."""
import subprocess
import textwrap
from pathlib import Path

PLIST_LABEL = "tech.clapcheeks.agent"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{PLIST_LABEL}.plist"


def generate_plist(python_path: str) -> str:
    """Generate a launchd plist XML string."""
    home = str(Path.home())
    return textwrap.dedent(f"""\
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
          "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>{PLIST_LABEL}</string>
            <key>ProgramArguments</key>
            <array>
                <string>{python_path}</string>
                <string>-m</string>
                <string>clapcheeks.daemon</string>
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>StandardOutPath</key>
            <string>{home}/.clapcheeks/daemon.log</string>
            <key>StandardErrorPath</key>
            <string>{home}/.clapcheeks/daemon.log</string>
            <key>WorkingDirectory</key>
            <string>{home}/.clapcheeks</string>
        </dict>
        </plist>
    """)


def install_launchd() -> None:
    """Write the plist and load it via launchctl."""
    import shutil
    python_path = shutil.which("python3") or "/usr/bin/python3"

    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLIST_PATH.write_text(generate_plist(python_path))

    subprocess.run(["launchctl", "load", str(PLIST_PATH)], check=True)


def uninstall_launchd() -> None:
    """Unload the plist and delete it."""
    if PLIST_PATH.exists():
        subprocess.run(["launchctl", "unload", str(PLIST_PATH)], check=False)
        PLIST_PATH.unlink(missing_ok=True)


def is_running() -> bool:
    """Check if the agent daemon is currently loaded in launchctl."""
    result = subprocess.run(
        ["launchctl", "list", PLIST_LABEL],
        capture_output=True, text=True,
    )
    return result.returncode == 0
