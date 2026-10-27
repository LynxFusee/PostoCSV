// A post is an Instagram media object, recognized by its shape wherever it sits: embedded as JSON in the
// HTML of a post page opened directly, or in the GraphQL / REST responses fetched while browsing.
const InstagramPlatform = {
  name: "Instagram",

  matches(url) {
    return /^https?:\/\/(?:www\.)?instagram\.com\//i.test(url);
  },

  // /p/<code>/, /reel/<code>/, /reels/<code>/ or /tv/<code>/, possibly after /<username>/.
  pageTokens(url) {
    const match = url.match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/);
    return match ? [match[1]] : [];
  },

  isMedia(node) {
    return (
      typeof node.code === "string" &&
      typeof node.taken_at === "number" &&
      typeof node.user?.username === "string"
    );
  },

  // Candidates come in several sizes; keep the widest.
  largest(versions) {
    if (!Array.isArray(versions) || versions.length === 0) return null;
    return [...versions].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0].url ?? null;
  },

  toRecord(media) {
    // A carousel holds its images and videos in carousel_media; a single post is its own only item.
    const items = media.carousel_media?.length ? media.carousel_media : [media];
    const videos = items.filter((m) => m.video_versions?.length);
    const images = items.filter((m) => !m.video_versions?.length);
    const user = media.user;

    return {
      platform: "Instagram",
      postId: String(media.pk ?? media.code),
      account: user.username,
      accountId: user.pk ?? user.id ?? null,
      url: `https://www.instagram.com/p/${media.code}/`,
      content: media.caption?.text ?? null,
      publishedAt: toIso(media.taken_at),
      views: toNumber(media.play_count ?? media.ig_play_count ?? media.view_count),
      likes: toNumber(media.like_count),
      reposts: toNumber(media.reshare_count),
      replies: toNumber(media.comment_count),
      imageUrls: images.map((m) => InstagramPlatform.largest(m.image_versions2?.candidates)).filter(Boolean),
      videoUrls: videos.map((m) => InstagramPlatform.largest(m.video_versions)).filter(Boolean),
      tokens: [media.code, String(media.pk ?? media.code)]
    };
  },

  storeJsons(jsons, storeRecords) {
    const medias = [];
    for (const json of jsons) {
      walk(json, (n) => {
        if (!InstagramPlatform.isMedia(n)) return;
        medias.push(n);
        return false; // carousel children are part of this post, not posts of their own
      });
    }
    storeRecords(medias.map((m) => InstagramPlatform.toRecord(m)));
  },

  register(storeRecords) {
    onResponseBody(
      ["*://www.instagram.com/graphql/query*", "*://www.instagram.com/api/graphql*", "*://www.instagram.com/api/v1/*"],
      ["xmlhttprequest"],
      null,
      (text) => InstagramPlatform.storeJsons(parseJsonChunks(text), storeRecords)
    );

    // Only scripts mentioning taken_at are parsed: the page holds many large unrelated ones.
    onResponseBody(
      ["*://www.instagram.com/*"],
      ["main_frame"],
      (url) => InstagramPlatform.pageTokens(url).length > 0,
      (html) => {
        const jsons = [];
        for (const match of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
          if (!match[1].includes("taken_at")) continue;
          try {
            jsons.push(JSON.parse(match[1]));
          } catch (e) {
          }
        }
        InstagramPlatform.storeJsons(jsons, storeRecords);
      }
    );
  }
};
