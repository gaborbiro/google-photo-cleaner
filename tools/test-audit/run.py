"""Replay one recorded production-code fault, restoring the source byte-for-byte.

Run only in an idle checkout: this deliberately makes tests fail. No browser or Google
account is used. See docs/test-audit.md for the scope and limitations of the evidence.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def execute(command: list[str], cwd: Path, log: Path) -> int:
    with log.open("wb") as stream:
        process = subprocess.Popen(command, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT)
        try:
            return process.wait(timeout=240)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
            else:
                process.kill()
            process.wait()
            raise


def test(fault: dict, work: Path, phase: str) -> tuple[int, set[tuple[str, str]]]:
    report = work / f"{phase}.json"
    if fault["suite"] == "extension":
        files = sorted({case["file"].removeprefix("extension/") for case in fault["cases"]})
        command = ["node", "node_modules/vitest/vitest.mjs", "run", *files,
                   "--reporter=json", f"--outputFile={report}"]
        code = execute(command, ROOT / "extension", work / f"{phase}.log")
        data = json.loads(report.read_text(encoding="utf-8")) if report.exists() else {}
        failed = {(Path(file["name"]).relative_to(ROOT).as_posix(), case["fullName"])
                  for file in data.get("testResults", []) for case in file["assertionResults"]
                  if case["status"] == "failed"}
        return code, failed
    # Force fresh assertions; an up-to-date Gradle task is not a test execution.
    init = work / "force-tests.gradle"
    init.write_text("allprojects { tasks.withType(Test).configureEach { outputs.upToDateWhen { false }; timeout = java.time.Duration.ofSeconds(90) } }\n", encoding="utf-8")
    command = [str(ROOT / ("gradlew.bat" if os.name == "nt" else "gradlew"))]
    command += [":features:shared:duplicates:jvmTest", "--continue", "--console=plain", "-I", str(init)]
    import time
    began = time.time()
    code = execute(command, ROOT, work / f"{phase}.log")
    failed = set()
    for path in fault["reports"]:
        report = ROOT / path
        if not report.exists() or report.stat().st_mtime < began - 1:
            continue
        for case in ET.parse(report).findall("testcase"):
            if case.find("failure") is not None:
                failed.add((case.get("classname", ""), case.get("name", "")))
    return code, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fault", help="Fault ID in faults.json")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    faults = json.loads(Path(__file__).with_name("faults.json").read_text(encoding="utf-8"))
    if args.list:
        for fault in faults:
            print(f'{fault["id"]}: {fault["description"]} ({fault["file"]})')
        return 0
    fault = next((f for f in faults if f["id"] == args.fault), None)
    if fault is None:
        parser.error("Choose --fault ID or --list")
    source = (ROOT / fault["file"]).resolve()
    source.relative_to(ROOT)  # Reject a manifest entry outside this checkout.
    original = source.read_bytes()
    text = original.decode("utf-8")
    start = fault["offset"]
    old = fault["original"]
    if text[start:start + len(old)] != old:
        raise SystemExit("Source changed since the audit; refusing to apply the recorded fault.")
    mutated = (text[:start] + fault["replacement"] + text[start + len(old):]).encode("utf-8")
    work = Path(tempfile.mkdtemp(prefix="photo-cleaner-test-audit-"))
    print(f'Checking {fault["id"]}: {fault["description"]}\nEvidence: {work}', flush=True)
    code, _ = test(fault, work, "baseline")
    if code:
        raise SystemExit("Baseline failed. No source was changed; inspect baseline.log.")
    (work / "source-backup.bin").write_bytes(original)
    try:
        source.write_bytes(mutated)
        code, failed = test(fault, work, "mutated")
    finally:
        if source.read_bytes() != mutated:
            raise RuntimeError(f"Source changed externally; preserved both it and the backup in {work}")
        source.write_bytes(original)
    expected = {(c.get("class", c.get("file", "")), c["name"]) for c in fault["cases"]}
    caught = expected & failed
    print(f"Restored source. {len(caught)}/{len(expected)} recorded cases rejected the fault.")
    # Build errors, discovery errors and timeouts do not establish a killed mutation.
    return 0 if code != 0 and caught == expected else 1


if __name__ == "__main__":
    raise SystemExit(main())
