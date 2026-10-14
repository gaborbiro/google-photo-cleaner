// The app extension's page script: the same read-only operations as the connector, on
// its own channel, so both can be installed at once.

import { installPageScript } from '../../page/install';
import { APP_PAGE_CHANNEL, APP_PAGE_OWNER_KEY } from '../shared/constants';

installPageScript({ channel: APP_PAGE_CHANNEL, ownerKey: APP_PAGE_OWNER_KEY, exposeAccountEmail: true });
