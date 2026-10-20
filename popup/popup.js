async function updateCount() {
  const { savedPosts = [] } = await browser.storage.local.get("savedPosts");
  document.getElementById("count").textContent = `Saved captures: ${savedPosts.length}`;
}

// Firefox lets the user refuse or revoke Manifest V3 host permissions; without them no response is seen
// and every capture ends in "Data not found".
const hostOrigins = browser.runtime.getManifest().host_permissions;

async function checkAccess() {
  const granted = await browser.permissions.contains({ origins: hostOrigins });
  document.getElementById("accessWarning").classList.toggle("hidden", granted);
}

// Not async and not wrapped in guard(): permissions.request must be called directly
// in the click handler, or Firefox refuses it as not coming from a user action.
function grantAccess() {
  browser.permissions
    .request({ origins: hostOrigins })
    .then(async (granted) => {
      await checkAccess();
      showStatus(granted ? "Access granted. Reload the post page (F5), then capture." : "Access refused.", !granted);
    })
    .catch((e) => showStatus(`Error: ${e.message}`, true));
}

function showStatus(message, isError = false) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "success";
}

async function capture() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showStatus("Could not read the active tab.", true);
    return;
  }

  showStatus("Capturing (videos may take a while)...");
  const result = await browser.runtime.sendMessage({ action: "capture", url: tab.url });
  if (!result?.ok) {
    showStatus(result?.error ?? "Capture failed.", true);
    return;
  }
  showStatus(`${result.platform} post captured successfully!`);
  await updateCount();
}

async function exportCsv() {
  const result = await browser.runtime.sendMessage({ action: "exportCsv" });
  if (!result?.ok) showStatus(result?.error ?? "Export failed.", true);
}

async function clearPosts() {
  await browser.storage.local.set({ savedPosts: [] });
  await updateCount();
  showStatus("Saved posts cleared.");
}

async function openSettings() {
  await browser.runtime.openOptionsPage();
  window.close();
}

function guard(fn) {
  return () => fn().catch((e) => showStatus(`Error: ${e.message}`, true));
}

document.addEventListener("DOMContentLoaded", () => {
  updateCount();
  checkAccess().catch((e) => showStatus(`Error: ${e.message}`, true));
});
document.getElementById("grantBtn").addEventListener("click", grantAccess);
document.getElementById("captureBtn").addEventListener("click", guard(capture));
document.getElementById("exportBtn").addEventListener("click", guard(exportCsv));
document.getElementById("clearBtn").addEventListener("click", guard(clearPosts));
document.getElementById("settingsBtn").addEventListener("click", guard(openSettings));
