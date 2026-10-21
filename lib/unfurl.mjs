// Link previews. parseMeta is pure so test/unfurl.test.mjs can feed it HTML.

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return out;
}

export function parseMeta(html, baseUrl) {
  const head = html.slice(0, 200_000);
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content != null && !(key in meta)) meta[key] = decode(a.content);
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  if (image) {
    try {
      image = new URL(image, baseUrl).href;
    } catch {
      image = '';
    }
  }
  const site = new URL(baseUrl).hostname.replace(/^www\./, '');
  return {
    title: meta['og:title'] || meta['twitter:title'] || (titleTag ? decode(titleTag[1]) : '') || site,
    description: meta['og:description'] || meta['twitter:description'] || meta.description || '',
    image,
    site: meta['og:site_name'] || site,
  };
}

// Refuse obvious internal targets. This server is personal, but a pasted link
// should never be able to make it probe the machine or the LAN.
export function isPublicHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h.includes(':')) return !(h === '::1' || h === '::' || /^(fc|fd|fe80)/.test(h) || h.startsWith('::ffff:'));
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}
