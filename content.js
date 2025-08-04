// == ES Forum Post Thumbnail Preview ==

// Utility to debounce preview fetches
function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// Create the preview container, once
let previewDiv = document.createElement('div');
previewDiv.id = 'post-hover-preview';
previewDiv.style.display = 'none';
document.body.appendChild(previewDiv);

// State
let currentAnchor = null;
let leaveTimer = null;
const previewCache = new Map();
const PREVIEW_CACHE_LIMIT = 50;
let lastRequestedUrl = null;
let hoverIntentTimer = null;
let previewsEnabled = true;

// Try to restore cache from sessionStorage
const savedCache = sessionStorage.getItem('previewCache');
if (savedCache) {
    try {
        const parsed = JSON.parse(savedCache);
        parsed.forEach(([k, v]) => previewCache.set(k, v));
        console.log(`[Preview] Restored ${parsed.length} cached previews from sessionStorage`);
    } catch (e) {
        console.warn('[Preview] Failed to restore previewCache:', e);
    }
}

// Request current toggle state from background
chrome.runtime.sendMessage({ type: 'get-previewsEnabled' }, (res) => {
    previewsEnabled = res?.previewsEnabled ?? true;
    console.log('[Preview] Previews enabled:', previewsEnabled);
});

// Listen for toggle updates from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'previewToggleChanged') {
        previewsEnabled = msg.value;
        console.log('[Preview] Toggled:', previewsEnabled);

        if (!previewsEnabled) {
            hidePreview(); // Hide current preview if open
        }
    }
});

function isHeatmapUrl(url) {
    return /^https:\/\/eroscripts-discourse\.eroscripts\.com\/(optimized|original)\/[34]X\/[a-f0-9/._-]+?\.(png|jpe?g)$/i.test(url);
}

