import type { RequestHandler } from 'express';
import type { Database } from '../db/database.js';
import { toResolutionResponseInput } from '../mappers/resolution-response-mapper.js';
import { resolutionLogQuerySchema } from '../types.js';

export function createResolutionLogsHandler(
  database: Pick<Database, 'listResolutionLogs'>,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const query = resolutionLogQuerySchema.parse(request.query);
      const logs = await database.listResolutionLogs(query);
      response.status(200).json({
        data: logs.map((log) => ({
          ...log,
          result: toResolutionResponseInput(log.result),
        })),
        meta: {
          count: logs.length,
          limit: query.limit,
          from: query.from?.toISOString() ?? null,
          to: query.to?.toISOString() ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
