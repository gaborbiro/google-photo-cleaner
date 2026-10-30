// The review tab's Settings: what applies to every tab rather than to one. The account's protection
// choices first, then help and feedback (where to write, diagnostics), this computer's (usage statistics,
// erasing), and the version at the foot.
// It works with no account too: diagnostics and erasing cover every account.

import type { ReportView } from '../scan/report';
import type { FeedbackView } from '../shared/feedback';
import type { AnalysisJob, ScanJob } from '../shared/job';
import type { ProtectionChoices } from '../shared/preferences';
import { DiagnosticsCard, EraseCard, ProtectionCard } from '../ui/JobCard';
import { UsageCard } from '../ui/UsageCard';

/**
 * [account]: null with no account yet, when there are no protection choices to show. [scan] and
 * [analysis]: null for none, undefined while loading (diagnostics wait for them).
 */
export function Settings({ account, choices, scan, analysis, report, feedback, versionLabel, active }: {
  account: string | null;
  choices: ProtectionChoices | undefined;
  scan: ScanJob | null | undefined;
  analysis: AnalysisJob | null | undefined;
  report: ReportView | null | undefined;
  feedback: FeedbackView;
  versionLabel: string;
  active: boolean;
}) {
  return (
    <div className="scan-tab settings-tab" hidden={!active}>
      {account !== null && choices !== undefined && <ProtectionCard account={account} choices={choices} />}
      <h2 className="settings-heading">Help and feedback</h2>
      <section className="card utility feedback-card">
        <p>
          Questions, ideas, or something that could work better? I'd love to hear from you:{' '}
          <a href={feedback.mailto}>{feedback.email}</a>, or <a href={feedback.issuesUrl} target="_blank" rel="noreferrer">open an issue on GitHub</a>.
        </p>
      </section>
      {scan !== undefined && analysis !== undefined && <DiagnosticsCard scan={scan} analysis={analysis} report={report ?? null} />}
      <h2 className="settings-heading">This computer</h2>
      <UsageCard />
      <EraseCard />
      <p className="version mono" title="Photo Cleaner's version">{versionLabel}</p>
    </div>
  );
}
