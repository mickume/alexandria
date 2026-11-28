# Add the current page to the library from Safari

## Intent

Adding a link to Alexandria today means leaving the page being read, opening the Alexandria website and pasting the address into the stream. On an iPad that is several app switches for what should be one tap. The owner should be able to add the page open in Safari to their library with one tap on a toolbar button, on iPad first and on the Mac after it, without Alexandria's website being open. The button belongs to a Safari extension that speaks to the owner's own Alexandria deployment through the HTTP API with a personal access token, so it adds exactly what pasting the address would have added, and holds no copy of the library itself.

## Goals

- With the extension set up, one tap on its toolbar button in Safari on an iPad adds the current tab's address to the library, and the popup says "Added to Alexandria" or "Already in your library" within 3 seconds on a working connection (p95).
- The link the extension adds is the link `POST /api/v1/links` stores for that address: the same normalisation, the same duplicate rule (a boost), the same fetch and enrichment afterwards. No server route is added for the extension.
- Setting up takes two values, the site's address and a personal access token, entered once on the extension's settings page, which accepts them only after the deployment has answered as the token's user.
- Every way an add can fail (not set up, a tab without a web address, a refused token, an address Alexandria rejects, a full library, the rate limit, a server error, no connection) shows its own message in the popup, and none of them stores anything.
- On the Mac, the same extension offers the same button, and "Add link to Alexandria" in the context menu of a link on a page, which adds that link's address.
- The API answers cross-origin requests that carry a bearer token, so that the extension's calls succeed whether or not Safari applies the same-origin policy to them; a cross-origin request that relies on the session cookie is refused exactly as today.
- The extension asks Safari for the current tab on a tap, for its own storage, and for the one origin of the owner's deployment, and for nothing else: it never reads the content of a page.

## Non-goals

- Choosing a workspace or writing a note when adding; the extension sends the address only. A later PRD adds them to the popup.
- A keyboard shortcut for adding; a later change.
- A Share Extension (the system share sheet, which would also take links from apps other than Safari), and an Apple Shortcut. Either can be added to the same app later; this PRD is the Safari extension only.
- Extensions for Chrome, Firefox or Edge. The extension is written against the WebExtensions API those browsers share, but only Safari on iPadOS and macOS is built, tested and supported.
- An iPhone layout. The app may install on an iPhone because it shares the iPad's platform, but nothing is laid out or checked for it.
- A public App Store listing, with App Review, a privacy policy page and store screenshots. The app is distributed to the owner's own devices through TestFlight.
- Signing in from the extension with Google, or creating a token from the extension: a token is created on the website's Settings page, as today (`POST /api/v1/tokens` needs a session).
- Keeping adds made without a connection and sending them later. A failed add is shown, and is sent again only when the owner taps "Try again".
- Showing the library in the extension (the stream, search, Ask), or marking a page already in the library before the button is tapped.
- Reading the page: its title, text and metadata are fetched by the Worker after the add, as for any link.
- Revoking the token from the extension. "Disconnect" forgets it on the device; revoking is done on the website.
- Cross-origin access to the MCP endpoint (`/mcp`) and the sign-in routes (`/auth/`), which stay as they are.
- Building or testing the Apple app in the repository's automated checks: `make check` and `make e2e` run on Linux, and the app is built with Xcode on the owner's Mac.

## Background

