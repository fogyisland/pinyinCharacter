/**
 * The jump url of a template message.
 *
 * The url is delivered verbatim into a message that comes from the
 * official account, and the follower taps it. An admin-authored absolute
 * url to another host would therefore be a phishing link inside the
 * official account's own message — so the host is pinned to this site's
 * own origin.
 *
 * A relative path is accepted too, and resolved against the site url
 * before it is sent: WeChat itself wants an absolute url, and a relative
 * one would be rejected by the API as a parameter error — which, by
 * design, stops the whole broadcast.
 */
import { getRuntimeSiteUrl } from './seo/config';

/** The longest url WeChat accepts in a template message. */
const URL_MAX = 512;

/**
 * Checks a jump url against the site's own origin.
 *
 * @param value the admin's url — absolute or a site-relative path.
 * @param siteUrl the site's own url, e.g. `https://ziyun.pudafo.com`.
 * @returns the absolute url to send, or null when the url is not ours.
 */
export function resolveWechatJumpUrl(value: string, siteUrl: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;

  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    // Without a known site origin nothing can be same-origin.
    return null;
  }

  // A relative path: resolve it against the site. The origin check below
  // is what rejects a protocol-relative url (`//evil.com`) — it resolves
  // to another host, not to a path.
  if (raw.startsWith('/')) {
    let resolved: URL;
    try {
      resolved = new URL(raw, site);
    } catch {
      return null;
    }
    if (resolved.origin !== site.origin) return null;
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;
    return resolved.toString().slice(0, URL_MAX);
  }

  // An absolute url: it must be exactly our origin.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.origin !== site.origin) return null;
  return parsed.toString().slice(0, URL_MAX);
}

/**
 * The same check, against the site's configured url.
 *
 * @returns the absolute url to send, or null when the url is not ours.
 */
export async function resolveWechatJumpUrlForSite(value: string): Promise<string | null> {
  if (value.trim() === '') return null;
  const siteUrl = await getRuntimeSiteUrl();
  return resolveWechatJumpUrl(value, siteUrl);
}
