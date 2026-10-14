// The scan's state and its one button; the same card in every surface.

import { pauseScan, resumeScan, startScan } from '../shared/actions';
import type { Job } from '../shared/job';
import { jobView } from '../shared/jobView';
import { send, store } from './hooks';

export function JobCard({ account, job }: { account: string; job: Job | null }) {
  const view = jobView(job);
  const act = () => {
    const now = Date.now();
    switch (view.action) {
      case 'start':
      case 'restart':
        return void startScan(store, send, account, now);
      case 'pause':
        return void pauseScan(store, account, now);
      case 'resume':
        return void resumeScan(store, send, account, now);
    }
  };
  return (
    <section className="card">
      <div className="row">
        <strong>{view.title}</strong>
        <button className={view.action === 'pause' ? '' : 'primary'} onClick={act}>{view.actionLabel}</button>
      </div>
      {view.progressText && (
        <>
          <div className="bar"><div style={{ width: `${view.percent}%` }} /></div>
          <div className="mono">{view.progressText}</div>
        </>
      )}
      {view.timesText && <div className="muted mono">{view.timesText}</div>}
    </section>
  );
}
