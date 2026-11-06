import { api, PREVIEW_PERMISSIONS, thumbKey, getHomeFolder, getSections } from './shared.js';
import { loadIcon } from './icons.js';

const isFirefox = navigator.userAgent.includes('Firefox');

// The wall is the inside of a cylinder. Each tile is cut into thin vertical
// strips laid around it, so previews bend with the surface and rows become
// arcs. More strips = smoother curve, more DOM.
const STRIPS = 12;
const RATIO = 9 / 16;                 // tile height / width (previews crop at the bottom)
const GAP = 0.03;                     // between tiles, both ways, × tile width
const MAX_ARC = 42 * Math.PI / 180;   // half-angle a full wall wraps around
const ARC_PER_COL = 12 * Math.PI / 180; // narrower walls curve less
const CAMERA = 1.35;                  // perspective distance, × cylinder radius
const REFLECTION = 0.12;              // reflection kept visible, × tile height;
                                      // the rest may run under the footer
const MIN_TILE = 150;                 // px, fewer columns below this
const MAX_COLS = 8;
const BLEED = 2;

const stage = document.querySelector('main');
const heading = document.querySelector('h1');
const nav = document.querySelector('#folders');
const filter = document.querySelector('#filter');
const previewsButton = document.querySelector('#previews');

let folder = null;
let pages = [];       // [{ title, items }]
let pageIndex = 0;
const LAST_PAGE_KEY = 'lastPage'; // id of the folder page shown last
let wall = null;      // strips (the curved surface)
let overlay = null;   // icons, captions, buttons; drawn after the wall so
                      // they're never hidden by 3D depth sorting
let tiles = [];       // [{ el, bm, strips, face, caption, refresh }]
const thumbs = {};    // thumbKey → data URL
let currentTabId = null;

api.tabs.getCurrent?.().then((tab) => { currentTabId = tab?.id ?? null; }).catch(() => {});


// Tiles ---------------------------------------------------------------------

function createTile(bm, k) {
	const el = document.createElement('div');
	const over = document.createElement('div');
	const a = document.createElement('a');
	const face = document.createElement('span');
	const icon = document.createElement('img');
	const label = document.createElement('span');
	const caption = document.createElement('span');
	const refresh = document.createElement('button');

	el.className = 'tile';
	over.className = 'tile';
	el.dataset.k = over.dataset.k = k;
	a.className = 'link';
	a.href = bm.url;
	a.title = bm.title;
	a.draggable = false;

	const strips = [];
	for (let i = 0; i < STRIPS; i++) {
		const strip = document.createElement('span');
		strip.className = 'strip';
		strip.style.setProperty('--i', i);
		strips.push(strip);
	}
	strips[0].classList.add('first');
	strips[STRIPS - 1].classList.add('last');

	// Mirrored copy for the floor reflection, used on the bottom row
	const mirror = strips.map((strip) => {
		const m = strip.cloneNode();
		m.classList.add('mirror');
		return m;
	});

	face.className = 'face';
	icon.className = 'icon';
	icon.alt = '';
	icon.draggable = false;
	label.textContent = bm.title;
	face.append(icon, label);
	loadIcon(icon, bm.url);

	// Label on previews: small icon + title in a pill, mirroring the face
	// icon once it has settled on its best source
	const pill = document.createElement('span');
	const capIcon = document.createElement('img');
	const capText = document.createElement('span');
	caption.className = 'caption';
	pill.className = 'pill';
	capIcon.alt = '';
	capIcon.draggable = false;
	capText.textContent = bm.title;
	icon.addEventListener('load', () => { capIcon.src = icon.src; });
	pill.append(capIcon, capText);
	caption.append(pill);

	refresh.className = 'refresh';
	refresh.type = 'button';
	refresh.title = 'Capture preview: opens the page in a window where you can log in, then click "Capture preview"';
	refresh.setAttribute('aria-label', 'Capture preview');
	refresh.append(cameraIcon(), Object.assign(document.createElement('span'), { className: 'spinner' }));

	const tile = { el, over, bm, strips, mirror, face, caption, refresh };
	refresh.addEventListener('click', (e) => capturePreview(e, tile));

	// Remember which bookmark this tab is heading to, so the background
	// script can file the preview under it even after redirects.
	a.addEventListener('click', (e) => {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		if (currentTabId === null || !api.storage?.session) return;
		e.preventDefault();
		api.storage.session.set({ [`expect:${currentTabId}`]: bm.url })
			.catch(() => {})
			.finally(() => { location.href = bm.url; });
	});

	a.append(...strips);
	el.append(a, ...mirror);
	over.append(face, caption, refresh);

	setThumb(tile);
	over.classList.toggle('busy', capturing.has(thumbKey(bm.url)));
	return tile;
}

