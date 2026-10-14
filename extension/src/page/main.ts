// The connector's page script (see install.ts).

import { PAGE_CHANNEL } from '../shared/protocol';
import { installPageScript } from './install';

installPageScript({ channel: PAGE_CHANNEL, ownerKey: '__photoCleanerPageId' });
