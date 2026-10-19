// Any domain can run a Mastodon instance, so hosts come from the config (mastodonHosts),
// and each one needs a host permission granted from the settings page.
const MastodonPlatform = {
  name: "Mastodon",
  hosts: [],
  ready: null,

  setHosts(hosts) {
    MastodonPlatform.hosts = hosts ?? [];
  },

  matches(url) {
    try {
      return MastodonPlatform.hosts.includes(new URL(url).hostname.toLowerCase());
    } catch (e) {
      return false;
    }
  },

  pageTokens(url) {
    let path;
    try {
      path = new URL(url).pathname;
    } catch (e) {
      return [];
    }
    const match = path.match(/\/(?:@[^/]+|statuses|users\/[^/]+\/statuses)\/(\d+)/);
    return match ? [match[1]] : [];
  },

  // Recognizes a Mastodon API status object by its shape.
  isStatus(node) {
    return (
      typeof node.id === "string" &&
      typeof node.created_at === "string" &&
      typeof node.content === "string" &&
      typeof node.favourites_count === "number" &&
      node.account &&
      typeof node.account.acct === "string"
    );
  },

  // Status content is HTML: keep line and paragraph breaks, drop the tags.
  htmlToText(html) {
    const prepared = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
    const doc = new DOMParser().parseFromString(prepared, "text/html");
    return doc.body.textContent.trim();
  },

  toRecord(status) {
    const media = status.media_attachments ?? [];
    return {
      platform: "Mastodon",
      postId: status.id,
      account: status.account.acct,
      accountId: status.account.id ?? null,
      url: status.url ?? status.uri ?? null,
      content: MastodonPlatform.htmlToText(status.content),
      publishedAt: toIso(status.created_at),
      views: null,
      likes: toNumber(status.favourites_count),
      reposts: toNumber(status.reblogs_count),
      replies: toNumber(status.replies_count),
      imageUrls: media.filter((m) => m.type === "image").map((m) => m.url).filter(Boolean),
      videoUrls: media.filter((m) => m.type === "video" || m.type === "gifv").map((m) => m.url).filter(Boolean),
      tokens: [status.id]
    };
  },

  collectStatuses(json, out) {
    walk(json, (n) => {
      if (MastodonPlatform.isStatus(n)) out.push(n);
    });
  },

  // Fallback when the post was not seen in network traffic (e.g. a server-rendered page):
  // the public API returns it directly.
  async fetchRecord(pageUrl, tokens) {
    try {
      const origin = new URL(pageUrl).origin;
      const response = await fetch(`${origin}/api/v1/statuses/${tokens[0]}`);
      if (!response.ok) return null;
      const status = await response.json();
      return MastodonPlatform.isStatus(status) ? MastodonPlatform.toRecord(status) : null;
    } catch (e) {
      return null;
    }
  },

  register(storeRecords) {
    MastodonPlatform.ready = loadConfig()
      .then((config) => MastodonPlatform.setHosts(config.mastodonHosts))
      .catch(console.error);

    // Hosts can change at runtime, so listen everywhere and filter by host in the test.
    onResponseBody(
      ["<all_urls>"],
      ["xmlhttprequest"],
      async (url) => {
        await MastodonPlatform.ready;
        return MastodonPlatform.matches(url) && /\/api\/v[12]\//.test(url);
      },
      (text) => {
        const statuses = [];
        for (const json of parseJsonChunks(text)) MastodonPlatform.collectStatuses(json, statuses);
        storeRecords(statuses.map((s) => MastodonPlatform.toRecord(s)));
      }
    );
  }
};