const thumbRatios = new Map(); // data URL → height / width

// Camera outline (24×24, stroke icon)
function cameraIcon() {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('camera');
	const body = document.createElementNS(NS, 'path');
	body.setAttribute('d', 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z');
	const lens = document.createElementNS(NS, 'circle');
	lens.setAttribute('cx', '12');
	lens.setAttribute('cy', '12.75');
	lens.setAttribute('r', '3.25');
	svg.append(body, lens);
	return svg;
}

// backdrop-filter can't see the preview (it's on another 3D layer), so the
// pill draws its own blurred copy of it. Align that copy with the tile: the
// caption is 0.9w wide, centred, with its bottom at 0.95h (see layout()).
let tileSize = null; // { w, h } from the last layout
function placePillBackdrop(tile) {
	if (!tileSize || !tile.over.classList.contains('has-thumb')) return;
	const { w, h } = tileSize;
	const pill = tile.caption.firstChild;
	const x = w * 0.05 + pill.offsetLeft;
	const y = h * 0.95 - tile.caption.offsetHeight + pill.offsetTop;
	pill.style.setProperty('--bx', `${-x}px`);
	pill.style.setProperty('--by', `${-y}px`);
}

function setThumb(tile) {
	const data = thumbs[thumbKey(tile.bm.url)];
	// The overlay gets the image too: the label pill blurs it behind its text
	const both = [tile.el, tile.over];
	for (const el of both) {
		el.classList.toggle('has-thumb', !!data);
		el.style.removeProperty('--cover');
	}
	if (!data) {
		for (const el of both) el.style.removeProperty('--img');
		return;
	}
	for (const el of both) el.style.setProperty('--img', `url("${data}")`);
	placePillBackdrop(tile);

	// Previews from very wide windows are shorter than the tile: scale those
	// to the tile height instead (cropping the right side) so no gap shows
	const apply = (ratio) => {
		if (ratio < RATIO) {
			for (const el of both) el.style.setProperty('--cover', `calc(var(--h) / ${ratio})`);
		}
	};
	if (thumbRatios.has(data)) {
		apply(thumbRatios.get(data));
	} else {
		const img = new Image();
		img.onload = () => {
			thumbRatios.set(data, img.naturalHeight / img.naturalWidth);
			if (thumbs[thumbKey(tile.bm.url)] === data) apply(thumbRatios.get(data));
		};
		img.src = data;
	}
}

function capturePreview(e, tile) {
	e.preventDefault();
	e.stopPropagation();
	if (tile.over.classList.contains('busy')) return;

	// permissions.request has to be called straight from the click. It
	// resolves immediately when already granted.
	const key = thumbKey(tile.bm.url);
	api.permissions.request(PREVIEW_PERMISSIONS).then((granted) => {
		updatePreviewsButton();
		if (!granted) return;
		setCapturing(key, true);
		return api.runtime.sendMessage({ type: 'capture-url', url: tile.bm.url }).then((res) => {
			if (!res?.ok) throw new Error(res?.error || 'Capture failed');
		});
	}).catch((err) => {
		setCapturing(key, false);
		tile.refresh.title = `Capture failed: ${err.message}`;
		tile.over.classList.add('failed');
		setTimeout(() => tile.over.classList.remove('failed'), 2000);
	});
	// The spinner stops when the background clears capturing:<key>, i.e.
	// after the screenshot is saved or the capture window is closed
}

const capturing = new Set(); // thumbKeys with an open capture window

function setCapturing(key, on) {
	if (on) capturing.add(key);
	else capturing.delete(key);
	for (const tile of tiles) {
		if (thumbKey(tile.bm.url) === key) tile.over.classList.toggle('busy', on);
	}
}

// storage is missing if the extension wasn't reloaded after the manifest
// gained the permission; the page still works, just without previews.
api.storage?.onChanged.addListener((changes, area) => {
	if (area === 'session') {
		for (const [key, change] of Object.entries(changes)) {
			if (key.startsWith('capturing:')) setCapturing(key.slice(10), !!change.newValue);
		}
		return;
	}
	if (area !== 'local') return;
	for (const [key, change] of Object.entries(changes)) {
		if (!key.startsWith('thumb:')) continue;
		if (change.newValue?.data) thumbs[key] = change.newValue.data;
		else delete thumbs[key];
	}
	tiles.forEach(setThumb);
});


// Cylinder layout ---------------------------------------------------------

function layout() {
	if (!wall || !tiles.length) return;

	const n = tiles.length;
	const availW = stage.clientWidth * 0.985;
	const availH = stage.clientHeight * 0.98;

	// Size the wall so its projected width fills the stage (edges on the
	// screen plane, the middle recedes), shrinking only if the rows don't
	// fit vertically.
	const measure = (cols) => {
		const rows = Math.ceil(n / cols);
		const half = Math.min(MAX_ARC, cols * ARC_PER_COL);
		const R = (availW / 2) / Math.sin(half);
		const arc = 2 * R * half;
		const w = arc / (cols + (cols - 1) * GAP);
		const h = w * RATIO;
		const H = rows * h + (rows - 1) * w * GAP;
		const fit = Math.min(1, availH / (H + h * REFLECTION));
		const holes = (cols * rows - n) / cols;
		// Big tiles, edge to edge, few holes in the last row
		const score = w * fit * fit * (1 - holes * 0.5);
		return { cols, rows, half, R: R * fit, arc: arc * fit, w: w * fit, h: h * fit, H: H * fit, score };
	};

	let best = null;
	for (let cols = 1; cols <= Math.min(MAX_COLS, n); cols++) {
		if (cols > 1 && availW / cols < MIN_TILE) break;
		const m = measure(cols);
		if (!best || m.score > best.score) best = m;
	}
	const { cols, rows, half, R, arc, w, h, H } = best;

	const sw = w / STRIPS;
	const depth = R * (1 - Math.cos(half));
	const centerY = (stage.clientHeight - h * REFLECTION) / 2;

	stage.style.perspective = `${R * CAMERA}px`;
	stage.style.perspectiveOrigin = `50% ${centerY}px`;
	for (const el of [wall, overlay]) {
		el.style.top = `${centerY}px`;
		el.style.transform = `translateZ(${-depth}px)`;
		el.style.setProperty('--w', `${w}px`);
		el.style.setProperty('--h', `${h}px`);
		el.style.setProperty('--sw', `${sw}px`);
		el.style.setProperty('--bleed', `${BLEED}px`);
	}

	// Point on the cylinder at arc length s from the middle, facing inward
	const place = (s, y, out = 0, anchor = '-50%, -50%') => {
		const th = s / R;
		return `translate3d(${R * Math.sin(th)}px, ${y}px, ${R * (1 - Math.cos(th))}px) `
			+ `rotateY(${-th}rad) translateZ(${out}px) translate(${anchor})`;
	};


	tileSize = { w, h };
	tiles.forEach((tile, k) => {
		const row = Math.floor(k / cols);
		const inRow = row === rows - 1 ? n - row * cols : cols;
		const col = k % cols + (cols - inRow) / 2; // center a short last row
		const left = -arc / 2 + col * w * (1 + GAP);
		const top = -H / 2 + row * w * (RATIO + GAP);
		const mid = left + w / 2;

		const lastRow = row === rows - 1;
		const stripMid = (i) => left + (i + 0.5) * sw
			+ (i === 0 ? BLEED / 2 : 0) - (i === STRIPS - 1 ? BLEED / 2 : 0);
		tile.strips.forEach((strip, i) => {
			strip.style.transform = place(stripMid(i), top + h / 2);
		});
		tile.mirror.forEach((strip, i) => {
			strip.style.transform = lastRow
				? place(stripMid(i), top + h * 1.5 + 3)
				: '';
		});
		tile.face.style.transform = place(mid, top + h / 2);
		tile.caption.style.transform = place(mid, top + h * 0.95, 0, '-50%, -100%');
		placePillBackdrop(tile);
		tile.refresh.style.transform = place(left + w - h * 0.14, top + h * 0.14);
		tile.el.classList.toggle('last-row', lastRow);
	});
}

new ResizeObserver(layout).observe(stage);


// Pages (folders) -----------------------------------------------------------

function show(direction = 0) {
	const query = filter.value.trim().toLowerCase();
	if (!query && pages[pageIndex]) {
		try { localStorage.setItem(LAST_PAGE_KEY, pages[pageIndex].id); } catch (e) {}
	}
	const items = query
		? pages.flatMap((p) => p.items).filter((bm) => `${bm.title} ${bm.url}`.toLowerCase().includes(query))
		: pages[pageIndex]?.items || [];

	heading.textContent = query ? 'Search Results' : pages[pageIndex]?.title || 'Top Sites';
	nav.querySelectorAll('button').forEach((b, i) => {
		const current = !query && i === pageIndex;
		b.classList.toggle('active', current);
		b.setAttribute('aria-current', current ? 'page' : 'false');
	});

	setHover(null);
	if (!items.length) {
		wall = overlay = null;
		tiles = [];
		const p = document.createElement('p');
		p.className = 'empty';
		p.textContent = query ? 'No matching bookmarks.' : 'No bookmarks found.';
		stage.replaceChildren(p);
		return;
	}

	wall = document.createElement('div');
	overlay = document.createElement('div');
	wall.className = 'wall';
	overlay.className = 'wall overlay';
	tiles = items.map((bm, k) => createTile(bm, k));
	wall.append(...tiles.map((t) => t.el));
	overlay.append(...tiles.map((t) => t.over));
	stage.replaceChildren(wall, overlay);
	layout();

	if (direction) {
		const options = { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)' };
		stage.animate([{ opacity: 0 }, { opacity: 1 }], options);
		slide([{ translate: `${direction * 140}px` }, { translate: '0px' }], options);
	}
}

const walls = () => [wall, overlay].filter(Boolean);
const slide = (keyframes, options) => walls().forEach((el) => el.animate(keyframes, options));

// Hover/focus state shared by a tile's strips and its overlay, so moving
// onto the capture button keeps the tile highlighted
let hovered = null;
function setHover(k) {
	const next = k == null ? null : tiles[k];
	if (next === hovered) return;
	for (const el of [hovered?.el, hovered?.over]) el?.classList.remove('hover');
	for (const el of [next?.el, next?.over]) el?.classList.add('hover');
	hovered = next;
}
const tileIndex = (target) => target.closest?.('[data-k]')?.dataset.k ?? null;
stage.addEventListener('pointerover', (e) => setHover(tileIndex(e.target)));
stage.addEventListener('pointerleave', () => setHover(null));
stage.addEventListener('focusin', (e) => setHover(tileIndex(e.target)));
stage.addEventListener('focusout', () => setHover(null));

function go(delta) {
	if (filter.value.trim()) return;
	const next = Math.max(0, Math.min(pages.length - 1, pageIndex + delta));
	if (next === pageIndex) {
		// Rubber-band at the first / last folder
		slide([{ translate: '0px' }, { translate: `${-delta * 24}px` }, { translate: '0px' }], 260);
		return;
	}
	pageIndex = next;
	show(delta);
}

function renderNav() {
	nav.replaceChildren(...pages.map((page, i) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.textContent = page.title;
		b.addEventListener('click', () => {
			filter.value = '';
			const delta = Math.sign(i - pageIndex);
			pageIndex = i;
			show(delta);
		});
		return b;
	}));
	nav.hidden = pages.length < 2;
}


