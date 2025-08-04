let previewsEnabled = true;

// Load setting from sync on startup
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get('previewsEnabled', (res) => {
        previewsEnabled = res.previewsEnabled ?? true;
    });
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'get-previewsEnabled') {
        chrome.storage.sync.get('previewsEnabled', (res) => {
            sendResponse({ previewsEnabled: res.previewsEnabled ?? true });
        });
        return true; // Keep sendResponse alive
    }

    if (message.type === 'toggle-previews') {
        previewsEnabled = !previewsEnabled;
        chrome.storage.sync.set({ previewsEnabled });
        sendResponse({ previewsEnabled });
    }
});