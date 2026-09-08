import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

function matchesApiKey(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createLogAccessMiddleware(apiKey: string | undefined): RequestHandler {
  return (request, response, next) => {
    if (!apiKey) {
      response.status(503).json({ status: 'FAILED', error: 'Log endpoint is not configured' });
      return;
    }
    if (!matchesApiKey(request.header('x-api-key'), apiKey)) {
      response.status(401).json({ status: 'FAILED', error: 'Unauthorized' });
      return;
    }
    next();
  };
}
