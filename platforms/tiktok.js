// A post is a TikTok item (itemStruct), recognized by its shape wherever it sits: embedded as JSON in the
// HTML of a video page opened directly (__UNIVERSAL_DATA_FOR_REHYDRATION__), or in the /api/ responses
// fetched while browsing (item detail and the many */item_list feeds).
const TikTokPlatform = {
  name: "TikTok",

  matches(url) {
    return /^https?:\/\/(?:www\.)?tiktok\.com\//i.test(url);
  },

  // /@user/video/<id> or /@user/photo/<id>.
  pageTokens(url) {
    const match = url.match(/\/(?:video|photo)\/(\d+)/);
    return match ? [match[1]] : [];
  },

  isItem(node) {
    return (
      typeof node.id === "string" &&
      node.createTime !== undefined &&
      typeof node.author?.uniqueId === "string" &&
      (node.stats || node.statsV2)
    );
  },

  toRecord(item) {
    // Counters are numbers in stats, strings in statsV2; some responses only carry one of them.
    const stats = { ...item.statsV2, ...item.stats };
    const photos = item.imagePost?.images ?? [];
    const author = item.author;

    return {
      platform: "TikTok",
      postId: item.id,
      account: author.uniqueId,
      accountId: author.id ?? null,
      url: `https://www.tiktok.com/@${author.uniqueId}/${photos.length ? "photo" : "video"}/${item.id}`,
      content: item.desc ?? null,
      publishedAt: toIso(toNumber(item.createTime)),
      views: toNumber(stats.playCount),
      likes: toNumber(stats.diggCount),
      reposts: toNumber(stats.shareCount),
      replies: toNumber(stats.commentCount),
      imageUrls: photos.map((p) => p.imageURL?.urlList?.[0]).filter(Boolean),
      // A photo post still carries a video (the slideshow with music); only real videos are hashed.
      videoUrls: photos.length ? [] : [item.video?.playAddr || item.video?.downloadAddr].filter(Boolean),
      tokens: [item.id]
    };
  },

  storeJsons(jsons, storeRecords) {
    const items = [];
    for (const json of jsons) {
      walk(json, (n) => {
        if (!TikTokPlatform.isItem(n)) return;
        items.push(n);
        return false;
      });
    }
    storeRecords(items.map((i) => TikTokPlatform.toRecord(i)));
  },

  register(storeRecords) {
    // TikTok's video servers answer 403 unless a request carries the site's cookies and a tiktok.com
    // Referer, which fetch() from the background cannot set. Added only to the extension's own requests.
    const ownOrigin = browser.runtime.getURL("");
    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (!details.originUrl?.startsWith(ownOrigin)) return {};
        const requestHeaders = details.requestHeaders.filter((h) => h.name.toLowerCase() !== "referer");
        requestHeaders.push({ name: "Referer", value: "https://www.tiktok.com/" });
        return { requestHeaders };
      },
      { urls: ["*://*.tiktok.com/*", "*://*.tiktokcdn.com/*", "*://*.tiktokcdn-us.com/*"] },
      ["blocking", "requestHeaders"]
    );

    onResponseBody(
      ["*://www.tiktok.com/api/*"],
      ["xmlhttprequest"],
      (url) => /\/api\/(?:item\/detail|[a-z_/]*item_list)\//.test(url),
      (text) => TikTokPlatform.storeJsons(parseJsonChunks(text), storeRecords)
    );

    onResponseBody(
      ["*://www.tiktok.com/*"],
      ["main_frame"],
      (url) => TikTokPlatform.pageTokens(url).length > 0,
      (html) => {
        const jsons = [];
        for (const match of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
          if (!match[1].includes("createTime")) continue;
          try {
            jsons.push(JSON.parse(match[1]));
          } catch (e) {
          }
        }
        TikTokPlatform.storeJsons(jsons, storeRecords);
      }
    );
  }
};
