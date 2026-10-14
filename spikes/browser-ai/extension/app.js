// The app page: opened as its own tab (?placement=tab) or embedded in Google Photos (?placement=panel).
import { runBenchmark } from "./bench.js";

const placement = new URLSearchParams(location.search).get("placement") ?? "tab";
const log = (line) => { document.getElementById("log").textContent += line + "\n"; };
document.getElementById("title").textContent = placement === "panel" ? "Browser AI test – panel inside Google Photos" : "Browser AI test – own tab";

document.getElementById("run").onclick = async (event) => {
  event.target.disabled = true;
  try {
    await runBenchmark(placement, log);
  } catch (e) {
    log(`FAILED: ${e.stack ?? e}`);
  } finally {
    event.target.disabled = false;
  }
};
