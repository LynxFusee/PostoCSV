// Every post seen in network responses is cached in storage.session (cleared when the browser closes),
// so clicking "Capture" never needs a new request. Only captured posts go to storage.local.
const CACHE_PREFIX = "post_";
const CACHE_LIMIT = 300;
const PLATFORMS = [MastodonPlatform, XPlatform, FacebookPlatform];

function cacheKey(record) {
  return `${CACHE_PREFIX}${record.platform}_${record.postId}`;
}

// The same post shows up in several responses, each with partial data (a timeline may lack views):
// keep every known value and never overwrite it with an empty one.
function mergeRecords(oldRecord, newRecord) {
  if (!oldRecord) return newRecord;
  const merged = { ...oldRecord };
  for (const [key, value] of Object.entries(newRecord)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  merged.tokens = [...new Set([...(oldRecord.tokens ?? []), ...(newRecord.tokens ?? [])])];
  return merged;
}

async function pruneCache() {
  const items = await browser.storage.session.get(null);
  const entries = Object.entries(items)
    .filter(([key]) => key.startsWith(CACHE_PREFIX))
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt);
  if (entries.length > CACHE_LIMIT) {
    await browser.storage.session.remove(entries.slice(CACHE_LIMIT).map(([key]) => key));
  }
}

async function storeRecords(records) {
  if (records.length === 0) return;
  const batch = new Map();
  for (const record of records) {
    const key = cacheKey(record);
    batch.set(key, mergeRecords(batch.get(key), record));
  }
  const existing = await browser.storage.session.get([...batch.keys()]);
  const now = Date.now();
  const toStore = {};
  for (const [key, record] of batch) {
    toStore[key] = { ...mergeRecords(existing[key], record), cachedAt: now };
  }
  await browser.storage.session.set(toStore);
  await pruneCache();
}

// Tokens are the IDs a post can be reached by in a page URL (post ID, photo ID, pfbid...).
// The newest cached record sharing a token with the current page is the post on screen.
async function findRecord(platform, tokens) {
  const items = await browser.storage.session.get(null);
  const prefix = `${CACHE_PREFIX}${platform.name}_`;
  let best = null;
  for (const [key, record] of Object.entries(items)) {
    if (!key.startsWith(prefix)) continue;
    if (!record.tokens?.some((t) => tokens.includes(t))) continue;
    if (!best || record.cachedAt > best.cachedAt) best = record;
  }
  return best;
}

async function hashUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    return null;
  }
}

// One SHA-256 per media file, ";"-separated, so the CSV can prove a file was not altered later.
// "ERROR" keeps the position of a file that could not be downloaded.
async function hashAll(urls) {
  const hashes = await Promise.all((urls ?? []).map(hashUrl));
  return hashes.map((h) => h ?? "ERROR").join(";");
}

async function capturePost(pageUrl) {
  // Mastodon only knows which hosts are instances once its config has loaded.
  await Promise.all(PLATFORMS.map((p) => p.ready));
  const platform = PLATFORMS.find((p) => p.matches(pageUrl));
  if (!platform) return { ok: false, error: "Unsupported platform." };

  const tokens = platform.pageTokens(pageUrl);
  if (tokens.length === 0) return { ok: false, error: "Please open a specific post first." };

  let record = await findRecord(platform, tokens);
  if (!record && platform.fetchRecord) record = await platform.fetchRecord(pageUrl, tokens);
  if (!record) return { ok: false, error: "Data not found. Please refresh the page (F5)." };

  const [imageHashes, videoHashes] = await Promise.all([hashAll(record.imageUrls), hashAll(record.videoUrls)]);
  const { imageUrls, videoUrls, tokens: recordTokens, cachedAt, ...fields } = record;
  const postData = {
    ...fields,
    url: fields.url ?? pageUrl,
    capturedAt: toIso(new Date()),
    imageHashes,
    videoHashes
  };

  const { savedPosts = [] } = await browser.storage.local.get("savedPosts");
  savedPosts.push(postData);
  await browser.storage.local.set({ savedPosts });
  return { ok: true, platform: platform.name };
}

