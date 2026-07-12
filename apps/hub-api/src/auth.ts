import type { Request, Response, NextFunction } from 'express';

/**
 * Rejects requests without the shared key. NOT real auth (the key is embedded
 * in the SPA bundle, see spec §2.4) — a light deterrent. If API_KEY is unset
 * (dev), it does not block.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY;
  if (!expected) return next();
  if (req.header('x-api-key') === expected) return next();
  res.status(401).json({ error: 'unauthorized' });
}
