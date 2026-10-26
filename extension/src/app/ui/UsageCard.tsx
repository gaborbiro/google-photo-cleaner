import { useEffect, useRef, useState } from 'react';
import { CHANGES_CHANNEL } from '../shared/constants';
import { USAGE_CONFIG, USAGE_POLICY, usageView, type UsageAnswer, type UsageSurface } from '../shared/usage';
import { emitUsage, refreshUsageConsent } from '../shared/usageClient';
import { IndexedDbUsageStore } from '../shared/usageStore';

/** Consent is global and available before connecting Google Photos or starting a scan. */
export function UsageCard() {
  const [answer, setAnswer] = useState<UsageAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    let alive = true;
    const store = new IndexedDbUsageStore();
    const load = () => { void store.get().then((state) => { if (alive) setAnswer(state.answer); }).catch(() => { if (alive) setProblem(true); }); };
    load();
    const channel = new BroadcastChannel(CHANGES_CHANNEL);
    channel.onmessage = (event) => { if (event.data?.kind === 'usage-changed' || event.data?.kind === 'erased') load(); };
    return () => { alive = false; channel.close(); };
  }, []);
  if (answer === null) return null;
  const view = usageView(answer, USAGE_CONFIG !== null);
  const choose = async (next: 'yes' | 'no') => {
    setBusy(true);
    try {
      const reply = await chrome.runtime.sendMessage({ kind: 'app-usage-consent', answer: next });
      if (reply?.ok !== true) throw new Error('Usage choice was not saved');
      setAnswer(next);
      setProblem(false);
      await refreshUsageConsent();
    } catch { setProblem(true); }
    finally { setBusy(false); }
  };
  return <section className="card usage-card" aria-label="Optional usage statistics">
    {view.ask ? <>
      <strong>{view.title}</strong><p>{view.description}</p>
      <div className="buttons"><button disabled={busy} onClick={() => void choose('yes')}>Allow usage statistics</button>
        <button disabled={busy} onClick={() => void choose('no')}>No thanks</button></div>
    </> : <label><input type="checkbox" checked={view.enabled} disabled={busy} onChange={(e) => void choose(e.target.checked ? 'yes' : 'no')} /> {view.setting}</label>}
    <small>{view.status} <a href={USAGE_POLICY} target="_blank" rel="noreferrer">What is sent</a></small>
    {problem && <p role="status">The usage choice could not be saved. Try again.</p>}
  </section>;
}

/** Reports visibility after React committed the page; preserved hidden review tabs do not count. */
export function useUsageSurface(surface: UsageSurface, root?: 'panel' | 'review'): void {
  const rootSeen = useRef(false);
  useEffect(() => {
    let alive = true;
    let visible = false;
    let activeSince: number | null = null;
    const engagement = () => {
      const now = performance.now();
      if (activeSince !== null && now - activeSince >= 1) emitUsage({ name: 'surface_engagement', params: { surface } }, undefined, Math.min(now - activeSince, 60_000));
      activeSince = document.visibilityState !== 'hidden' && document.hasFocus() ? now : null;
    };
    const report = () => {
      const nowVisible = document.visibilityState !== 'hidden';
      if (nowVisible && !visible) {
        emitUsage({ name: 'surface_view', params: { surface } });
        if (root && !rootSeen.current) {
          rootSeen.current = true;
          emitUsage({ name: 'surface_ready', params: { surface: root } });
        }
      }
      if (!nowVisible) rootSeen.current = false;
      visible = nowVisible;
    };
    const consent = () => { activeSince = null; visible = false; rootSeen.current = false; report(); engagement(); };
    void refreshUsageConsent().then(() => { if (alive) report(); });
    engagement();
    const timer = setInterval(engagement, 15_000);
    document.addEventListener('visibilitychange', report);
    document.addEventListener('visibilitychange', engagement);
    window.addEventListener('focus', engagement);
    window.addEventListener('blur', engagement);
    const channel = new BroadcastChannel(CHANGES_CHANNEL);
    channel.onmessage = (event) => { if (event.data?.kind === 'usage-changed') void refreshUsageConsent().then(consent); };
    const probe = (message: { kind?: string; surface?: string }, sender: chrome.runtime.MessageSender) => {
      if (root && sender.id === chrome.runtime.id && message?.kind === 'usage-probe' && message.surface === root && document.visibilityState !== 'hidden') {
        emitUsage({ name: 'surface_ready', params: { surface: root } });
      }
    };
    chrome.runtime.onMessage?.addListener(probe);
    return () => {
      alive = false;
      clearInterval(timer);
      channel.close();
      chrome.runtime.onMessage?.removeListener(probe);
      document.removeEventListener('visibilitychange', report);
      document.removeEventListener('visibilitychange', engagement);
      window.removeEventListener('focus', engagement);
      window.removeEventListener('blur', engagement);
    };
  }, [surface, root]);
}
