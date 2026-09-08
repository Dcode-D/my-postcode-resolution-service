import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import type { AppConfig } from './config.js';
import type { Database } from './db/database.js';
import {
  createHealthHandler,
  createResolutionLogsHandler,
  createResolutionStatsHandler,
  createResolvePostcodeHandler,
  openApiDocumentHandler,
  swaggerUiHandler,
} from './handlers/index.js';
import { createLogAccessMiddleware } from './middleware/log-access.js';
import { requestErrorHandler } from './middleware/request-error-handler.js';
import type { ResolutionService } from './services/resolution-service.js';

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

  const requireLogAccess = createLogAccessMiddleware(config.LOGS_API_KEY);
  app.get('/docs', swaggerUiHandler);
  app.get('/openapi.json', openApiDocumentHandler);
  app.get('/health', createHealthHandler(database));
  app.post('/v1/postcode/resolve', createResolvePostcodeHandler(resolutionService));
  app.get('/v1/resolution-logs', requireLogAccess, createResolutionLogsHandler(database));
  app.get('/v1/resolution-stats', requireLogAccess, createResolutionStatsHandler(database));
  app.use(requestErrorHandler);
  return app;
}
