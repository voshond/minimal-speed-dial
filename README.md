# Minimal Speed Dial

> Browser extension that replaces the new tab page with a minimal speed dial, automatically populated by the links bookmarked on the `Bookmarks/HomePage` folder.

- 🌐 Chrome: [chromewebstore.google.com/detail/minimal-speed-dial/nfbo...](https://chromewebstore.google.com/detail/minimal-speed-dial/nfbokdfpeanknhkligpmpmlhpakkeold)
- 🦊 Firefox: [addons.mozilla.org/addon/minimal-speed-dial](https://addons.mozilla.org/addon/minimal-speed-dial/)


This Browser extension replaces the default new tab page with a minimal speed dial interface. It pulls links and subfolders from the `Bookmarks/HomePage` folder, allowing users to organize and access their bookmarks without Chrome’s 10-link restriction.

- **No link limit**. Display as many bookmarks as needed.
- **Automatic sync**. Bookmarks and subfolders saved in the `HomePage` folder appear instantly.
- **Subfolder support**. Automatically organizes subfolders within `HomePage` into categorized sections with headers.
- **Bookmarks Manager shortcut**. Floating action button for quick access to manage bookmarks.
- **Simplified design**. Removes distractions, focusing only on quick access to saved links.

A lightweight alternative for users who prefer a straightforward, customizable new tab page.

![Minimal Speed Dial · Desktop](images/minimal-speed-dial-screenshot.png)

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension `/src` directory

## Getting Started

The extension reads bookmarks from a folder named **`HomePage`** inside your
bookmarks bar. If you don't already have one, you'll see a "No bookmarks found."
message — here's how to fix it:

1. Open your browser's **Bookmarks Manager**
   (`chrome://bookmarks/` or `about:bookmarks`).
2. Create a new folder called **`HomePage`** in the bookmarks bar.
3. Add your favorite links inside that folder. Bookmark subfolders
   are automatically displayed as grouped sections.
4. Open a new tab — your speed dial will appear instantly.

> The floating **`+`** button in the bottom-right corner is a shortcut
> to the Bookmarks Manager for quick editing.

---

&mdash; [@alterebro](https://x.com/alterebro)
