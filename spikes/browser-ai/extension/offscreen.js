// The hidden background page (offscreen document): where a scan that runs for hours could live,
// independent of any open tab or panel. Progress goes to the service worker, which keeps it for the popup.
import { runBenchmark } from "./bench.js";

const report = (line) => chrome.runtime.sendMessage({ type: "ai-test-log", line });

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "ai-test-run-offscreen") return;
  runBenchmark("background", report)
    .catch((e) => report(`FAILED: ${e.stack ?? e}`))
    .finally(() => chrome.runtime.sendMessage({ type: "ai-test-done" }));
});
chrome.runtime.sendMessage({ type: "ai-test-offscreen-ready" });
