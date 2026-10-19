function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toIso(value) {
  if (value === undefined || value === null) return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bfsFind(root, predicate, maxNodes = 50000) {
  const queue = [root];
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const node = queue.shift();
    visited++;
    if (!node || typeof node !== "object") continue;
    if (!Array.isArray(node) && predicate(node)) return node;
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && visit(node) === false) return;
  for (const value of Object.values(node)) walk(value, visit);
}

function parseJsonChunks(text) {
  const cleaned = text.replace(/^for \(;;\);/, "");
  const results = [];
  try {
    results.push(JSON.parse(cleaned));
    return results;
  } catch (e) {
  }
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch (e) {
    }
  }
  return results;
}

function captureBody(details, onText) {
  const filter = browser.webRequest.filterResponseData(details.requestId);
  const decoder = new TextDecoder("utf-8");
  const chunks = [];

  filter.ondata = (event) => {
    chunks.push(event.data);
    filter.write(event.data);
  };

  filter.onstop = () => {
    filter.close();
    let text = "";
    for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    try {
      onText(text, details);
    } catch (e) {
      console.error("PostoCSV: response parsing failed", e);
    }
  };

  filter.onerror = () => console.error("PostoCSV: filter error", filter.error);
}

function onResponseBody(urls, types, test, onText) {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const passes = test ? test(details.url) : true;
      if (passes instanceof Promise) {
        return passes.then((ok) => {
          if (ok) captureBody(details, onText);
          return {};
        });
      }
      if (passes) captureBody(details, onText);
    },
    { urls, types },
    ["blocking"]
  );
}
