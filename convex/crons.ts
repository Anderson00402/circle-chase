import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Keep the "now playing" strip honest when a tab closes without saying goodbye.
crons.interval('sweep stale presence', { seconds: 15 }, internal.presence.sweep, {});

export default crons;
