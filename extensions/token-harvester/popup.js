const $ = (id) => document.getElementById(id);

async function refresh() {
  const cfg = await new Promise((r) =>
    chrome.runtime.sendMessage({ kind: "status" }, r),
  );
  $("device_token").placeholder = cfg.configured
    ? "(saved — leave blank to keep)"
    : "Paste from /settings/ai -> Devices";
  $("device_name").value = cfg.device_name || "chrome-ext";
  $("api_origin").value = cfg.api_origin || "https://clapcheeks.tech";

  const entries = Object.entries(cfg.last_upload || {});
  if (entries.length === 0) {
    $("status").innerHTML = "<span class=warn>No token uploads yet.</span><br>Open tinder.com in a tab with a logged-in session.";
  } else {
    const lines = entries.map(([k, ts]) => {
      const ago = Math.round((Date.now() - ts) / 1000);
      const age = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago/60)}m` : `${Math.round(ago/3600)}h`;
      return `<div><span class=ok>OK</span> ${k.split(":")[0]} - ${age} ago</div>`;
    }).join("");
    $("status").innerHTML = lines;
  }
}

$("save").addEventListener("click", async () => {
  const payload = {
    kind: "save_config",
    api_origin: $("api_origin").value.trim() || "https://clapcheeks.tech",
    device_name: $("device_name").value.trim() || "chrome-ext",
  };
  const t = $("device_token").value.trim();
  if (t) payload.device_token = t;
  await new Promise((r) => chrome.runtime.sendMessage(payload, r));
  $("save").textContent = "Saved";
  setTimeout(() => { $("save").textContent = "Save"; refresh(); }, 1200);
});

refresh();
