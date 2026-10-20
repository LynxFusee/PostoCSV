function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

// Numbers are Unix timestamps in seconds (Facebook); strings are date texts (X, Mastodon).
// Output is UTC to the minute, e.g. "2026-10-19 09:54", a format Excel reads as a date.
function toIso(value) {
  if (value === undefined || value === null) return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 16).replace("T", " ");
}

// Breadth-first, so the match closest to the root wins: nested quoted/shared posts carry the same
// field names deeper down. maxNodes caps the work on huge responses.
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

// Depth-first visit of every object; returning false from visit skips that node's children.
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && visit(node) === false) return;
  for (const value of Object.values(node)) walk(value, visit);
}

// A response is either one JSON document or several, one per line (Facebook streams them that way).
// "for (;;);" is Facebook's anti-JSON-hijacking prefix.
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

// Reads a response body as it reaches the page. Every chunk is passed through unchanged,
// so the site keeps working normally; the copy is parsed once the response ends.
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

// test may be async (Mastodon waits for its config): a blocking listener can return a Promise,
// and the request waits until we know whether to capture it. {} means: leave the request as is.
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
