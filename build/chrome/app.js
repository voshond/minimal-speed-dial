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


		if (folder) {
			let html = '';

			// Separate child folders from direct links
			const childFolders = folder.children?.filter(item => item.children) || [];
			const directLinks = folder.children?.filter(item => item.url) || [];

			// If there are direct links, create a top-level list
			if (directLinks.length > 0) {
				html += '<ul>\n';
				for (let bm of directLinks) {
					html += `<li>
						<figure>
							<a href="${bm.url}" title="${bm.title}">
								<img alt="${bm.title}" src="${getFaviconUrl(bm.url)}" />
								<figcaption>${bm.title}</figcaption>
							</a>
						</figure>
					</li>`;
				}
				html += '\n</ul>\n\n';
			}

			// Process each child folder
			if (childFolders.length > 0) {
				for (let childFolder of childFolders) {
					if (childFolder.children && childFolder.children.length > 0) {
						html += `<h3>${childFolder.title}</h3>\n`;
						html += '<ul>\n';
						for (let bm of childFolder.children) {
							if (bm.url) {  // Only process if it's a bookmark, not a subfolder
								html += `<li>
									<figure>
										<a href="${bm.url}" title="${bm.title}">
											<img alt="${bm.title}" src="${getFaviconUrl(bm.url)}" />
											<figcaption>${bm.title}</figcaption>
										</a>
									</figure>
								</li>`;
							}
						}
						html += '\n</ul>\n\n';
					}
				}
			}

			document.querySelector('main').innerHTML = html;

		} else {

			document.querySelector('main').innerHTML = `<p>No bookmarks found.</p>`;

		}
	});
}