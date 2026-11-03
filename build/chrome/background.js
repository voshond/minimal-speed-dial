// Captures page previews for the speed dial. When a bookmarked page finishes
// loading in the active tab, a screenshot of the visible area is taken,
// shrunk, and saved in storage.local. Nothing leaves the browser.

import { api, PREVIEW_PERMISSIONS, normalizeUrl, thumbKey, getHomeFolder, getSections } from './shared.js';

const CAPTURE_DELAY = 1000;           // let the page render after "complete"
const RECAPTURE_AFTER = 60 * 60 * 1000; // refresh a preview at most hourly
const THUMB_WIDTH = 640;
const THUMB_RATIO = 10 / 16;          // max height / width kept from the top of the page
const MIN_RATIO = 9 / 16;             // the tiles' shape; wider shots get cropped to it

const timers = new Map();
const manualTabs = new Set(); // tabs opened by captureUrl, skipped by auto-capture
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function schedule(tabId) {
	clearTimeout(timers.get(tabId));
	timers.set(tabId, setTimeout(() => {
		timers.delete(tabId);
		capture(tabId).catch((e) => console.warn('Preview capture failed:', e));
	}, CAPTURE_DELAY));
}

api.tabs.onUpdated.addListener((tabId, info, tab) => {
	if (info.status === 'complete' && tab.active) schedule(tabId);
});

// A page that finished loading in a background tab is captured when shown
api.tabs.onActivated.addListener(({ tabId }) => schedule(tabId));

api.tabs.onRemoved.addListener((tabId) => {
	api.storage.session.remove(`expect:${tabId}`);
});

async function findTarget(tab) {
	// Clicked from the speed dial: the new tab page tells us which bookmark
	// this tab was opened for, which covers redirects (logins, locales, …)
	const expectKey = `expect:${tab.id}`;
	const expected = (await api.storage.session.get(expectKey))[expectKey];
	if (expected) {
		await api.storage.session.remove(expectKey);
		return expected;
	}

	// Otherwise only capture if the URL itself is bookmarked
	const folder = await getHomeFolder();
	const current = normalizeUrl(tab.url);
	for (const section of getSections(folder)) {
		const match = section.items.find((bm) => normalizeUrl(bm.url) === current);
		if (match) return match.url;
	}
	return null;
}

async function capture(tabId) {
	if (!(await api.permissions.contains(PREVIEW_PERMISSIONS))) return;

	if (manualTabs.has(tabId)) return;
	const tab = await api.tabs.get(tabId).catch(() => null);
	if (!tab || !tab.active || tab.incognito || tab.status !== 'complete') return;
	if (!/^https?:/.test(tab.url || '')) return;

	const target = await findTarget(tab);
	if (!target) return;

	const key = thumbKey(target);
	const existing = (await api.storage.local.get(key))[key];
	if (existing && Date.now() - existing.t < RECAPTURE_AFTER) return;

	const gutter = await scrollbarFraction(tabId);
	const shot = await api.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 90 });

	// The user may have switched tabs while the screenshot was taken
	const after = await api.tabs.get(tabId).catch(() => null);
	if (!after?.active || after.url !== tab.url) return;

	await store(target, shot, gutter);
}

async function store(url, shot, gutter = 0) {
	await api.storage.local.set({ [thumbKey(url)]: { data: await shrink(shot, gutter), t: Date.now() } });
}

// Share of the viewport width taken by the page's vertical scrollbar
// (classic scrollbars on Linux/Windows are part of the screenshot)
async function scrollbarFraction(tabId) {
	try {
		const [{ result }] = await api.scripting.executeScript({
			target: { tabId },
			func: () => (window.innerWidth - document.documentElement.clientWidth) / window.innerWidth,
		});
		return result > 0 && result < 0.1 ? result : 0;
	} catch (e) {
		return 0; // pages scripts can't run on (web stores, PDFs, …)
	}
}


// On-demand capture (refresh button on a tile) ----------------------------
// Loads the page in the background with the normal browser session (so
// logged-in pages render as you see them), screenshots it and closes it.

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type !== 'capture-url' || sender.id !== api.runtime.id) return;
	captureUrl(msg.url).then(
		() => sendResponse({ ok: true }),
		(e) => sendResponse({ ok: false, error: String(e?.message || e) }),
	);
	return true; // async response
});

async function captureUrl(url) {
	if (!/^https?:/.test(url)) throw new Error('Only web pages can be previewed.');
	if (!(await api.permissions.contains(PREVIEW_PERMISSIONS))) {
		throw new Error('Previews are not enabled.');
	}

	let shot, gutter;
	if (api.tabs.captureTab) {
		// Firefox can screenshot a background tab directly
		const tab = await api.tabs.create({ url, active: false });
		manualTabs.add(tab.id);
		try {
			await waitForLoad(tab.id);
			gutter = await scrollbarFraction(tab.id);
			shot = await api.tabs.captureTab(tab.id, { format: 'jpeg', quality: 90 });
		} finally {
			manualTabs.delete(tab.id);
			api.tabs.remove(tab.id).catch(() => {});
		}
	} else {
		// Chrome only captures the visible tab of a window, so use a small
		// unfocused popup window
		const win = await api.windows.create({ url, type: 'popup', focused: false, width: 1280, height: 880 });
		const tabId = win.tabs[0].id;
		manualTabs.add(tabId);
		try {
			await waitForLoad(tabId);
			gutter = await scrollbarFraction(tabId);
			shot = await api.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 90 });
		} finally {
			manualTabs.delete(tabId);
			api.windows.remove(win.id).catch(() => {});
		}
	}
	await store(url, shot, gutter);
}

function waitForLoad(tabId, timeout = 15000) {
	return new Promise((resolve, reject) => {
		const loaded = (tab) => tab.status === 'complete' && tab.url && tab.url !== 'about:blank';
		const finish = (fn, value) => {
			clearTimeout(timer);
			api.tabs.onUpdated.removeListener(onUpdated);
			fn(value);
		};
		const onUpdated = (id, info, tab) => {
			if (id === tabId && loaded(tab)) finish(resolve);
		};
		// Slow pages: capture whatever has rendered by then
		const timer = setTimeout(() => finish(resolve), timeout);
		api.tabs.onUpdated.addListener(onUpdated);
		api.tabs.get(tabId).then((tab) => loaded(tab) && finish(resolve), (e) => finish(reject, e));
	}).then(() => sleep(1500)); // let late content and fonts settle
}

// Crop the top of the viewport to the tile ratio and scale it down
async function shrink(dataUrl, gutter = 0) {
	const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
	// Drop the scrollbar; for very wide windows keep only the left part so
	// the preview still covers a whole tile
	const srcWidth = Math.round(Math.min(bitmap.width * (1 - gutter), bitmap.height / MIN_RATIO));
	const srcHeight = Math.min(bitmap.height, Math.round(srcWidth * THUMB_RATIO));
	const width = Math.min(THUMB_WIDTH, srcWidth);
	const height = Math.round(width * srcHeight / srcWidth);

	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, srcWidth, srcHeight, 0, 0, width, height);
	bitmap.close();

	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}
