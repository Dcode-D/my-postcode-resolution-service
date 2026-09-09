import type { RequestHandler } from 'express';
import { NoProviderConfiguredError } from '../providers/index.js';
import type { ResolutionService } from '../services/resolution-service.js';

export function createReloadConfigHandler(
  resolutionService: Pick<ResolutionService, 'reloadConfiguration'>,
): RequestHandler {
  return async (_request, response, next) => {
    try {
      const result = await resolutionService.reloadConfiguration();
      response.status(200).json({
        status: 'ok',
        reloaded_at: result.reloadedAt,
        providers: result.providers,
      });
    } catch (error) {
      if (error instanceof NoProviderConfiguredError) {
        response.status(503).json({
          status: 'FAILED',
          error: 'No usable AI provider is configured',
        });
        return;
      }
      next(error);
    }
  };
}
