import type { RequestHandler } from 'express';
import type { Database } from '../db/database.js';

export function createHealthHandler(
  database: Pick<Database, 'healthcheck'>,
): RequestHandler {
  return async (_request, response, next) => {
    try {
      await database.healthcheck();
      response.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  };
}
