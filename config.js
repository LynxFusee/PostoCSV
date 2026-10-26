const CONFIG_FIELDS = [
  "platform",
  "postId",
  "account",
  "accountId",
  "url",
  "content",
  "publishedAt",
  "publishedDate",
  "capturedAt",
  "views",
  "likes",
  "replies",
  "reposts",
  "imageHashes",
  "videoHashes",
  // No post has this field, so its column is always left blank (e.g. for notes added later).
  "empty"
];

const CONFIG_DELIMITERS = [",", ";", "\t", "|"];
const CONFIG_SORTS = ["captured", "publishedAsc", "publishedDesc"];
const HOSTNAME_REGEX = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i;

async function loadDefaultConfig() {
  const response = await fetch(browser.runtime.getURL("config/default-config.json"));
  return response.json();
}

async function loadConfig() {
  const { config } = await browser.storage.local.get("config");
  return config ?? loadDefaultConfig();
}

// Checks a user-supplied config and returns a normalized copy; throws a readable error otherwise.
function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The config must be a JSON object.");
  }

  const hosts = raw.mastodonHosts ?? [];
  if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== "string" || !HOSTNAME_REGEX.test(h))) {
    throw new Error('"mastodonHosts" must be a list of hostnames, e.g. ["mastodon.social", "fosstodon.org"].');
  }

  const csv = raw.csv;
  if (!csv || typeof csv !== "object") throw new Error('Missing "csv" section.');

  const delimiter = csv.delimiter ?? ",";
  if (!CONFIG_DELIMITERS.includes(delimiter)) {
    throw new Error(`"csv.delimiter" must be one of: , ; | or \\t (tab).`);
  }

  const sort = csv.sort ?? "captured";
  if (!CONFIG_SORTS.includes(sort)) {
    throw new Error(`"csv.sort" must be one of: ${CONFIG_SORTS.join(", ")}.`);
  }

  if (!Array.isArray(csv.columns) || csv.columns.length === 0) {
    throw new Error('"csv.columns" must be a non-empty list.');
  }

  const columns = csv.columns.map((column, index) => {
    if (!column || !CONFIG_FIELDS.includes(column.field)) {
      throw new Error(`Column ${index + 1}: unknown field "${column?.field}". Allowed: ${CONFIG_FIELDS.join(", ")}.`);
    }
    const header = column.header ?? column.field;
    if (typeof header !== "string" || header.trim() === "") {
      throw new Error(`Column ${index + 1}: "header" must be a non-empty text.`);
    }
    return { header, field: column.field };
  });

  return {
    version: 1,
    mastodonHosts: [...new Set(hosts.map((h) => h.toLowerCase()))],
    csv: { delimiter, sort, columns }
  };
}

// Match patterns for permissions.request / permissions.contains.
function hostOrigins(hosts) {
  return hosts.map((host) => `*://${host}/*`);
}
