chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings").then((stored) => {
    if (!stored.settings) {
      chrome.storage.local.set({
        settings: {
          apiBase: "http://localhost:4000",
          token: "sentinelqa-dev-token",
          createNew: true,
          mode: "operations",
          active: false,
          steps: []
        }
      });
    }
  });
});

