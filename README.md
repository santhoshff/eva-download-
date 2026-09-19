# Eva Save

# Eva Download — Product Requirements Prompt (Stage 1: /prd)

## 1. One-line concept

Eva Download is a share-to-save utility: the user shares a video/audio link from YouTube, Instagram, TikTok, or X directly into Eva Download via the native OS share sheet, previews it in an editorial-style popup, chooses format/quality, and saves it to local device storage — without ever opening the app as a separate destination.

## 2. Core user flow (the non-negotiable UX)

1. User is inside YouTube / Instagram / TikTok / X, viewing a video or reel.

2. User taps native **Share**.

3. **Eva Download** appears in the share sheet as a target.

4. User taps it → app does **not** launch to foreground as a full app. Instead, a **lightweight popup/bottom-sheet overlay** appears on top of the current app (or a fast-loading minimal screen) with:

   - Thumbnail + title of the detected media

   - Duration / file size estimate

   - Format selector: Video (resolution list) / Audio only (bitrate list)

   - A single primary action: **Download**

5. User picks format → taps Download → progress shown inline in the popup.

6. On completion: "Saved" confirmation + shortcut to view file, popup dismisses back to the source app.

7. File is stored in local device storage (Downloads / app-scoped folder, user-visible), not just app-sandboxed storage.

**Design principle:** Zero context-switching. The user should never feel like they "left" Instagram/YouTube. The app is invoked, does its job in an overlay, and gets out of the way.

## 3. Platform & scope (v1)

- **Platforms supported:** YouTube, Instagram (Reels/Posts/Stories), TikTok, Twitter/X

- **OS targets:** Android (Share Intent / `ACTION_SEND`) and iOS (Share Extension) — both from v1

- **Format control:** User explicitly picks resolution (e.g., 1080p/720p/480p) or Audio-only (with bitrate options e.g., 320/192/128kbps) before download starts — not fully automatic

## 4. Functional requirements

| # | Requirement |

|---|---|

| F1 | Register as a native share-target on Android (Intent Filter) and iOS (Share Extension) for URL/text MIME types |

| F2 | Parse shared URL, detect source platform, extract media metadata (title, thumbnail, duration, available formats) |

| F3 | Render a lightweight overlay/bottom-sheet — not a full app cold-start — showing preview + format picker |

| F4 | Support Video download (multi-resolution) and Audio-only extraction (multi-bitrate) |

| F5 | Save output to local/shared device storage, respecting OS scoped storage rules (Android SAF / iOS Files) |

| F6 | Show download progress + success/failure state inline in the overlay |

| F7 | Handle private/unavailable/geo-blocked/DRM-protected content gracefully with a clear error, not a crash |

| F8 | Maintain a lightweight in-app history/library of past downloads for re-access |

| F9 | Respect platform ToS/legal constraints — flag that downloading may violate some platforms' terms (see Open Question 5) |

## 5. Non-functional requirements

- **Speed:** Share → popup visible in under ~1.5s (perceived instant response is critical to the "don't break flow" promise)

- **Reliability:** Graceful degradation when a platform changes its page structure (these break often — needs a maintainable extraction layer, not brittle scraping)

- **Design language:** Editorial — see Section 6

- **Offline-first storage:** Downloaded files must be playable/accessible without the app (i.e., not locked in encrypted app sandbox)

## 6. Design direction — "Editorial"

Interpreting "editorial" for a utility app (to be refined in /designsystem + /designideas stages):

- Typography-led hierarchy — a strong serif or high-contrast display font for titles/headers, clean sans for UI chrome/metadata

- Generous whitespace, magazine-style grid even in a compact bottom-sheet

- Restrained color palette — near-mono base with one confident accent color for the primary action

- Content (thumbnail) treated like a "cover image" — large, framed, intentional — not a cramped thumbnail-and-button row

- Micro-interactions kept minimal and precise rather than playful/bouncy — feels considered, not gamified

## 7. Branding

- **App name:** Eva Download

- **Logo:** not received in this conversation — please re-upload the logo file and I'll fold its colors/marks into the /designsystem stage

## 8. Open questions before moving to /wireframe

1. **Overlay vs. full launch on iOS:** iOS Share Extensions run in a separate lightweight process by OS design — this naturally fits your "don't open the app" requirement. On Android, true overlay-over-another-app typically needs a transparent Activity or a floating/bubble-style window (extra permission: `SYSTEM_ALERT_WINDOW` or Bubbles API on Android 11+) — do you want a true floating overlay, or is a fast-launching transparent-backdrop bottom sheet (still technically its own Activity, but visually feels like a popup) acceptable?

2. **Storage destination:** Public Downloads folder (visible in Files app / gallery) vs. an app-managed folder the user can also browse? This affects whether videos show up in the phone's native Gallery/Photos app automatically.

3. **History/library:** Do you want a persistent "downloaded items" screen inside the app itself, or is the app purely a share-target with no real "home screen" experience?

4. **Account/login:** Any user accounts, or fully anonymous/local-only for v1?

5. **Platform ToS risk:** YouTube/Instagram/TikTok/X all restrict third-party downloading in their terms. Do you want this scoped as a personal-use tool, or should I flag this explicitly in the PRD as a legal/App Store approval risk (Apple/Google frequently reject or pull pure media-downloader apps)? Worth deciding now since it affects distribution strategy (sideload vs. App Store vs. web app/PWA).

6. **Monetization (if any):** Free utility, ads, or premium tier (e.g., higher resolution or batch downloads behind paywall)?

## 9. Next stage

Once you confirm/adjust the above, run **/wireframe** to turn this into screen-level flows (share-sheet entry → popup states → success/error states → optional library screen).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3fa92c4d-a710-461a-bf7d-9a639d0d82be).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
