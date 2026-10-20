const XPlatform = {
  name: "X",

  matches(url) {
    return /^https?:\/\/(?:[a-z]+\.)?x\.com\//i.test(url);
  },

  pageTokens(url) {
    const match = url.match(/\/status\/(\d+)/);
    return match ? [match[1]] : [];
  },

  collectTweets(node, out) {
    walk(node, (n) => {
      // Restricted tweets come wrapped in this object; the real tweet is in .tweet.
      if (n.__typename === "TweetWithVisibilityResults" && n.tweet) {
        XPlatform.collectTweets(n.tweet, out);
        return false;
      }
      // Users also carry rest_id, core and an empty legacy, so a tweet needs its type name or its text.
      if (n.rest_id && n.core && (n.__typename === "Tweet" || n.legacy?.full_text !== undefined)) out.push(n);
    });
  },

  bestVideoUrl(media) {
    const variants = (media.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4");
    if (variants.length === 0) return null;
    variants.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return variants[0].url;
  },

  // The 2026 web app moved text and date to details, counters to counts and media to media_entities2;
  // legacy holds them in older responses.
  toRecord(tweet) {
    const legacy = tweet.legacy ?? {};
    const details = tweet.details ?? {};
    const counts = tweet.counts ?? {};
    const user = tweet.core?.user_results?.result ?? {};
    const screenName = user.core?.screen_name ?? user.legacy?.screen_name ?? null;
    const media = tweet.media_entities2 ?? legacy.extended_entities?.media ?? legacy.entities?.media ?? [];

    return {
      platform: "X",
      postId: tweet.rest_id,
      account: screenName,
      accountId: user.rest_id ?? legacy.user_id_str ?? null,
      url: screenName
        ? `https://x.com/${screenName}/status/${tweet.rest_id}`
        : `https://x.com/i/status/${tweet.rest_id}`,
      // Posts longer than 280 characters keep their full text in note_tweet; full_text is truncated.
      content: tweet.note_tweet?.note_tweet_results?.result?.text ?? details.full_text ?? legacy.full_text ?? null,
      publishedAt: details.created_at_ms ? toIso(details.created_at_ms / 1000) : toIso(legacy.created_at),
      views: toNumber(tweet.views?.count),
      likes: toNumber(counts.favorite_count ?? legacy.favorite_count),
      reposts: toNumber(counts.retweet_count ?? legacy.retweet_count),
      replies: toNumber(counts.reply_count ?? legacy.reply_count),
      // ?name=orig asks for the original resolution instead of the resized preview.
      imageUrls: media.filter((m) => m.type === "photo").map((m) => `${m.media_url_https}?name=orig`),
      videoUrls: media
        .filter((m) => m.type === "video" || m.type === "animated_gif")
        .map((m) => XPlatform.bestVideoUrl(m))
        .filter(Boolean),
      tokens: [tweet.rest_id]
    };
  },

  storeJsons(jsons, storeRecords) {
    const tweets = [];
    for (const json of jsons) XPlatform.collectTweets(json?.data, tweets);
    storeRecords(tweets.map((t) => XPlatform.toRecord(t)));
  },

  // A post page opened directly is rendered by the server: its GraphQL results are embedded in the HTML
  // as JS string literals, kind:"Result.Ok",value:"{\"data\":...}", instead of being fetched.
  embeddedJsons(html) {
    const jsons = [];
    for (const match of html.matchAll(/kind:"Result\.Ok",value:("(?:[^"\\]|\\.)*")/g)) {
      // The literal is JSON-compatible except \xHH (used for "<") and \'.
      const literal = match[1].replace(/\\(x[0-9a-fA-F]{2}|'|[\s\S])/g, (all, esc) =>
        esc === "'" ? "'" : esc.length === 3 ? `\\u00${esc.slice(1)}` : all
      );
      try {
        jsons.push(...parseJsonChunks(JSON.parse(literal)));
      } catch (e) {
      }
    }
    return jsons;
  },

  register(storeRecords) {
    // Only the endpoints that return a single post's details; timelines are ignored.
    // The 2026 web app calls api.x.com/graphql/<id>/<name>; the older one x.com/i/api/graphql/<id>/<name>.
    onResponseBody(
      ["*://*.x.com/i/api/graphql/*", "*://api.x.com/graphql/*"],
      ["xmlhttprequest"],
      (url) => /\/(TweetDetail|TweetResultByRestId|TweetResultsByRestIds)\b/.test(url),
      (text) => XPlatform.storeJsons(parseJsonChunks(text), storeRecords)
    );

    onResponseBody(
      ["*://x.com/*", "*://*.x.com/*"],
      ["main_frame"],
      (url) => /\/status\/\d+/.test(url),
      (html) => XPlatform.storeJsons(XPlatform.embeddedJsons(html), storeRecords)
    );
  }
};
