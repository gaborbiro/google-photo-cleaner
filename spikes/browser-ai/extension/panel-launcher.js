// On photos.google.com: a small button that opens the app page as a panel on the right,
// on top of Google Photos, the way some competitors do it.
(() => {
  if (window.__photoCleanerAiTest) return;
  window.__photoCleanerAiTest = true;

  const button = document.createElement("button");
  button.textContent = "AI test";
  Object.assign(button.style, {
    position: "fixed", right: "16px", bottom: "16px", zIndex: 2147483647,
    padding: "8px 14px", borderRadius: "18px", border: "none", background: "#6d4aff", color: "#fff",
    font: "600 13px system-ui, sans-serif", cursor: "pointer",
  });

  let panel = null;
  button.onclick = () => {
    if (panel) {
      panel.remove();
      panel = null;
      return;
    }
    panel = document.createElement("iframe");
    panel.src = chrome.runtime.getURL("app.html?placement=panel");
    Object.assign(panel.style, {
      position: "fixed", top: "64px", right: "0", width: "460px", height: "calc(100vh - 64px)",
      zIndex: 2147483646, border: "none", borderLeft: "1px solid #8886", background: "Canvas",
    });
    document.body.appendChild(panel);
  };
  document.body.appendChild(button);
})();
