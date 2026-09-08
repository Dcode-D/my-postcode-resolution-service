import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { Database } from './db/database.js';
import type { ResolutionService } from './services/resolution-service.js';
import {
  resolutionLogQuerySchema,
  resolutionRequestSchema,
  resolutionStatsQuerySchema,
} from './types.js';

function matchesApiKey(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createApp(
  config: AppConfig,
  database: Database,
  resolutionService: ResolutionService,
) {
  const logger = pino({ level: config.NODE_ENV === 'production' ? 'info' : 'debug' });
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '20kb' }));
  app.use(
    pinoHttp({
      logger,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["postman-token"]',
        'req.body.phone',
      ],
    }),
  );

  const requireLogAccess: RequestHandler = (request, response, next) => {
    if (!config.LOGS_API_KEY) {
      response.status(503).json({ status: 'FAILED', error: 'Log endpoint is not configured' });
      return;
    }
    if (!matchesApiKey(request.header('x-api-key'), config.LOGS_API_KEY)) {
      response.status(401).json({ status: 'FAILED', error: 'Unauthorized' });
      return;
    }
    next();
  };

  app.get('/health', async (_request, response, next) => {
    try {
      await database.healthcheck();
      response.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/postcode/resolve', async (request, response, next) => {
    try {
      const payload = resolutionRequestSchema.parse(request.body);
      const result = await resolutionService.resolve(payload);
      response.status(result.status === 'FAILED' ? 502 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/resolution-logs', requireLogAccess, async (request, response, next) => {
    try {
      const query = resolutionLogQuerySchema.parse(request.query);
      const logs = await database.listResolutionLogs(query);
      response.status(200).json({
        data: logs,
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
  });

  app.get('/v1/resolution-stats', requireLogAccess, async (request, response, next) => {
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
  });

  const errorHandler: ErrorRequestHandler = (error, request, response) => {
    request.log.error({ err: error }, 'Request failed');
    if (error instanceof ZodError) {
      response
        .status(400)
        .json({ status: 'FAILED', error: 'Invalid request payload', details: error.flatten() });
      return;
    }
    response.status(500).json({ status: 'FAILED', error: 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}
