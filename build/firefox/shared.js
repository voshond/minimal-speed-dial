// Code shared by the new tab page (app.js) and the background script.

// Firefox exposes promise-based APIs on `browser`, Chrome MV3 on `chrome`.
export const api = globalThis.browser ?? globalThis.chrome;

export const FOLDER = 'HomePage';

// Host access is only needed to screenshot pages for previews. It's an
// optional permission the user grants from the new tab page.
export const PREVIEW_PERMISSIONS = { origins: ['<all_urls>'] };

// Loose URL identity: ignores protocol, "www.", trailing slashes and hash,
// so http://www.example.com/ and https://example.com match.
export function normalizeUrl(url) {
	try {
		const u = new URL(url);
		const host = u.hostname.replace(/^www\./, '');
		const path = u.pathname.replace(/\/+$/, '');
		return host + path + u.search;
	} catch (e) {
		return url;
	}
}

export const thumbKey = (url) => 'thumb:' + normalizeUrl(url);

export async function getHomeFolder() {
	const root = await api.bookmarks.getTree();
	// The bookmarks bar is the first child of the bookmarks root
	const bookmarksBar = root[0]?.children?.[0];
	return FOLDER
		? bookmarksBar?.children?.find((el) => el.title === FOLDER)
		: bookmarksBar;
}

// [{ id, title, items: [bookmark] }]. Direct links come first (id 'root',
// null title), then one section per non-empty subfolder (its bookmark id).
export function getSections(folder) {
	const children = folder?.children || [];
	const sections = [];

	const direct = children.filter((item) => item.url);
	if (direct.length) sections.push({ id: 'root', title: null, items: direct });

	for (const child of children) {
		if (!child.children) continue;
		const items = child.children.filter((item) => item.url);
		if (items.length) sections.push({ id: child.id, title: child.title, items });
	}
	return sections;
}
