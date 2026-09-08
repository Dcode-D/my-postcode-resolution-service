import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export const requestErrorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  request.log.error({ err: error }, 'Request failed');
  if (error instanceof ZodError) {
    response
      .status(400)
      .json({ status: 'FAILED', error: 'Invalid request payload', details: error.flatten() });
    return;
  }
  response.status(500).json({ status: 'FAILED', error: 'Internal server error' });
};
