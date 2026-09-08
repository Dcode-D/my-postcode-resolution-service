import type { RequestHandler } from 'express';
import type { ResolutionService } from '../services/resolution-service.js';
import { resolutionRequestSchema } from '../types.js';

export function createResolvePostcodeHandler(
  resolutionService: Pick<ResolutionService, 'resolve'>,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const payload = resolutionRequestSchema.parse(request.body);
      const result = await resolutionService.resolve(payload);
      response.status(result.status === 'FAILED' ? 502 : 200).json(result);
    } catch (error) {
      next(error);
    }
  };
}