function extractPreviewImages(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const imgs = Array.from(div.querySelectorAll('img'));

    const filtered = imgs.filter(img => {
        const cls = img.className || "";
        const alt = (img.getAttribute('alt') || "").toLowerCase();
        const excludedClasses = /(avatar|emoji|fa|icon|svg-inline)/i.test(cls);
        const excludedAlts = ['patreon', 'fanbox', 'rule34vid'].includes(alt);
        return !excludedClasses && !excludedAlts;
    });

    const loadImage = (src) =>
        new Promise(resolve => {
            const img = new Image();
            img.onload = () =>
                resolve({
                    src,
                    width: img.naturalWidth,
                    height: img.naturalHeight
                });
            img.onerror = () => resolve(null);
            img.src = src;
        });


    const promises = filtered.map(img => {
        let src = img.getAttribute('src');
        if (!src || src.startsWith('blob:')) return null;

        if (src.startsWith('//')) {
            src = window.location.protocol + src;
        } else if (src.startsWith('/')) {
            src = window.location.origin + src;
        }

        return loadImage(src);
    }).filter(Boolean);

    return Promise.all(promises).then(results => {
        const clean = results.filter(Boolean);
        console.log('[Preview Debug] Loaded image metadata:', clean);

        const isHeatmapSize = (w, h) => w >= 300 && w <= 900 && h >= 10 && h <= 100;

        const heatmap = clean.find(img =>
            isHeatmapSize(img.width, img.height)
        );

        const animated = clean.find(img => /\.(gif|webp)(\?|#|$)/i.test(img.src));
        const fallback = clean.find(img => /\.(png|jpe?g)(\?|#|$)/i.test(img.src) && img !== heatmap);
        const firstImage = animated || fallback;

        const finalImages = [];
        if (firstImage) finalImages.push(firstImage.src);
        if (heatmap && heatmap.src !== firstImage?.src) finalImages.push(heatmap.src);

        console.log('[Preview Debug] Final selected preview images:', finalImages);
        return finalImages;
    });
}

// Fetch post preview (get all image urls)
async function fetchPostPreview(topicUrl) {
    if (previewCache.has(topicUrl)) return previewCache.get(topicUrl);

    const m = topicUrl.match(/\/t\/[^/]+\/(\d+)/);
    if (!m) return null;

    const topicId = m[1];

    try {
        const apiUrl = `/t/${topicId}.json`;
        const resp = await fetch(apiUrl, { credentials: "same-origin" });
        if (!resp.ok) return null;

        const data = await resp.json();
        const firstPost = data?.post_stream?.posts?.[0];
        if (!firstPost) return null;

        const images = await extractPreviewImages(firstPost.cooked);
        const result = {
            title: data.title,
            username: firstPost.username,
            images: images
        };

        // Store preview in LRU cache
        previewCache.set(topicUrl, result);

        // Enforce cache size
        if (previewCache.size > PREVIEW_CACHE_LIMIT) {
            const oldestKey = previewCache.keys().next().value;
            previewCache.delete(oldestKey);
        }
        persistPreviewCache();

        return result;
    } catch (e) {
        console.warn('[Preview Debug] Failed to fetch preview:', e);
        return null;
    }
}


// Position preview next to mouse
function positionPreviewDiv(evt) {
    const pad = 18;
    let x = evt.clientX + pad + window.scrollX;
    let y = evt.clientY + pad + window.scrollY;
    previewDiv.style.left = x + "px";
    previewDiv.style.top = y + "px";
}

// Hide
function hidePreview() {
    previewDiv.style.display = 'none';
    previewDiv.innerHTML = '';
    currentAnchor = null;
}

// Show
function showPreview(html) {
    previewDiv.innerHTML = `<div class="es-preview">${html}</div>`;
    previewDiv.style.display = 'block';
}

// Compose preview HTML (shows all found gif/png/jpg/jpeg images)
function composePreviewHTML(post) {
    if (!post.images || !post.images.length) {
        return `<div class="es-preview-noimg">No images found in post.</div>`;
    }

    return `
    <div class="es-preview-images two-large-column">
      ${post.images.map(
        url => `<img class="es-preview-thumb-large" src="${url}" alt="Preview image">`
    ).join('')}
    </div>
  `;
}


// Find topic links in search/list results
function getTopicAnchors() {
    let searchLinks = Array.from(document.querySelectorAll('a.search-link[href*="/t/"]'));
    let listLinks = Array.from(document.querySelectorAll('a.title[href*="/t/"]'));
    return [...new Set([...searchLinks, ...listLinks])];
}

function setupPreviewListeners() {
    observePreviewAnchors(); // use IntersectionObserver instead of binding all now

    const anchors = getTopicAnchors();
    for (let anchor of anchors) {
        if (anchor.dataset.esPreview) continue;
        anchor.dataset.esPreview = "bound";

        anchor.addEventListener('mouseenter', function (evt) {
            if (!previewsEnabled) return;

            if (leaveTimer) clearTimeout(leaveTimer);

            hoverIntentTimer = setTimeout(() => {
                currentAnchor = anchor;
                positionPreviewDiv(evt);

                previewDiv.innerHTML = '<div class="es-preview-loading">Loading preview...</div>';
                previewDiv.style.display = 'block';

                debouncedFetchAndShow(anchor.href, evt);
            }, 500); // Wait 0.5 second before previewing
        });

        anchor.addEventListener('mousemove', function (evt) {
            if (currentAnchor === anchor) {
                positionPreviewDiv(evt);
            }
        });

        anchor.addEventListener('mouseleave', function () {
            if (hoverIntentTimer) clearTimeout(hoverIntentTimer);
            leaveTimer = setTimeout(hidePreview, 180);
        });
    }

    previewDiv.addEventListener('mouseenter', function () {
        if (leaveTimer) clearTimeout(leaveTimer);
    });

    previewDiv.addEventListener('mouseleave', function () {
        if (hoverIntentTimer) clearTimeout(hoverIntentTimer);
        hidePreview();
    });
}

function setupPreviewListenersOnce(anchor) {
    if (anchor.dataset.esPreview === "bound") return;
    if (window.innerWidth < 640) return;

    anchor.dataset.esPreview = "bound";


    anchor.addEventListener('mouseenter', function (evt) {
        if (!previewsEnabled) return;

        if (leaveTimer) clearTimeout(leaveTimer);

        hoverIntentTimer = setTimeout(() => {
            currentAnchor = anchor;
            positionPreviewDiv(evt);

            previewDiv.innerHTML = '<div class="es-preview-loading">Loading preview...</div>';
            previewDiv.style.display = 'block';

            debouncedFetchAndShow(anchor.href, evt);
        }, 500);
    });

    anchor.addEventListener('mouseleave', function () {
        if (hoverIntentTimer) clearTimeout(hoverIntentTimer);
        leaveTimer = setTimeout(hidePreview, 180);
    });

    console.log("[Preview] Bound preview to:", anchor.href);
}

const intersectionOptions = {
    root: null,
    rootMargin: '200px',
    threshold: 0
};

const anchorObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const anchor = entry.target;
            setupPreviewListenersOnce(anchor);
            anchorObserver.unobserve(anchor);

            // 🔥 Preload JSON early
            const relHref = anchor.href.replace(/^https?:\/\/[^/]+/, '');
            fetchPostPreview(relHref).then((data) => {
                console.log('[Preview Preload] Cached for:', anchor.href, data);
            });

            console.log('[Preview] Anchor in view:', anchor.href);
        }
    });
}, intersectionOptions);

function observePreviewAnchors() {
    const anchors = getTopicAnchors();
    anchors.forEach(anchor => {
        if (!anchor.dataset.esPreview) {
            anchorObserver.observe(anchor);
            console.log('[Preview] Observing anchor:', anchor.href);
        }
    });
}

function addPreviewHintIcon(anchor) {
    const icon = document.createElement('span');
    icon.textContent = '👁️';
    icon.style.marginLeft = '4px';
    icon.style.fontSize = '0.8em';
    icon.style.opacity = '0.6';
    anchor.appendChild(icon);
}

function persistPreviewCache() {
    const entries = Array.from(previewCache.entries());
    sessionStorage.setItem('previewCache', JSON.stringify(entries));
}

const debouncedFetchAndShow = debounce(async (href, evt) => {
    lastRequestedUrl = href;  // Track latest hover

    const relHref = href.replace(/^https?:\/\/[^/]+/, '');
    const data = await fetchPostPreview(relHref);

    // If this isn't the latest hovered link, skip
    if (href !== lastRequestedUrl) {
        console.log('[Preview Debug] Ignoring stale preview for', href);
        return;
    }

    if (!data) {
        previewDiv.innerHTML = "<div class='es-preview-failed'>Could not fetch preview.</div>";
        return;
    }

    showPreview(composePreviewHTML(data));
    positionPreviewDiv(evt);
}, 180);

const observer = new MutationObserver(setupPreviewListeners);
observer.observe(document.body, { childList: true, subtree: true });

setupPreviewListeners();
