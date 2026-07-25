window.onload = function () {

	const _FOLDER = 'HomePage';

	const isFirefox = navigator.userAgent.includes('Firefox');
	const isChromium = typeof chrome !== 'undefined'
		&& !!chrome.runtime?.id
		&& !isFirefox;

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

	chrome.bookmarks.getTree((root) => {

		// const folder = root[0]?.children?.[0]?.children?.find((el) => el.title === _FOLDER);

		// Get the bookmarks bar (first child of bookmarks root)
		const bookmarksBar = root[0]?.children?.[0];

		// If _FOLDER is falsy or not found, use bookmarksBar
		const folder = _FOLDER
			? bookmarksBar?.children?.find((el) => el.title === _FOLDER)
			: bookmarksBar;


		// Link to Bookmarks Manager
		// Firefox doesn't expose a navigable URL for its bookmarks manager
		// (chrome://bookmarks/ is Chrome-only), so we show the keyboard
		// shortcut instead.
		document.querySelector('aside button').addEventListener('click', function(e) {
			if (isFirefox) {
				alert('To manage bookmarks in Firefox, use Ctrl+Shift+O (or Cmd+Shift+O on Mac).');
				return;
			}
			const id = folder ? folder.id : 0;
			chrome.tabs.create({ url: `chrome://bookmarks/?id=${id}` });
		});


		function createBookmarkItem(bm) {
			const li = document.createElement('li');
			const figure = document.createElement('figure');
			const a = document.createElement('a');
			const img = document.createElement('img');
			const figcaption = document.createElement('figcaption');

			a.href = bm.url;
			a.title = bm.title;

			img.alt = bm.title;
			img.src = getFaviconUrl(bm.url);

			figcaption.textContent = bm.title;

			a.appendChild(img);
			a.appendChild(figcaption);
			figure.appendChild(a);
			li.appendChild(figure);

			return li;
		}

		if (folder) {
			const fragment = document.createDocumentFragment();

			// Separate child folders from direct links
			const childFolders = folder.children?.filter(item => item.children) || [];
			const directLinks = folder.children?.filter(item => item.url) || [];

			// If there are direct links, create a top-level list
			if (directLinks.length > 0) {
				const ul = document.createElement('ul');
				for (let bm of directLinks) {
					ul.appendChild(createBookmarkItem(bm));
				}
				fragment.appendChild(ul);
			}

			// Process each child folder
			if (childFolders.length > 0) {
				for (let childFolder of childFolders) {
					if (childFolder.children && childFolder.children.length > 0) {
						const h3 = document.createElement('h3');
						h3.textContent = childFolder.title;
						fragment.appendChild(h3);

						const ul = document.createElement('ul');
						for (let bm of childFolder.children) {
							if (bm.url) {  // Only process if it's a bookmark, not a subfolder
								ul.appendChild(createBookmarkItem(bm));
							}
						}
						fragment.appendChild(ul);
					}
				}
			}

			const main = document.querySelector('main');
			main.replaceChildren(fragment);

		} else {

			const main = document.querySelector('main');
			const p = document.createElement('p');
			p.textContent = 'No bookmarks found.';
			main.replaceChildren(p);

		}
	});
}