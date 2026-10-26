# PostoCSV

A Firefox extension that captures social media posts (text, metrics, media hashes) and exports them to CSV.

Open a post, click **Capture**, repeat, then **Export All to CSV**. Each row records who posted what and when, the engagement numbers at capture time, and a SHA-256 hash of every image and video, so you can later prove a media file has not been altered.

## Supported platforms

| Platform | What is read |
|----------|--------------|
| X | GraphQL responses for single-post pages, and the post embedded in the page when it is opened directly |
| Facebook | GraphQL responses and the data embedded in the first page load |
| Mastodon | The instance's REST API, on the hosts you list in the settings |

## How it works

PostoCSV does not scrape the page. While you browse, it reads a copy of the network responses the site already receives (`webRequest.filterResponseData`) and caches every post it recognizes. Clicking **Capture** looks up the post in the active tab from that cache, downloads its media to hash them, and saves the record locally. For Mastodon, if the post was not seen in network traffic, it is fetched from the instance's public API.

X serves two web apps: the older one (seen when logged in) fetches posts from `x.com/i/api/graphql`, the 2026 one (seen when logged out) from `api.x.com/graphql`, and embeds the post in the HTML of a post page opened directly. PostoCSV reads all three.

Responses are passed to the page unchanged: the extension never modifies what the site shows or sends.

## Installation

PostoCSV requires Firefox 140 or later. The extension is signed by Mozilla, so it installs permanently in a regular Firefox: no developer mode or `about:debugging` needed.

1. Download the latest `.xpi` file from the [Releases](../../releases) page.
2. Open it in Firefox, either by dragging it into a Firefox window or from `about:addons` → ⚙️ → **Install Add-on From File...**
3. Accept the permissions Firefox asks for, including access to X and Facebook. If that access was refused, the popup shows an orange **Allow access to X and Facebook** button: click it, then reload the post page.

**Updates:** PostoCSV is not listed on addons.mozilla.org, so Firefox does not update it automatically. To update, download the new `.xpi` from the Releases page and install it the same way. Your captures and settings are kept.

**Android:** the manifest supports Firefox for Android 142 or later, but installing from a file there has not been tested.

## Usage

1. Open a single post (not a timeline). If the post was already open before the extension was installed or granted access, reload the page (F5).
2. Click the PostoCSV toolbar icon, then **Capture Current Post**.
3. Repeat for every post you want.
4. Click **Export All to CSV** and choose where to save the file.

**Clear Saved Posts** deletes every capture. Export first.

## Configuration

**Settings** opens the settings page:

- **CSV columns**: one row per column, in order. Type the column title, pick the data it holds, drag it by its ⠿ handle to reorder (or focus the handle and press ↑ ↓), remove it with ✕. **Add column** adds one at the end.
- **Delimiter**: comma, semicolon, tab or pipe.
- **Sort rows**: capture order (default), or publication date, oldest or newest first. Posts without a publication date go last.
- **Mastodon instances**: one hostname per line. After saving, click **Grant access to Mastodon hosts** so Firefox allows the extension on them.

The default columns are Platform, Account, Account ID, Published At (UTC), Content, Captured At (UTC), Views, Likes, Replies, Reposts, Image Hashes, URL and Video Hashes.

Click **Save** to apply. **Export file** and **Import file** save and load the settings as JSON, to back them up or share them. **Reset to default** restores the default columns.

The data a column can hold (the field name is what an exported settings file uses):

| In the menu | Field | Content |
|-------------|-------|---------|
| Platform | `platform` | `X`, `Facebook` or `Mastodon` |
| Post ID | `postId` | The platform's post ID |
| Account | `account` | Screen name or display name |
| Account ID | `accountId` | The platform's account ID |
| URL | `url` | Link to the post |
| Content | `content` | Post text, in full for long X posts |
| Published At (UTC) | `publishedAt` | Publication date, UTC, to the minute (`2026-10-19 09:54`) |
| Published Date (UTC) | `publishedDate` | Publication date only, UTC, without the time (`2026-10-19`) |
| Captured At (UTC) | `capturedAt` | Capture date, UTC, to the minute (`2026-10-19 09:54`) |
| Views | `views` | View count (X, Facebook videos) |
| Likes | `likes` | Likes / reactions / favourites |
| Replies | `replies` | Reply / comment count |
| Reposts | `reposts` | Reposts / shares / boosts |
| Image Hashes | `imageHashes` | SHA-256 of each image, `;`-separated |
| Video Hashes | `videoHashes` | SHA-256 of each video, `;`-separated |
| Empty column | `empty` | Nothing: the column stays blank, e.g. to fill in by hand later |

A hash is `ERROR` when its file could not be downloaded.

`postId` and `accountId` are written as plain digits. Excel rounds numbers longer than 15 digits when it opens a CSV directly (`2.10812E+18`): to keep them exact, import the file with **Data > From Text/CSV** and set those columns to **Text**.

## Privacy

Everything stays in your browser. Cached posts are kept in session storage and cleared when Firefox closes. Captures and settings are kept in local extension storage until you clear them. The extension sends nothing anywhere. The only requests it makes itself are media downloads for hashing and, for Mastodon, the public API lookup of the open post.

### Permissions

| Permission | Why |
|------------|-----|
| `webRequest`, `webRequestBlocking`, `webRequestFilterResponse` | Read a copy of the platforms' network responses |
| `storage` | Keep the cache, the captures and the settings |
| `downloads` | Save the CSV file |
| `tabs` | Read the URL of the active tab |
| Host access to X, Facebook and their media servers | Read responses and download media to hash |
| Optional access to other sites | Granted per Mastodon instance from the settings page |

## Limitations

- Firefox can withhold or revoke access to X and Facebook (Manifest V3 host permissions). Every capture then fails with "Data not found"; the popup shows **Allow access to X and Facebook** to grant it again.
- Platforms change their internal APIs without notice. A capture that fails with "Data not found" may mean a parser needs updating.
- Hashing large videos can take a while.

## Development

There is no build step. The source is the extension.

To load it from source without signing, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and select `manifest.json`. It stays loaded until Firefox restarts. `web-ext run` does the same, and also reloads the extension when a file changes.

```sh
npx web-ext run      # Launch Firefox with the extension loaded
npx web-ext lint     # Check the manifest and code
npx web-ext sign --channel=unlisted   # Sign through addons.mozilla.org
```

`web-ext sign` reads your AMO credentials from the `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` environment variables. Never commit them.

### Releases

Work happens on `dev`. Merging `dev` into `main` and pushing `main` runs `.github/workflows/release.yml`: it signs the extension on addons.mozilla.org (unlisted) and publishes the signed `.xpi` as a GitHub release named after the `version` in `manifest.json`. AMO refuses to sign a version twice, so bump `version` before every release. The workflow needs the `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` repository secrets.

### Layout

```
manifest.json        Extension manifest
background.js        Cache, capture, hashing, CSV export
common.js            Response interception and JSON helpers
config.js            Config loading and validation
config/              Default config
platforms/           One parser per platform (x.js, facebook.js, mastodon.js)
popup/               Toolbar popup
settings/            Settings page
```

To add a platform, create an object with the same shape as the existing ones (`name`, `matches`, `pageTokens`, `register`, optionally `fetchRecord`), load it in `manifest.json`, and add it to `PLATFORMS` in `background.js`.

## License

[MIT](LICENSE)
