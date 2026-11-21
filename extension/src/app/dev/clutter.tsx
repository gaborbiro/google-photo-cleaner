// Developer tool, not linked from the app: suggested searches for clutter by subject and setting
// (clutterAxes.tsx), to judge whether they are right and useful before they become part of the product.
// Reads the same data as Search; nothing is trashed from here. A tab opened from it with ?all=<id>
// shows a list of photos the page handed over.
// The single list, the page's first mode, was removed on 2026-11-21.

import { createRoot } from 'react-dom/client';
import { AxesFindsPage, AxesPage } from './clutterAxes';

const allFinds = new URLSearchParams(location.search).get('all');
createRoot(document.getElementById('root')!).render(allFinds ? <AxesFindsPage id={allFinds} /> : <AxesPage />);