function csvCell(value, delimiter) {
  const text = value === undefined || value === null ? "" : String(value);
  const needsQuotes = text.includes(delimiter) || /["\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

// Derived at export time, so posts captured before the field existed get it too.
// Older captures store a full ISO date ("2026-10-19T09:54:37.000Z"); both start with YYYY-MM-DD.
function exportValue(post, field) {
  if (field === "publishedDate") return post.publishedAt?.slice(0, 10);
  return post[field];
}

// Rows are stored in capture order. Older captures hold a full ISO date ("2026-10-19T09:54:37.000Z"),
// so compare on the first 16 characters with the "T" normalized. Posts without a date go last.
function sortPosts(posts, sort) {
  if (sort !== "publishedAsc" && sort !== "publishedDesc") return posts;
  const key = (post) => post.publishedAt?.slice(0, 16).replace("T", " ") ?? null;
  const direction = sort === "publishedAsc" ? 1 : -1;
  return [...posts].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -direction : direction;
  });
}

// "byDate" layout: one column per publication day (UTC), headed by the date, posts of that day stacked
// in it, each as a block of one line per field, blocks back to back. The first column
// repeats the field titles. Days follow the sort direction ("captured" keeps them oldest first);
// within a day, posts keep the sorted order. Posts without a date go to a last "No date" column.
function byDateTable(posts, columns, sort) {
  const days = new Map();
  for (const post of sortPosts(posts, sort)) {
    const day = post.publishedAt?.slice(0, 10) ?? null;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(post);
  }
  const direction = sort === "publishedDesc" ? -1 : 1;
  const keys = [...days.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -direction : a > b ? direction : 0;
  });
  const groups = keys.map((day) => days.get(day));
  const table = [["", ...keys.map((day) => day ?? "No date")]];
  const depth = Math.max(...groups.map((g) => g.length));
  for (let i = 0; i < depth; i++) {
    for (const column of columns) {
      table.push([column.header, ...groups.map((g) => (g[i] ? exportValue(g[i], column.field) : ""))]);
    }
  }
  return table;
}

async function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: true });
  } finally {
    // The download reads the blob after this call returns, so release it a bit later.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

async function exportCsv() {
  const { savedPosts = [] } = await browser.storage.local.get("savedPosts");
  if (savedPosts.length === 0) return { ok: false, error: "No data to export." };

  const { columns, delimiter, sort, layout } = (await loadConfig()).csv;
  let table = [
    columns.map((c) => c.header),
    ...sortPosts(savedPosts, sort).map((post) => columns.map((c) => exportValue(post, c.field)))
  ];
  // "columns" layout: one post per column, each line holding one field, its title in the first cell.
  if (layout === "columns") table = columns.map((_, i) => table.map((row) => row[i]));
  if (layout === "byDate") table = byDateTable(savedPosts, columns, sort);
  const lines = table.map((row) => row.map((value) => csvCell(value, delimiter)).join(delimiter));

  // The leading BOM makes Excel open the file as UTF-8 (accents, emoji).
  await downloadText(
    "﻿" + lines.join("\r\n") + "\r\n",
    `social_posts_export_${Date.now()}.csv`,
    "text/csv;charset=utf-8"
  );
  return { ok: true };
}

for (const platform of PLATFORMS) {
  platform.register((records) => storeRecords(records).catch(console.error));
}

// A new config in the settings page takes effect without reloading the extension.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("config" in changes)) return;
  MastodonPlatform.ready = loadConfig()
    .then((config) => MastodonPlatform.setHosts(config.mastodonHosts))
    .catch(console.error);
});

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "capture") return capturePost(message.url);
  if (message.action === "exportCsv") return exportCsv();
});
