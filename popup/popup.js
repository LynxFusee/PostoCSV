async function updateCount() {
  const { savedPosts = [] } = await browser.storage.local.get("savedPosts");
  document.getElementById("count").textContent = `Saved captures: ${savedPosts.length}`;
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

document.addEventListener("DOMContentLoaded", updateCount);
document.getElementById("captureBtn").addEventListener("click", guard(capture));
document.getElementById("exportBtn").addEventListener("click", guard(exportCsv));
document.getElementById("clearBtn").addEventListener("click", guard(clearPosts));
document.getElementById("settingsBtn").addEventListener("click", guard(openSettings));