// Swipe between folders: drag, touch, trackpad, arrow keys -----------------

let drag = null;
let suppressClick = false;

stage.addEventListener('pointerdown', (e) => {
	if (e.button !== 0 || pages.length < 2 || e.target.closest('button')) return;
	drag = { x: e.clientX, y: e.clientY, moved: false };
});

window.addEventListener('pointermove', (e) => {
	if (!drag || !wall) return;
	const dx = e.clientX - drag.x;
	if (Math.abs(dx) > 8) drag.moved = true;
	if (drag.moved) walls().forEach((el) => { el.style.translate = `${dx * 0.4}px`; });
});

window.addEventListener('pointerup', (e) => {
	if (!drag) return;
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	const moved = drag.moved;
	drag = null;
	walls().forEach((el) => { el.style.translate = ''; });
	if (!moved) return;

	suppressClick = true;
	setTimeout(() => { suppressClick = false; }, 300);
	if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
});

window.addEventListener('pointercancel', () => {
	drag = null;
	walls().forEach((el) => { el.style.translate = ''; });
});

// A drag that ends on a tile must not open it
stage.addEventListener('click', (e) => {
	if (suppressClick) {
		e.preventDefault();
		e.stopPropagation();
		suppressClick = false;
	}
}, true);

let wheelDelta = 0;
let wheelLockedUntil = 0;
stage.addEventListener('wheel', (e) => {
	if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
	e.preventDefault(); // also stops the browser's back/forward swipe
	if (Date.now() < wheelLockedUntil) return;
	wheelDelta += e.deltaX;
	if (Math.abs(wheelDelta) > 80) {
		go(wheelDelta > 0 ? 1 : -1);
		wheelDelta = 0;
		wheelLockedUntil = Date.now() + 600;
	}
}, { passive: false });

