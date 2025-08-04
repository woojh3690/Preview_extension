<<<<<<< HEAD
const toggleCheckbox = document.getElementById('previewToggle');

// Load current state
chrome.storage.sync.get('previewsEnabled', (res) => {
    toggleCheckbox.checked = res.previewsEnabled ?? true;
});

toggleCheckbox.addEventListener('change', () => {
    const newVal = toggleCheckbox.checked;

    // Save new setting
    chrome.storage.sync.set({ previewsEnabled: newVal }, () => {
        // Send message to active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'previewToggleChanged',
                    value: newVal
                });
            }
        });
    });
});
=======
const toggleCheckbox = document.getElementById('previewToggle');

// Load current state
chrome.storage.sync.get('previewsEnabled', (res) => {
    toggleCheckbox.checked = res.previewsEnabled ?? true;
});

toggleCheckbox.addEventListener('change', () => {
    const newVal = toggleCheckbox.checked;

    // Save new setting
    chrome.storage.sync.set({ previewsEnabled: newVal }, () => {
        // Send message to active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'previewToggleChanged',
                    value: newVal
                });
            }
        });
    });
});
>>>>>>> 00457b1babde9906d997b001847d58b146ec23ff