- **Adding a link today.** The box at the top of the stream (`src/web/components/AddLinks.tsx`) posts pasted addresses to `POST /api/v1/links/batch`. One address is added with `POST /api/v1/links` and body `{"url": "<url>"}` (`src/worker/links/routes.ts`): `201 {"status": "added", "link"}` for a new link, `200 {"status": "boosted", "link"}` when the user already has the normalised address, `400 {"error": "invalid_url", "field": "url", …}` for an address that is not an http or https address of a public host (`normalizeUrl` in `src/worker/links/normalize.ts` rejects other schemes, bare words, localhost and private addresses), and `409 {"error": "library_full", "message": "library full (20,000 links)"}`.
- **Authentication.** Every route under `/api/v1/` is authenticated by `requireAuth` (`src/worker/auth/middleware.ts`): a personal access token as `Authorization: Bearer alx_…`, or the website's session cookie. A token request has no Origin check; a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` whose `Origin` is not the site's own is refused with `403 {"error": "forbidden_origin"}`. An unknown or revoked token is `401 {"error": "unauthorized"}`. `GET /api/v1/me` answers `200 {"email", "name"}` for the authenticated user.
- **Tokens.** The owner creates a token under **Settings** on the website (`src/web/pages/Settings.tsx`), names it, and sees its secret once. A user holds at most 20 unrevoked tokens; each records its `last_used_at` (`src/worker/auth/tokens.ts`).
- **Rate limit.** `rateLimit` (`src/worker/api/ratelimit.ts`) refuses a user's requests past 600 a minute with `429 {"error": "rate_limited"}` and a `Retry-After` header of 1 to 60 seconds.
- **No cross-origin answers today.** The Worker (`src/worker/app.ts`) sets no `Access-Control-*` header on any response, and an `OPTIONS` request under `/api/v1/` carries no credentials and is answered `401` by `requireAuth`. A page or extension on another origin whose browser applies the same-origin policy therefore cannot call the API with a token: its preflight fails. Scripts and the MCP clients are not browsers and are not affected.
- **The API's description.** `GET /api/v1/openapi.json` (`src/worker/api/openapi.ts`) describes every route; the Worker's tests fail when the document and the registered routes differ, or when a response a test receives is not one the document declares.
- **The deployment's address.** Each deployment has its own origin (`PUBLIC_ORIGIN`, or the Worker's `workers.dev` address; `src/worker/origin.ts`), so the extension cannot have the address built in.
- **No client outside the website.** The repository holds the Worker (`src/worker/`) and the website (`src/web/`), built by Vite into `dist/`. There is no browser extension and no native app. New with this PRD: the extension's source in `src/extension/`, its build output in `dist/extension/`, a `make extension` target, and the Xcode project of the app that carries it in `apple/`.
- **What Safari requires.** A Safari Web Extension is distributed inside a native app, on iPadOS and on macOS; Apple's `xcrun safari-web-extension-converter` generates the Xcode project for both platforms from an extension's directory. The app is built and signed with Xcode on a Mac. The owner has a paid Apple Developer Program membership and installs through TestFlight.
- **Checks.** `make check` runs the formatter, `tsc --noEmit`, ESLint with Prettier, and Vitest (the Worker in workerd, the website in jsdom, with the shared helpers of `src/worker/test/` and `src/web/test/`). `make e2e` runs Playwright in Chromium against `wrangler dev`. Neither can run Safari.

## Requirements

### Setting up the extension

The extension has a settings page, opened from Safari's extension settings and from the popup's "Open settings" button. It has two fields, **Site address** and **Token**, a **Connect** button, and, once connected, the line "Connected to `<host>` as `<email>`" and a **Disconnect** button.

- When the owner enters an address and a token and presses **Connect**, the extension reduces the address to its origin (an input without a scheme is read as `https://`; a path, query and fragment are dropped), asks Safari for permission to reach that origin, and calls `GET <origin>/api/v1/me` with the token. On `200` with an `email`, it stores the origin and the token on the device and shows "Connected to `<host>` as `<email>`".
- The stored token is never shown again: once connected, the Token field is empty with the placeholder "alx_…" followed by the token's last 4 characters.
- Until a connection has succeeded, nothing is stored; a failed **Connect** leaves the previously stored address and token, if any, in place and in use.
- **Connect** fails, storing nothing, with one of these messages under the fields:
  - an empty address, or one that is not an `https://` address with a dotted host: "Enter the address of your Alexandria site, such as https://links.example.com". An `http://` address is refused with the same message.
  - an empty token, or one that does not start with `alx_`: "Enter a personal access token. Create one under Settings on your Alexandria site."
  - Safari's permission for the origin declined: "Safari did not allow access to `<host>`."
  - `401` from `/api/v1/me`: "The token was not accepted."
  - any other status, or a `200` whose body is not JSON with an `email`: "No Alexandria found at `<host>`."
  - no answer within 15 seconds, or a network failure: "Could not reach `<host>`."
- **Disconnect** removes the stored address and token from the device and shows the empty fields. The text beside it says that the token itself stays valid until it is revoked on the Alexandria site.
- The address and the token are kept in the extension's own storage on the device. They are not synchronised to other devices: the iPad and the Mac are each set up once.

### Adding the current tab

Tapping the extension's toolbar button opens its popup, and opening the popup is the request to add: there is no second tap.

