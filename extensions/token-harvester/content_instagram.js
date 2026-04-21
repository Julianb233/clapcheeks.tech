// Runs on instagram.com pages. Pokes the background worker to harvest
// session cookies + user IDs from the current IG session so Clapcheeks
// can post stories / read feeds via Julian's real session.
//
// Cookies live in HttpOnly flags so we cannot read them from JS here;
// the background service worker uses chrome.cookies API (needs "cookies"
// permission + IG host_permissions, both granted in manifest.json).

(function () {
  "use strict";

  function harvest() {
    try {
      chrome.runtime.sendMessage({ kind: "ig_harvest" }, (resp) => {
        // Don't log PII in console — just a flag for dev
        if (resp && resp.ok) {
          console.log("[clapcheeks] ig session captured");
        }
      });
    } catch (err) {
      // Extension reload races — ignore
    }
  }

  // First run on page idle
  harvest();

  // Also on DOMContentLoaded + when the user navigates client-side
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") harvest();
  });
})();
