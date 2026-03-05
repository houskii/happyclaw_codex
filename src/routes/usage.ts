import { Hono } from 'hono';
import type { Variables } from '../web-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { getTokenUsageStats, getTokenUsageSummary } from '../db.js';

const usage = new Hono<{ Variables: Variables }>();

usage.use('*', authMiddleware);

/**
 * GET /api/usage/stats?days=7
 * Returns aggregated token usage statistics.
 */
usage.get('/stats', (c) => {
  const daysParam = c.req.query('days');
  const days = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 7, 1), 365) : 7;

  const summary = getTokenUsageSummary(days);
  const breakdown = getTokenUsageStats(days);

  return c.json({ summary, breakdown, days });
});

export { usage };