- When the extension is set up and the current tab's address starts with `http://` or `https://`, the popup shows "Adding…" and the tab's host, and sends `POST <origin>/api/v1/links` with `{"url": "<the tab's address>"}` and the token. The address is sent as Safari reports it; normalising it is the server's.
- On `201` the popup shows "Added to Alexandria"; on `200`, "Already in your library". Both show the tab's host under the message. The popup stays until the owner dismisses it.
- The add is sent once per opening of the popup. Closing and reopening the popup on the same tab sends it again, which the server answers as a boost.
- When the extension is not set up, the popup shows "Connect the extension to your Alexandria site first." and an **Open settings** button, and sends nothing.
- When the current tab has no address starting with `http://` or `https://` (an empty tab, the start page, a file, a Safari settings page), the popup shows "This page has no web address to add." and sends nothing.
- A failed add stores nothing on the server and shows, in the popup:
  - `400 invalid_url`: "Alexandria cannot add this address." (for example a page on a private network);
  - `401`: "The token is no longer accepted." and an **Open settings** button;
  - `409 library_full`: the server's `message`, "library full (20,000 links)";
  - `429`: "Too many requests. Try again in `<n>` seconds.", `<n>` from `Retry-After`, or "Too many requests. Try again in a minute." when the header cannot be read;
  - any other status: "Alexandria answered with an error (`<status>`)." and a **Try again** button;
  - no answer within 15 seconds, or a network failure: "Could not reach `<host>`." and a **Try again** button.
- **Try again** sends the same address once more and shows the outcome in the same popup.
- The extension makes no request to any host other than the stored origin, and none at all until the owner taps the button or chooses the context-menu item.

### Adding a link from the context menu

On the Mac, the extension adds the item **Add link to Alexandria** to the context menu Safari shows for a link on a page.

- Choosing it sends `POST <origin>/api/v1/links` with the address of the link that was clicked, not the tab's.
- There is no popup to show the outcome in, so the toolbar button shows it as a badge: "✓" for 5 seconds after `201` or `200`; "!" after any failure, including not being set up and a link whose address does not start with `http://` or `https://`.
- A "!" badge stays until the owner opens the popup. That opening shows the failed address's host, the message the failure has under "Adding the current tab", its **Open settings** or **Try again** button where that failure has one, and a **Dismiss** button; it does not add the current tab. Dismissing, a successful **Try again**, or a later successful add from the context menu clears the badge and the remembered failure. Only the latest failure is remembered.
- Where Safari does not offer context-menu items to extensions (expected on iPadOS), the extension runs without the item and reports no error; every other behaviour is unchanged.

### Answering cross-origin token requests

The API answers cross-origin requests so that a browser lets an extension, or a page on another origin, read the answers to requests it makes with a token.

