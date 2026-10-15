// The app extension's page script: the connector's read operations plus the trash operations, on
// its own channel, so both can be installed at once.

import { installPageScript } from '../../page/install';
import { runWriteOp } from '../../page/trashOps';
import { APP_PAGE_CHANNEL, APP_PAGE_OWNER_KEY } from '../shared/constants';

installPageScript({ channel: APP_PAGE_CHANNEL, ownerKey: APP_PAGE_OWNER_KEY, exposeAccountEmail: true, writes: runWriteOp });
