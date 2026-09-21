const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function shortcodeToMediaId(shortcode: string): string {
  let mediaId = 0n;
  for (const char of shortcode) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) break;
    mediaId = mediaId * 64n + BigInt(idx);
  }
  return mediaId.toString();
}

export function extractShortcode(url: string): string | null {
  const match = url.match(/(?:reel|p|tv|reels)\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

function extractLsdToken(webpage: string): string | null {
  const patterns = [
    /\["LSD",\[\],\{"token":"([^"]+)"/,
    /"LSD",\[\],\{"token":"([^"]+)"/,
  ];
  for (const p of patterns) {
    const m = webpage.match(p);
    if (m?.[1]) return m[1];
  }
  const eqmc = webpage.match(/<script\b[^>]*\bid=["']__eqmc["'][^>]*>(.*?)<\/script>/s);
  if (eqmc?.[1]) {
    try {
      const data = JSON.parse(eqmc[1]);
      if (typeof data?.l === "string") return data.l;
    } catch {}
  }
  return null;
}

export interface InstagramMedia {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
  videoUrl?: string;
  videoVersions: Array<{
    url: string;
    width?: number;
    height?: number;
  }>;
  duration?: number;
}

export async function extractInstagram(url: string): Promise<InstagramMedia | null> {
  const shortcode = extractShortcode(url);
  if (!shortcode) return null;

  // 1. Primary: Polaris logged-out GraphQL
  try {
    const cookies = new Map<string, string>();

    const saveCookies = (res: Response) => {
      const raw =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [res.headers.get("set-cookie")].filter(Boolean);
      for (const header of raw) {
        if (!header) continue;
        const parts = header.split(";");
        for (const part of parts) {
          const [k, v] = part.trim().split("=");
          if (
            k &&
            v &&
            !["expires", "path", "domain", "samesite", "secure", "httponly"].includes(
              k.toLowerCase(),
            )
          ) {
            cookies.set(k, v);
          }
        }
      }
    };

    const getCookieHeader = () =>
      Array.from(cookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

    const baseHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.instagram.com",
      Referer: "https://www.instagram.com/",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
    };

    const apiHeaders = {
      "X-IG-App-ID": "936619743392459",
      "X-ASBD-ID": "198387",
      "X-IG-WWW-Claim": "0",
    };

    const homeRes = await fetch("https://www.instagram.com/", {
      headers: { ...baseHeaders },
    });
    saveCookies(homeRes);
    const homeHtml = await homeRes.text();
    const lsdToken = extractLsdToken(homeHtml);

    if (lsdToken) {
      const mediaId = shortcodeToMediaId(shortcode);

      const rulingUrl = `https://i.instagram.com/api/v1/web/get_ruling_for_content/?content_type=MEDIA&target_id=${mediaId}`;
      const rulingRes = await fetch(rulingUrl, {
        headers: {
          ...baseHeaders,
          ...apiHeaders,
          Cookie: getCookieHeader(),
        },
      });
      saveCookies(rulingRes);

      const csrfToken = cookies.get("csrftoken") || "";
      const postHeaders = {
        ...baseHeaders,
        ...apiHeaders,
        "X-FB-Friendly-Name": "PolarisLoggedOutDesktopWWWPostRootContentQuery",
        "X-CSRFToken": csrfToken,
        "X-FB-LSD": lsdToken,
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://www.instagram.com/reel/${shortcode}/`,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: getCookieHeader(),
      };

      const body = new URLSearchParams({
        lsd: lsdToken,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "PolarisLoggedOutDesktopWWWPostRootContentQuery",
        server_timestamps: "true",
        variables: JSON.stringify({ media_id: mediaId }),
        doc_id: "27130156389949648",
      });

      const gqlRes = await fetch("https://www.instagram.com/api/graphql", {
        method: "POST",
        headers: postHeaders,
        body: body.toString(),
      });
      saveCookies(gqlRes);

      const gqlJson = (await gqlRes.json()) as any;
      const media = gqlJson?.data?.xig_polaris_media?.if_not_gated_logged_out;

      if (media) {
        const uploader = media.user?.username ? `@${media.user.username}` : "@instagram";
        const captionRaw = media.caption?.text || "";
        const title =
          captionRaw.length > 80
            ? `${captionRaw.slice(0, 80).trim()}...`
            : captionRaw || `Instagram Reel (${shortcode})`;

        const videoVersions: Array<{ url: string; width?: number; height?: number }> =
          Array.isArray(media.video_versions)
            ? media.video_versions.map((v: any) => ({
                url: v.url,
                width: v.width,
                height: v.height,
              }))
            : [];

        const imageVersions = media.image_versions2?.candidates || [];
        const thumbnail =
          imageVersions[0]?.url ||
          media.display_url ||
          "";

        return {
          id: shortcode,
          title,
          uploader,
          thumbnail,
          videoUrl: videoVersions[0]?.url,
          videoVersions,
          duration: Math.round(Number(media.video_duration) || 30),
        };
      }
    }
  } catch (err) {
    console.warn("Instagram Polaris extraction error:", err);
  }

  // 2. Secondary fallback: Embed page scraping
  try {
    const embedRes = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://www.instagram.com/",
      },
    });

    if (embedRes.ok) {
      const html = await embedRes.text();

      // Thumbnail
      const imgMatch =
        html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i) ||
        html.match(/src="([^"]+cdninstagram[^"]+)"/i);

      // Username
      const userMatch =
        html.match(/class="Username"[^>]*>([^<]+)</i) ||
        html.match(/class="UsernameText"[^>]*>([^<]+)</i);

      // Caption
      const capMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
      let caption = "";
      if (capMatch) {
        caption = capMatch[1].replace(/<[^>]+>/g, "").trim();
      }

      if (imgMatch || userMatch || caption) {
        return {
          id: shortcode,
          title: caption
            ? caption.length > 80
              ? `${caption.slice(0, 80).trim()}...`
              : caption
            : `Instagram Reel (${shortcode})`,
          uploader: userMatch ? `@${userMatch[1].trim()}` : "@instagram",
          thumbnail: imgMatch ? imgMatch[1].replace(/&amp;/g, "&") : "",
          videoVersions: [],
        };
      }
    }
  } catch (err) {
    console.warn("Instagram embed fallback error:", err);
  }

  return null;
}