- An `OPTIONS` request to any path under `/api/v1/` that carries `Origin` and `Access-Control-Request-Method` (a preflight) is answered `204` with no body, without authentication and without counting against the rate limit, with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE`, `Access-Control-Allow-Headers: Authorization, Content-Type` and `Access-Control-Max-Age: 86400`.
- Every answer to a request under `/api/v1/` that carries an `Authorization` header, whatever its status (the `401` for an unknown token and the `429` included), carries `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Retry-After`.
- No answer carries `Access-Control-Allow-Credentials`. An answer to a request without an `Authorization` header carries no `Access-Control-*` header, so a browser gives another origin nothing from a cookie-authenticated request; and a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` from another origin is still refused with `403 forbidden_origin`, before anything is performed.
- An `OPTIONS` request under `/api/v1/` that is not a preflight (no `Access-Control-Request-Method`) is answered as today.
- Paths outside `/api/v1/` (`/mcp`, `/auth/`, the website's pages and assets) answer as today, with no `Access-Control-*` header.
- `docs/api.md` describes the cross-origin answers under Authentication.

### Building and packaging

- `make extension` (new) builds the extension from `src/extension/` into `dist/extension/`, a directory Safari's converter accepts as it stands. `make build` and `make clean` include it. `make check` type-checks, lints and tests the extension's code with the rest of the repository; its tests run in jsdom against a fake of the browser's extension API and a fake Alexandria, with no network.
- The extension declares, and at run time holds, these permissions and no others: the current tab on the owner's action, its own storage, context-menu items, and the origin the owner connected, which it requests when **Connect** is pressed. It declares no content script.
- Constraint: the app that carries the extension is generated once with `xcrun safari-web-extension-converter` from `dist/extension/`, for iPadOS and macOS in one Xcode project, committed under `apple/`. The app is named "Alexandria" and the extension "Add to Alexandria". The app's only screen says how to turn the extension on in Safari's settings and how to connect it.
- Constraint: the app supports iPadOS 17 and macOS 14, and later versions of each.
- Constraint: building, signing and uploading to TestFlight are done by the owner on a Mac with Xcode, and are outside `make check` and `make e2e`. `docs/extension.md` (new) gives the steps: building the extension, opening the project, signing with the owner's team, running on the iPad, uploading to TestFlight, turning the extension on, and connecting it. It also gives the device checks below.
- Constraint: the order of delivery is iPad first. The Mac target, with the context menu, is checked after the iPad checks pass; the code for both is written once.

The device checks, performed by the owner and recorded in the change that completes this work, are, on the iPad and then on the Mac: connecting with a valid token shows the owner's email; a tap on a web page adds it and the link appears at the top of the stream on the website; a second tap says "Already in your library"; with the token revoked on the website, a tap says "The token is no longer accepted."; with the network off, a tap says "Could not reach `<host>`."; and, on the Mac only, the context-menu item on a link adds that link and shows "✓".

### End-to-end flows

- **Setting up.** The owner creates a token named "Safari on iPad" under Settings on the website and copies its secret. In Safari's extension settings they open the extension's settings page, enter the site's address and the token, and press **Connect**. Safari asks for permission to reach the site; the owner allows it. The extension calls `GET /api/v1/me` through the Worker's authentication and rate limit, receives the owner's email, stores the origin and the token, and shows "Connected to `<host>` as `<email>`". On the website, the token's last use is now.
- **Adding a page.** Reading an article in Safari on the iPad, the owner taps the extension's button. The popup opens with "Adding…", the extension sends `POST /api/v1/links` with the tab's address and the token; Safari's preflight, if it sends one, is answered by the Worker; the Worker authenticates the token, normalises the address, stores the link as `pending` and queues its fetch; the popup shows "Added to Alexandria". On the website, the link is at the top of the stream and gains its title and summary as the fetch and enrichment complete.
- **Adding a page twice.** The owner taps the button on a page already in the library. The Worker answers `200` with `boosted`; the popup shows "Already in your library"; on the website the link has moved up the stream as a re-paste would have moved it, and its use count is unchanged.
- **A revoked token.** The owner revokes the token on the website and later taps the button. The Worker answers `401`; the popup shows "The token is no longer accepted." with **Open settings**; nothing is added. The owner creates a new token, connects again, and the next tap adds the page.
- **Adding a link on the Mac.** The owner right-clicks a link in an article and chooses **Add link to Alexandria**. The extension sends the link's address; the Worker stores it; the toolbar button shows "✓" for 5 seconds. With the Mac offline, the button shows "!" instead; the owner clicks it, reads "Could not reach `<host>`.", and presses **Try again** once the connection is back.

## Design Decisions

1. **A Safari Web Extension inside a native app, not a Share Extension or an Apple Shortcut.** The owner's request. The share sheet and a Shortcut are named in Non-goals as later additions.
2. **iPad first, then the Mac, from one code base and one Xcode project.** The owner's request.
3. **One tap, address only.** The owner's decision: workspace and note wait for a later PRD, once the packaging works.
4. **Signed with a paid Apple Developer Program membership and installed through TestFlight.** The owner's decision: a free Apple ID's build stops working after 7 days, and a public listing needs App Review for an app only its owner installs.
5. **The API answers cross-origin token requests, in this PRD.** The owner's decision. Whether Safari applies the same-origin policy to an extension's requests to a host it holds permission for could not be verified without a device; with the server answering, the device checks cannot be blocked by it. A token is not sent by a browser on its own as a cookie is, so allowing any origin to present one gives no site a credential it did not already hold.
6. **The context menu on a link is in; a keyboard shortcut is not.** The owner's decision.
7. **Opening the popup adds the tab; there is no confirmation tap.** Decided in this run: the goal is one tap, and an add made by mistake is harmless (a duplicate is a boost, and a link can be deleted).
8. **The site's address is entered on the settings page, not built in.** Decided in this run: every deployment has its own origin.
9. **A connection is stored only after `GET /api/v1/me` has answered for the token.** Decided in this run: a mistyped address or token is found at set-up, not at the first add.
10. **Only `https://` site addresses are accepted.** Decided in this run: the token travels in every request, and a deployment on Cloudflare is always reachable over https.
11. **The token is kept in the extension's storage on the device, not in the system keychain and not synchronised.** Decided in this run: the keychain needs native code and a messaging channel between the app and the extension, for a token the owner can revoke and replace in a minute; Safari does not synchronise extension storage between devices.
12. **The context menu reports through a badge, and a failure waits in the popup.** Decided in this run: Safari gives extensions no notifications, and a context-menu choice opens no popup.
13. **Cross-origin answers go only to requests carrying `Authorization`, with `Access-Control-Allow-Origin: *` and never `Access-Control-Allow-Credentials`.** Decided in this run: an extension's origin in Safari differs per installation and cannot be listed, and without the credentials header a browser refuses to pair the wildcard with a cookie.
14. **No offline queue.** Decided in this run: a queue needs background work Safari suspends on iPadOS, and the owner is looking at the popup when the add fails.
15. **iPadOS 17 and macOS 14 are the oldest supported versions.** Decided in this run, **provisional**: both run the Safari version in which Manifest V3 extensions with a non-persistent background are established; the owner's devices may allow or need a different floor, which changes nothing else in this PRD.
16. **The Apple app is checked by hand on the devices, not in the automated checks.** Decided in this run: the repository's checks run on Linux. Everything that can be tested there (the extension's behaviour against fakes, the Worker's cross-origin answers) is.
17. **Profile: full.** The flows cross the extension, the Worker's authentication and the link store.

## Dependencies

- Package 01 `accounts_links_and_stream` (active): the extension uses its `POST /api/v1/links`, `GET /api/v1/me` and personal access tokens unchanged, and this work adds the cross-origin answers to its API and its authentication middleware. Its intent is not changed.
- [ADR 01](../adr/01-build-on-a-cloudflare-worker-with-d1.md): one npm package and one Worker. This work adds a second client and a native project to the repository, which a new ADR records.
- External: Safari's implementation of the WebExtensions API on iPadOS and macOS; Xcode and `safari-web-extension-converter`; the Apple Developer Program and TestFlight.

## Verified External API

`node_modules` was not installed and no Apple device or documentation site was reachable in the session that wrote this PRD, so every entry is from the published documentation as remembered and is **unverified**. The extension's tests run against a fake built to these shapes; the device checks are what verifies them.

- WebExtensions manifest, version 3: `manifest_version: 3`, `action.default_popup`, `options_ui.page`, `background` (a non-persistent background is required on iPadOS), `permissions: ["activeTab", "storage", "contextMenus"]`, `optional_host_permissions: ["https://*/*"]`. **Unverified.**
- `browser.tabs.query({ active: true, currentWindow: true }): Promise<Tab[]>`; `Tab.url` is present for the active tab once the owner has invoked the extension (`activeTab`). **Unverified.**
- `browser.storage.local.get(keys)`, `.set(items)`, `.remove(keys)`, each returning a promise. Safari does not synchronise `storage.sync`. **Unverified.**
- `browser.permissions.request({ origins: [pattern] }): Promise<boolean>`, callable only from a user action; `browser.permissions.contains({ origins })`. **Unverified.**
- `browser.runtime.openOptionsPage(): Promise<void>`. **Unverified.**
- `browser.action.setBadgeText({ text })`. **Unverified.**
- `browser.contextMenus.create({ id, title, contexts: ["link"] })` and `browser.contextMenus.onClicked` with `info.linkUrl`. Expected on macOS; whether Safari on iPadOS offers it is **unverified**, and the requirements hold either way.
- Whether Safari exempts an extension's `fetch` to a host it holds permission for from the same-origin policy: **unverified**; Design Decision 5 makes the answer immaterial.
- `xcrun safari-web-extension-converter <directory>` with `--app-name` and `--bundle-identifier`, generating one project with iOS and macOS targets. **Unverified.**
- Hono's `cors` middleware (`hono/cors`, `hono` ^4.13 in `package.json`): **unverified**, not read. Its defaults may not match the headers required above (it can answer every request, not only those carrying `Authorization`); the requirement is the headers, by whatever means.

## Glossary

- **extension**: the Safari Web Extension "Add to Alexandria": the toolbar button, its popup, its settings page and, on the Mac, its context-menu item.
- **the app**: the native iPadOS and macOS app "Alexandria" that Safari requires an extension to be delivered in. It does nothing but carry the extension and explain how to turn it on.
- **popup**: the small window Safari opens under the toolbar button when it is tapped.
- **connected**: the state in which the extension holds a site address and a token that `GET /api/v1/me` has answered for.
- **preflight**: the `OPTIONS` request a browser sends before a cross-origin request that carries an `Authorization` header, to ask whether the server allows it.
- **personal access token**, **boost**, **stream**, **link**: as in package 01.
