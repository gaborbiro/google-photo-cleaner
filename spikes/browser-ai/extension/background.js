// Service worker: starts the background run in an offscreen document and keeps its log for the popup.
// It also checks whether the service worker itself can reach the GPU.

async function log(line) {
  const { aiTestLog = [] } = await chrome.storage.local.get("aiTestLog");
  aiTestLog.push(`${new Date().toLocaleTimeString()} ${line}`);
  await chrome.storage.local.set({ aiTestLog: aiTestLog.slice(-60) });
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  switch (message.type) {
    case "ai-test-start-background":
      startBackground().then(() => reply(true), (e) => log(`FAILED to start: ${e.message}`).then(() => reply(false)));
      return true;
    case "ai-test-check-worker-gpu":
      checkWorkerGpu().then(reply);
      return true;
    case "ai-test-offscreen-ready":
      chrome.runtime.sendMessage({ type: "ai-test-run-offscreen" });
      break;
    case "ai-test-log":
      log(message.line);
      break;
    case "ai-test-done":
      log("background run finished; closing the background page").then(() => chrome.offscreen.closeDocument());
      break;
  }
  return false;
});

async function startBackground() {
  await chrome.storage.local.set({ aiTestLog: [] });
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  await log("starting the background page");
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Runs the photo model on the GPU in the background, independent of open tabs.",
  });
}

async function checkWorkerGpu() {
  if (!navigator.gpu) return "service worker: navigator.gpu is missing";
  const adapter = await navigator.gpu.requestAdapter();
  return adapter ? `service worker: GPU reachable (${adapter.info?.vendor ?? "?"} / ${adapter.info?.architecture ?? "?"})` : "service worker: no GPU adapter";
}
