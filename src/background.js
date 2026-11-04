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
	clearPending(tabId); // closing the capture window cancels it
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

	if (await getPending(tabId)) return; // the user decides when to capture
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


// On-demand capture (capture button on a tile) ----------------------------
// Opens the page in a popup window with the normal browser session. A small
// bar injected into the page lets the user log in / get the page ready and
// then trigger the screenshot; closing the window cancels.
//
// State lives in storage.session (the service worker may be stopped while
// the user is logging in):
//   pending:<tabId>        → { url, windowId }
//   capturing:<thumbKey>   → true while a capture for that bookmark is open

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (sender.id !== api.runtime.id) return;

	if (msg?.type === 'capture-url') {
		startCapture(msg.url).then(
			() => sendResponse({ ok: true }),
			(e) => sendResponse({ ok: false, error: String(e?.message || e) }),
		);
		return true; // async response
	}

	if (msg?.type === 'capture-ready' && sender.tab) {
		finishCapture(sender.tab).catch((e) => console.warn('Preview capture failed:', e));
	} else if (msg?.type === 'capture-cancel' && sender.tab) {
		api.windows.remove(sender.tab.windowId).catch(() => {});
	}
});

async function getPending(tabId) {
	const key = `pending:${tabId}`;
	return (await api.storage.session.get(key))[key] || null;
}

async function clearPending(tabId) {
	const pending = await getPending(tabId);
	if (!pending) return;
	await api.storage.session.remove([`pending:${tabId}`, `capturing:${thumbKey(pending.url)}`]);
}

async function startCapture(url) {
	if (!/^https?:/.test(url)) throw new Error('Only web pages can be previewed.');
	if (!(await api.permissions.contains(PREVIEW_PERMISSIONS))) {
		throw new Error('Previews are not enabled.');
	}
	const win = await api.windows.create({ url, type: 'popup', focused: true, width: 1280, height: 880 });
	const tabId = win.tabs[0].id;
	await api.storage.session.set({
		[`pending:${tabId}`]: { url, windowId: win.id },
		[`capturing:${thumbKey(url)}`]: true,
	});
	injectBar(tabId); // in case the page already finished loading
}

// Re-add the bar after every page load (login redirects, …)
api.tabs.onUpdated.addListener(async (tabId, info) => {
	if (info.status === 'complete' && await getPending(tabId)) injectBar(tabId);
});

function injectBar(tabId) {
	api.scripting.executeScript({ target: { tabId }, func: captureBar }).catch(() => {});
}

async function finishCapture(tab) {
	const pending = await getPending(tab.id);
	if (!pending) return;
	await sleep(150); // the bar has just been removed; let the page repaint
	const gutter = await scrollbarFraction(tab.id);
	const shot = await api.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 90 });
	await store(pending.url, shot, gutter);
	await clearPending(tab.id);
	api.windows.remove(pending.windowId).catch(() => {});
}

// Runs inside the web page. Self-contained; styled through the style
// property so strict page CSPs don't block it, in a shadow root so page
// styles don't leak in.
function captureBar() {
	const ID = '__minimal_speed_dial_capture__';
	if (document.getElementById(ID)) return;
	const ext = globalThis.browser ?? globalThis.chrome;

	const host = document.createElement('div');
	host.id = ID;
	host.style.all = 'initial'; // ignore page rules like `div { display: none }`
	Object.assign(host.style, {
		position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
		zIndex: '2147483647',
	});
	const root = host.attachShadow({ mode: 'closed' });

	const bar = document.createElement('div');
	Object.assign(bar.style, {
		display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 8px 8px 16px',
		borderRadius: '999px', background: 'rgba(20, 22, 26, 0.94)', color: '#e8eaec',
		font: '500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif',
		boxShadow: '0 6px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.12)',
		whiteSpace: 'nowrap',
	});

	const text = document.createElement('span');
	text.textContent = 'Log in or get the page ready, then';

	const button = (label, primary) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = label;
		Object.assign(b.style, {
			font: 'inherit', fontWeight: '600', cursor: 'pointer', borderRadius: '999px',
			padding: '7px 14px', border: primary ? 'none' : '1px solid rgba(255,255,255,.3)',
			background: primary ? '#5b8cff' : 'transparent', color: '#fff',
		});
		return b;
	};
	const capture = button('Capture preview', true);
	const cancel = button('Cancel', false);

	capture.addEventListener('click', () => {
		host.remove(); // keep the bar out of the screenshot
		requestAnimationFrame(() => requestAnimationFrame(() => {
			ext.runtime.sendMessage({ type: 'capture-ready' });
		}));
	});
	cancel.addEventListener('click', () => ext.runtime.sendMessage({ type: 'capture-cancel' }));

	bar.append(text, capture, cancel);
	root.append(bar);
	document.documentElement.append(host);
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
