const logEl = document.getElementById("log");

async function refresh() {
  const { aiTestLog = [] } = await chrome.storage.local.get("aiTestLog");
  logEl.textContent = aiTestLog.join("\n");
}

document.getElementById("tab").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("app.html?placement=tab") });
document.getElementById("background").onclick = () => chrome.runtime.sendMessage({ type: "ai-test-start-background" }).then(refresh);
document.getElementById("worker").onclick = async () => {
  const text = await chrome.runtime.sendMessage({ type: "ai-test-check-worker-gpu" });
  logEl.textContent = `${text}\n${logEl.textContent}`;
};
chrome.storage.onChanged.addListener(refresh);
refresh();
