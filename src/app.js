window.onload = function () {

    const APP = {
        folder : 'HomePage',
        clock : false,
        search : false
    }

    if (APP.clock) {

        function updateClock() {

            const now = new Date();
            const timeElement = document.querySelector('#clock .time');
            const dateElement = document.querySelector('#clock .date');
            
            const time = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            });
            const seconds = (now.toLocaleTimeString('en-US', { second: '2-digit' })).padStart(2, '0');
            
            const date = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
            const day = `${now.toLocaleString('en-US', { weekday: 'long' })}`;
    
            timeElement.innerHTML = `${time}:${seconds}`;
            dateElement.innerHTML = `${day} ${date}`;
        }
    
        updateClock();
        setInterval(updateClock, 1000);
    }

    if (APP.search) {

        document.getElementById('search-form').addEventListener('submit', function(e) {
            e.preventDefault();
            const query = document.getElementById('search-input').value.trim();
            if (query) {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                window.location.href = searchUrl;
            }
        });
    
    }

    if ( !APP.clock ) { document.querySelector('#clock').style.display = 'none'; }
    if ( !APP.search ) { document.querySelector('#search-form').style.display = 'none'; }
    if ( !APP.search && !APP.clock ) { document.querySelector('header').style.display = 'none'; }
    
    if (typeof chrome.bookmarks === 'undefined') return;

    chrome.bookmarks.getTree((root) => {
        const folder = root[0]?.children?.[0]?.children?.find((el) => el.title === APP.folder)
    
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
    })


}