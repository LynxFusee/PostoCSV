# PostoCSV

A Firefox extension that captures social media posts (text, metrics, media hashes) and exports them to CSV.

Open a post, click **Capture**, repeat, then **Export All to CSV**. Each row records who posted what and when, the engagement numbers at capture time, and a SHA-256 hash of every image and video, so you can later prove a media file has not been altered.

## Supported platforms

| Platform | What is read |
|----------|--------------|
| X | GraphQL responses for single-post pages |
| Facebook | GraphQL responses and the data embedded in the first page load |
| Mastodon | The instance's REST API, on the hosts you list in the settings |

## How it works

PostoCSV does not scrape the page. While you browse, it reads a copy of the network responses the site already receives (`webRequest.filterResponseData`) and caches every post it recognizes. Clicking **Capture** looks up the post in the active tab from that cache, downloads its media to hash them, and saves the record locally. For Mastodon, if the post was not seen in network traffic, it is fetched from the instance's public API.

Responses are passed to the page unchanged: the extension never modifies what the site shows or sends.

## Installation

PostoCSV requires Firefox 140 or later. The extension is signed by Mozilla, so it installs permanently in a regular Firefox: no developer mode or `about:debugging` needed.

1. Download the latest `.xpi` file from the [Releases](../../releases) page.
2. Open it in Firefox, either by dragging it into a Firefox window or from `about:addons` → ⚙️ → **Install Add-on From File...**
3. Accept the permissions Firefox asks for.

**Updates:** PostoCSV is not listed on addons.mozilla.org, so Firefox does not update it automatically. To update, download the new `.xpi` from the Releases page and install it the same way. Your captures and settings are kept.

**Android:** the manifest supports Firefox for Android 142 or later, but installing from a file there has not been tested.

## Usage

1. Open a single post (not a timeline). If the post was already open before the extension was installed, reload the page (F5).
2. Click the PostoCSV toolbar icon, then **Capture Current Post**.
3. Repeat for every post you want.
4. Click **Export All to CSV** and choose where to save the file.

**Clear Saved Posts** deletes every capture. Export first.

## Configuration

**Settings** opens the settings page:

- **CSV columns**: one row per column, in order. Type the column title, pick the data it holds, move it with ↑ ↓, remove it with ✕. **Add column** adds one at the end.
- **Delimiter**: comma, semicolon, tab or pipe.
- **Mastodon instances**: one hostname per line. After saving, click **Grant access to Mastodon hosts** so Firefox allows the extension on them.

Click **Save** to apply. **Export file** and **Import file** save and load the settings as JSON, to back them up or share them. **Reset to default** restores the default columns.

The data a column can hold:

| Field | Content |
|-------|---------|
| `platform` | `X`, `Facebook` or `Mastodon` |
| `postId` | The platform's post ID |
| `account` | Screen name or display name |
| `accountId` | The platform's account ID |
| `url` | Link to the post |
| `content` | Post text |
| `publishedAt` | Publication date, UTC, to the minute (`2026-10-19 09:54`) |
| `capturedAt` | Capture date, UTC, to the minute (`2026-10-19 09:54`) |
| `views` | View count (X, Facebook videos) |
| `likes` | Likes / reactions / favourites |
| `replies` | Reply / comment count |
| `reposts` | Reposts / shares / boosts |
| `imageHashes` | SHA-256 of each image, `;`-separated |
| `videoHashes` | SHA-256 of each video, `;`-separated |
| `empty` | Nothing: the column stays blank, e.g. to fill in by hand later |

A hash is `ERROR` when its file could not be downloaded.

`postId` and `accountId` are written as `="2108124502437830860"`. Without this, Excel rounds numbers longer than 15 digits (`2.10812E+18`). Excel shows the ID exactly as captured. Other tools read the raw text, so strip the leading `="` and trailing `"` when processing the CSV in code.

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
