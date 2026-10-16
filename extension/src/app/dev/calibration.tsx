// Developer tool: works out the duplicate threshold for this account's fingerprints from the labels
// given in the desktop app's Calibration tab (exported by scripts/export-calibration-labels.py).
// Everything stays on this computer: the labels file is read here and nothing is saved.

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IndexedDbAnalysisStore, type AnalysisSettings } from '../ai/analysisStore';
import { FALLBACK_DETAIL, PREFERRED_DETAIL, type Detail } from '../ai/model';
import { atDetail, calibrate, calibrationView, parseLabels, type CalibrationView } from '../duplicates/calibration';
import { accountLabel } from '../shared/jobView';
import { useAccount } from '../ui/hooks';

const analysis = new IndexedDbAnalysisStore();

function Calibration() {
  const { answer } = useAccount();
  const account = new URLSearchParams(location.search).get('account') ?? answer?.account?.fingerprint ?? null;
  const [view, setView] = useState<CalibrationView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [switched, setSwitched] = useState(false);

  useEffect(() => {
    if (account !== null) void analysis.settings(account).then(setSettings, (error: unknown) => setProblem(String(error)));
  }, [account]);

  /** Analyses (and scores) at [detail] from now on; the other detail's fingerprints are kept. */
  const switchTo = async (detail: Detail) => {
    if (!settings) return;
    setView(null);
    const next = atDetail(settings, detail, Date.now());
    await analysis.saveSettings(next);
    setSettings(next);
    setSwitched(true);
  };

  const load = async (file: File) => {
    setView(null);
    setProblem(null);
    try {
      if (account === null) throw new Error('Open Google Photos first, so the account is known.');
      const settings = await analysis.settings(account);
      if (!settings) throw new Error('This account has not been analysed yet.');
      const pairs = parseLabels(await file.text());
      const fingerprints = new Map((await analysis.embeddings(settings.modelKey, account)).map((e) => [e.mediaKey, e.vector]));
      setView(calibrationView(calibrate(pairs, fingerprints, settings.detail)));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="review">
      <h1>Photo Cleaner · calibration (developer tool)</h1>
      <p className="muted">
        Scores the pairs labelled in the desktop app's Calibration tab with this account's fingerprints and recommends the duplicate threshold.
        Export the labels with <span className="mono">python -I extension/scripts/export-calibration-labels.py labels.json</span>, then choose that file.
      </p>
      <h2>{account ? accountLabel(account, answer?.account?.email ?? null) : 'No account yet'}</h2>
      {settings && (
        <section className="card">
          <strong>This library is analysed at detail <span className="mono">{settings.detail}</span>, and scored with those fingerprints.</strong>
          <div className="buttons">
            {[PREFERRED_DETAIL, FALLBACK_DETAIL].map((d) => (
              <button key={d} disabled={d === settings.detail} onClick={() => void switchTo(d).catch((error: unknown) => setProblem(String(error)))}>Use detail {d}</button>
            ))}
          </div>
          <p className="muted">
            To calibrate another detail: switch to it, press Check for new photos (it fingerprints every photo not yet done at that detail; the other detail's
            fingerprints are kept), then choose the labels file. Switch back when done. Not while a scan is running.
          </p>
          {switched && <p className="warn">Switched to detail {settings.detail}. Press Check for new photos before scoring.</p>}
        </section>
      )}
      <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
      {problem && <div className="warn">{problem}</div>}
      {view && (
        <section className="card">
          {view.lines.map((line) => <div key={line} className="mono">{line}</div>)}
          <table className="counts">
            <thead><tr><th>Threshold</th><th>Flagged</th><th>Wrong</th><th>Precision</th><th>Recall</th><th>Same recall</th></tr></thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.threshold} className={r.recommended ? 'recommended' : ''}>
                  <td className="mono">{r.threshold}{r.recommended ? ' ◀' : ''}</td>
                  <td className="mono num">{r.flagged}</td>
                  <td className="mono num">{r.wrong}</td>
                  <td className="mono num">{r.precision}</td>
                  <td className="mono num">{r.recall}</td>
                  <td className="mono num">{r.sameRecall}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Calibration />);
