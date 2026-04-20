// Hinge has no real web UI (their "web" is a static landing page), but
// we still listen for the rare case Hinge surfaces a web auth flow.
// Currently this content script mostly no-ops — the Hinge path uses SMS
// via Messages.db on the Mac Mini, not the browser.

function tryHarvest() {
  const needles = ["token", "auth", "jwt"];
  for (const key of Object.keys(localStorage)) {
    if (!needles.some(n => key.toLowerCase().includes(n))) continue;
    const v = localStorage.getItem(key);
    if (!v || v.length < 20) continue;
    chrome.runtime.sendMessage({
      kind: "token_harvest",
      platform: "hinge",
      token: v.replace(/^"|"$/g, ""),
      storage_key: key,
      url: location.href,
      at: Date.now(),
    });
  }
}

tryHarvest();
setTimeout(tryHarvest, 5000);
