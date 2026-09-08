import type { RequestHandler } from 'express';
import type { Database } from '../db/database.js';
import { resolutionStatsQuerySchema } from '../types.js';

export function createResolutionStatsHandler(
  database: Pick<Database, 'getResolutionStats'>,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const query = resolutionStatsQuerySchema.parse(request.query);
      const stats = await database.getResolutionStats(query);
      response.status(200).json({
        data: {
          total: stats.total,
          success: { count: stats.successCount, rate: stats.successRate },
          failure: { count: stats.failureCount, rate: stats.failureRate },
          breakdown: {
            ambiguous: stats.ambiguousCount,
            failed: stats.failedCount,
          },
        },
        meta: {
          limit: query.limit,
          from: query.from?.toISOString() ?? null,
          to: query.to?.toISOString() ?? null,
          first_log_at: stats.firstLogAt?.toISOString() ?? null,
          last_log_at: stats.lastLogAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
