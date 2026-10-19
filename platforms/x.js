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
      if (n.__typename === "TweetWithVisibilityResults" && n.tweet) {
        XPlatform.collectTweets(n.tweet, out);
        return false;
      }
      if (n.rest_id && n.legacy && n.core) out.push(n);
    });
  },

  bestVideoUrl(media) {
    const variants = (media.video_info?.variants ?? []).filter((v) => v.content_type === "video/mp4");
    if (variants.length === 0) return null;
    variants.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return variants[0].url;
  },

  toRecord(tweet) {
    const legacy = tweet.legacy;
    const user = tweet.core?.user_results?.result ?? {};
    const screenName = user.core?.screen_name ?? user.legacy?.screen_name ?? null;
    const media = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];

    return {
      platform: "X",
      postId: tweet.rest_id,
      account: screenName,
      accountId: user.rest_id ?? legacy.user_id_str ?? null,
      url: screenName
        ? `https://x.com/${screenName}/status/${tweet.rest_id}`
        : `https://x.com/i/status/${tweet.rest_id}`,
      content: tweet.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? null,
      publishedAt: toIso(legacy.created_at),
      views: toNumber(tweet.views?.count),
      likes: toNumber(legacy.favorite_count),
      reposts: toNumber(legacy.retweet_count),
      replies: toNumber(legacy.reply_count),
      imageUrls: media.filter((m) => m.type === "photo").map((m) => `${m.media_url_https}?name=orig`),
      videoUrls: media
        .filter((m) => m.type === "video" || m.type === "animated_gif")
        .map((m) => XPlatform.bestVideoUrl(m))
        .filter(Boolean),
      tokens: [tweet.rest_id]
    };
  },

  register(storeRecords) {
    onResponseBody(
      ["*://*.x.com/i/api/graphql/*"],
      ["xmlhttprequest"],
      (url) => /\/(TweetDetail|TweetResultByRestId|TweetResultsByRestIds)\b/.test(url),
      (text) => {
        const tweets = [];
        for (const json of parseJsonChunks(text)) XPlatform.collectTweets(json.data, tweets);
        storeRecords(tweets.map((t) => XPlatform.toRecord(t)));
      }
    );
  }
};
