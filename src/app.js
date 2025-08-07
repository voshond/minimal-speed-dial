window.onload = function () {

	const _FOLDER = 'HomePage';

	chrome.bookmarks.getTree((root) => {

		// const folder = root[0]?.children?.[0]?.children?.find((el) => el.title === _FOLDER);

		// Get the bookmarks bar (first child of bookmarks root)
		const bookmarksBar = root[0]?.children?.[0];

		// If _FOLDER is falsy or not found, use bookmarksBar
		const folder = _FOLDER
			? bookmarksBar?.children?.find((el) => el.title === _FOLDER)
			: bookmarksBar;


		// Link to Bookmarks Manager
		document.querySelector('aside button').addEventListener('click', function(e) {
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
							<a href="${bm.url}">
								<img alt="${bm.title}" src="chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(bm.url)}&size=128" />
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
										<a href="${bm.url}">
											<img alt="${bm.title}" src="chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(bm.url)}&size=128" />
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