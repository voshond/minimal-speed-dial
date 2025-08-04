window.onload = function () {

    const _FOLDER = 'HomePage';

    chrome.bookmarks.getTree((root) => {
        const folder = root[0]?.children?.[0]?.children?.find((el) => el.title === _FOLDER)
    
        if (folder) {
            let html = '<ul>\n'
            for (let bm of folder.children) {
                html += `<li>
                    <figure>
                        <a href="${bm.url}">
                            <img alt="${bm.title}" src="chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(bm.url)}&size=128" />
                            <figcaption>${bm.title}</figcaption>
                        </a>
                    </figure>
                </li>`;
            }
            document.querySelector('main').innerHTML = html + '\n</ul>'
        }
    });

}