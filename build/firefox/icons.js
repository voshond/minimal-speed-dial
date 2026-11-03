// Site icons: high-res sources first, browser favicon as fallback.

const isFirefox = navigator.userAgent.includes('Firefox');
const isChromium = typeof chrome !== 'undefined'
	&& !!chrome.runtime?.id
	&& !isFirefox;

// High-res icons: try sources that usually serve large icons first and
// fall back to the browser's (often 16px) favicon. Set to false to only
// use the basic favicon source.
const _HIRES_ICONS = true;
const _ICON_SIZE = 256;     // size requested from icon services
const _ICON_MIN_SIZE = 64;  // anything smaller is considered low-res
const _ICON_CACHE_KEY = 'iconCache';
const _ICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getFaviconUrl(pageUrl, size = 128) {
	if (isChromium) {
		return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
	}
	// Firefox Fallback
	try {
		const hostname = new URL(pageUrl).hostname;
		return `https://www.google.com/s2/favicons?domain=${hostname}&sz=${size}`;
	} catch (e) {
		return '';
	}
}

// Candidate icon URLs, best first. Only the origin is sent to the
// icon service, never the full bookmarked URL.
function getIconCandidates(pageUrl) {
	const fallback = getFaviconUrl(pageUrl);
	if (!_HIRES_ICONS) return [fallback];

	let origin;
	try {
		origin = new URL(pageUrl).origin;
	} catch (e) {
		return [fallback];
	}
	if (!origin.startsWith('http')) return [fallback];

	return [
		`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(origin)}&size=${_ICON_SIZE}`,
		`${origin}/apple-touch-icon.png`,
		fallback,
	];
}

// Remembers which candidate worked per origin so new tabs don't
// re-walk the fallback chain every time.
const iconCache = (() => {
	let data = {};
	try {
		data = JSON.parse(localStorage.getItem(_ICON_CACHE_KEY)) || {};
	} catch (e) {}
	let saveTimer;
	return {
		get(key) {
			const entry = data[key];
			return entry && Date.now() - entry.t < _ICON_CACHE_TTL ? entry.url : null;
		},
		set(key, url) {
			data[key] = { url, t: Date.now() };
			clearTimeout(saveTimer);
			saveTimer = setTimeout(() => {
				try { localStorage.setItem(_ICON_CACHE_KEY, JSON.stringify(data)); } catch (e) {}
			}, 500);
		},
	};
})();

export function loadIcon(img, pageUrl) {
	let key;
	try { key = new URL(pageUrl).origin; } catch (e) { key = pageUrl; }

	const cached = iconCache.get(key);
	const candidates = getIconCandidates(pageUrl);
	if (cached) candidates.unshift(cached);

	let i = 0;
	let best = null; // largest low-res icon seen, used if nothing better loads

	const next = () => {
		if (i < candidates.length) {
			img.src = candidates[i++];
		} else if (best) {
			img.onload = img.onerror = null;
			img.src = best.url;
			iconCache.set(key, best.url);
		} else {
			img.onload = img.onerror = null;
		}
	};

	img.onload = () => {
		const width = img.naturalWidth;
		const isCached = cached && i === 1;
		if (isCached || width >= _ICON_MIN_SIZE || (i >= candidates.length && !best)) {
			img.onload = img.onerror = null;
			iconCache.set(key, img.src);
			return;
		}
		if (!best || width > best.width) best = { url: img.src, width };
		next();
	};
	img.onerror = next;

	next();
}
