const configText = document.getElementById("configText");
const grantBtn = document.getElementById("grantBtn");
let missingOrigins = [];

function showStatus(message, isError = false) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "success";
}

async function checkPermissions(config) {
  const origins = hostOrigins(config.mastodonHosts);
  missingOrigins = [];
  for (const origin of origins) {
    if (!(await browser.permissions.contains({ origins: [origin] }))) missingOrigins.push(origin);
  }
  grantBtn.classList.toggle("hidden", missingOrigins.length === 0);
}

async function refresh() {
  const config = await loadConfig();
  configText.value = JSON.stringify(config, null, 2);
  await checkPermissions(config);
}

async function saveConfig(raw) {
  const config = validateConfig(raw);
  await browser.storage.local.set({ config });
  await refresh();
  showStatus(
    missingOrigins.length > 0
      ? "Config saved. Click \"Grant access to Mastodon hosts\" to enable the new hosts."
      : "Config saved."
  );
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
}

async function onSave() {
  await saveConfig(parseJson(configText.value));
}

async function onImport(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  await saveConfig(parseJson(await file.text()));
}

async function onExport() {
  const config = await loadConfig();
  const blob = new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "postocsv-config.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function onReset() {
  await browser.storage.local.remove("config");
  await refresh();
  showStatus("Default config restored.");
}

// Not async and not wrapped in guard(): permissions.request must be called directly
// in the click handler, or Firefox refuses it as not coming from a user action.
function onGrant() {
  browser.permissions
    .request({ origins: missingOrigins })
    .then(async (granted) => {
      await refresh();
      showStatus(granted ? "Access granted." : "Access refused.", !granted);
    })
    .catch((e) => showStatus(`Error: ${e.message}`, true));
}

function guard(fn) {
  return (event) => fn(event).catch((e) => showStatus(`Error: ${e.message}`, true));
}

document.getElementById("fields").textContent = CONFIG_FIELDS.join(", ");
document.getElementById("saveBtn").addEventListener("click", guard(onSave));
document.getElementById("importFile").addEventListener("change", guard(onImport));
document.getElementById("exportBtn").addEventListener("click", guard(onExport));
document.getElementById("resetBtn").addEventListener("click", guard(onReset));
grantBtn.addEventListener("click", onGrant);
refresh().catch((e) => showStatus(`Error: ${e.message}`, true));
