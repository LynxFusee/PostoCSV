const FacebookPlatform = {
  name: "Facebook",

  matches(url) {
    return /^https?:\/\/(?:[a-z0-9-]+\.)?facebook\.com\//i.test(url);
  },

  // Facebook has many URL shapes for one post (?story_fbid=, /posts/pfbid..., /photo?fbid=, /videos/123...):
  // collect every ID-looking part. pfbid... is Facebook's obfuscated post ID.
  pageTokens(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return [];
    }
    const tokens = new Set();
    for (const param of ["story_fbid", "fbid", "v", "multi_permalinks"]) {
      const value = parsed.searchParams.get(param);
      if (value) tokens.add(value);
    }
    for (const segment of parsed.pathname.split("/")) {
      if (/^(pfbid[0-9A-Za-z]+|\d{8,})$/.test(segment)) tokens.add(segment);
    }
    return [...tokens];
  },

  isStory(node) {
    return node.__typename === "Story" && typeof node.post_id === "string";
  },

  photoUrl(node) {
    return node.photo_image?.uri ?? node.image?.uri ?? node.viewer_image?.uri ?? null;
  },

  videoUrl(node) {
    const legacy = node.videoDeliveryLegacyFields ?? {};
    return (
      node.browser_native_hd_url ??
      legacy.browser_native_hd_url ??
      node.playable_url_quality_hd ??
      node.browser_native_sd_url ??
      legacy.browser_native_sd_url ??
      node.playable_url ??
      null
    );
  },

  // Field locations change between Facebook layouts, so each value is searched for anywhere in the story.
  toRecord(story) {
    const actor = bfsFind(story, (n) => Array.isArray(n.actors) && n.actors.length > 0)?.actors[0] ?? {};
    const message = bfsFind(story, (n) => typeof n.message?.text === "string")?.message.text ?? null;
    const created = bfsFind(story, (n) => typeof n.creation_time === "number")?.creation_time ?? null;
    const reactions = bfsFind(story, (n) => typeof n.reaction_count?.count === "number")?.reaction_count.count ?? null;
    const comments =
      bfsFind(story, (n) => typeof n.total_comment_count === "number")?.total_comment_count ??
      bfsFind(story, (n) => typeof n.comments?.total_count === "number")?.comments.total_count ??
      null;
    const shares = bfsFind(story, (n) => typeof n.share_count?.count === "number")?.share_count.count ?? null;
    const views =
      bfsFind(story, (n) => typeof n.video_view_count === "number")?.video_view_count ??
      bfsFind(story, (n) => typeof n.play_count === "number")?.play_count ??
      null;
    const url =
      (typeof story.wwwURL === "string" && story.wwwURL) ||
      (typeof story.url === "string" && story.url) ||
      bfsFind(story, (n) => typeof n.wwwURL === "string")?.wwwURL ||
      null;

    const photos = new Map();
    const videos = new Map();
    walk(story, (n) => {
      if (n.__typename === "Photo") {
        const photoUrl = FacebookPlatform.photoUrl(n);
        if (photoUrl && !photos.has(n.id ?? photoUrl)) photos.set(n.id ?? photoUrl, photoUrl);
      } else if (n.__typename === "Video") {
        const videoUrl = FacebookPlatform.videoUrl(n);
        if (videoUrl && !videos.has(n.id ?? videoUrl)) videos.set(n.id ?? videoUrl, videoUrl);
      }
    });

    // Media IDs are tokens too: opening a photo or video gives a URL with its ID, not the post's.
    const tokens = new Set([story.post_id]);
    if (url) for (const token of FacebookPlatform.pageTokens(url)) tokens.add(token);
    for (const id of [...photos.keys(), ...videos.keys()]) {
      if (/^\d+$/.test(id)) tokens.add(id);
    }

    return {
      platform: "Facebook",
      postId: story.post_id,
      account: actor.name ?? null,
      accountId: actor.id ?? null,
      url,
      content: message,
      publishedAt: toIso(created),
      views: toNumber(views),
      likes: toNumber(reactions),
      reposts: toNumber(shares),
      replies: toNumber(comments),
      imageUrls: [...photos.values()],
      videoUrls: [...videos.values()],
      tokens: [...tokens]
    };
  },

  collectStories(json, out) {
    walk(json, (n) => {
      if (FacebookPlatform.isStory(n)) out.push(n);
    });
  },

  handleJson(jsons, storeRecords) {
    const stories = [];
    for (const json of jsons) FacebookPlatform.collectStories(json, stories);
    storeRecords(stories.map((s) => FacebookPlatform.toRecord(s)));
  },

  register(storeRecords) {
    onResponseBody(
      ["*://*.facebook.com/api/graphql/*"],
      ["xmlhttprequest"],
      null,
      (text) => FacebookPlatform.handleJson(parseJsonChunks(text), storeRecords)
    );

    // The first page load embeds its data as JSON in <script> tags instead of fetching it.
    // Only scripts mentioning post_id are parsed: the page holds many large unrelated ones.
    onResponseBody(
      ["*://*.facebook.com/*"],
      ["main_frame"],
      null,
      (html) => {
        const jsons = [];
        const scriptRegex = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
        let match;
        while ((match = scriptRegex.exec(html)) !== null) {
          if (!match[1].includes("post_id")) continue;
          try {
            jsons.push(JSON.parse(match[1]));
          } catch (e) {
          }
        }
        FacebookPlatform.handleJson(jsons, storeRecords);
      }
    );
  }
};