document.addEventListener('keydown', (e) => {
	if (e.target === filter || e.altKey || e.ctrlKey || e.metaKey) return;
	if (e.key === 'ArrowRight') go(1);
	else if (e.key === 'ArrowLeft') go(-1);
});


// Search --------------------------------------------------------------------

filter.addEventListener('input', () => show());

filter.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') {
		tiles[0]?.el.querySelector('a').click();
	} else if (e.key === 'Escape') {
		filter.value = '';
		show();
	}
});


// Footer buttons ------------------------------------------------------------

async function updatePreviewsButton() {
	previewsButton.hidden = !api.storage?.local
		|| await api.permissions.contains(PREVIEW_PERMISSIONS);
}

previewsButton.addEventListener('click', () => {
	// Must be called directly from the click
	api.permissions.request(PREVIEW_PERMISSIONS).then(updatePreviewsButton);
});

document.querySelector('#edit').addEventListener('click', () => {
	// Firefox doesn't expose a navigable URL for its bookmarks manager
	if (isFirefox) {
		alert('To manage bookmarks in Firefox, use Ctrl+Shift+O (or Cmd+Shift+O on Mac).');
		return;
	}
	api.tabs.create({ url: `chrome://bookmarks/?id=${folder ? folder.id : 0}` });
});


// Start ---------------------------------------------------------------------

async function init() {
	folder = await getHomeFolder();
	pages = getSections(folder).map((s) => ({ id: s.id, title: s.title ?? 'Top Sites', items: s.items }));

	// Reopen the folder shown last (by bookmark id, so reordering is fine)
	const last = pages.findIndex((p) => p.id === localStorage.getItem(LAST_PAGE_KEY));
	pageIndex = Math.max(0, last);
	renderNav();

	// Capture windows still open from an earlier new tab page
	try {
		const session = await api.storage.session.get(null);
		for (const key of Object.keys(session)) {
			if (key.startsWith('capturing:')) capturing.add(key.slice(10));
		}
	} catch (e) {} // not essential, the page works without it

	if (api.storage?.local) {
		const keys = pages.flatMap((p) => p.items.map((bm) => thumbKey(bm.url)));
		const stored = await api.storage.local.get(keys).catch(() => ({}));
		for (const [key, value] of Object.entries(stored)) {
			if (value?.data) thumbs[key] = value.data;
		}
	}

	show();
	updatePreviewsButton();
}

init();
