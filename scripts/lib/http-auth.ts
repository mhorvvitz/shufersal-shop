import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Constant-time compare that also hides length differences: hash both sides to a
// fixed 32 bytes first, so timingSafeEqual never sees mismatched lengths (which it
// rejects) and an attacker can't learn the token length from response timing.
function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function unauthorized(res: Response): void {
  res
    .status(401)
    .json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
}

/**
 * Express middleware enforcing a static `Authorization: Bearer <token>` on every
 * request. Sufficient for a single-owner server whose clients (the Telegram bot,
 * `claude mcp add --transport http --header`) all hold the same shared secret.
 * (claude.ai custom connectors require full OAuth — not covered here.)
 */
export function bearerAuth(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : '';
    if (!token || !safeEqual(token, expectedToken)) {
      unauthorized(res);
      return;
    }
    next();
  };
}
