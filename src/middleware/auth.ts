/**
 * JWT Authentication Middleware
 *
 * Verifies JWT tokens on protected routes and attaches decoded user info to request.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedUser {
  uid: string;
  handle: string;
  teamName: string;
  agentType: 'team-lead' | 'worker';
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Routes that don't require authentication
 */
const PUBLIC_ROUTES = new Set([
  '/health',
  '/metrics',
  '/debug',
  '/auth', // Auth endpoint for joining teams
]);

/**
 * Route prefixes that don't require authentication
 */
const PUBLIC_PREFIXES = [
  '/public/',
];

/**
 * Check if a route is public (no auth required)
 */
function isPublicRoute(path: string): boolean {
  // Exact matches
  if (PUBLIC_ROUTES.has(path)) {
    return true;
  }

  // Prefix matches
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Creates JWT authentication middleware
 *
 * @param jwtSecret - Secret used to verify tokens
 * @returns Express middleware function
 */
export function createAuthMiddleware(jwtSecret: string) {
  return function authenticateToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // Skip auth for public routes
    if (isPublicRoute(req.path)) {
      return next();
    }

    // Extract token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1]; // "Bearer <token>"

    if (!token) {
      res.status(401).json({
        error: 'Authentication required',
        hint: 'Include Authorization header with Bearer token',
      });
      return;
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as AuthenticatedUser;

      // Validate decoded token structure
      if (!decoded.uid || !decoded.handle || !decoded.teamName) {
        res.status(403).json({
          error: 'Invalid token structure',
        });
        return;
      }

      // Attach user to request
      (req as AuthenticatedRequest).user = decoded;
      next();
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        res.status(401).json({
          error: 'Token expired',
          hint: 'Re-authenticate via POST /auth',
        });
      } else if (err instanceof jwt.JsonWebTokenError) {
        res.status(403).json({
          error: 'Invalid token',
        });
      } else {
        res.status(500).json({
          error: 'Authentication error',
        });
      }
    }
  };
}

/**
 * Optional auth middleware - extracts user if token present but doesn't require it
 */
export function createOptionalAuthMiddleware(jwtSecret: string) {
  return function optionalAuth(
    req: Request,
    _res: Response,
    next: NextFunction
  ): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, jwtSecret) as AuthenticatedUser;
        (req as AuthenticatedRequest).user = decoded;
      } catch {
        // Token invalid but that's OK for optional auth
      }
    }

    next();
  };
}

/**
 * Role-based authorization middleware
 * Must be used after authenticateToken middleware
 */
export function requireRole(...roles: Array<'team-lead' | 'worker'>) {
  return function checkRole(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(authReq.user.agentType)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: authReq.user.agentType,
      });
      return;
    }

    next();
  };
}

/**
 * Team membership check middleware
 * Ensures user belongs to the team specified in route params
 */
export function requireTeamMembership() {
  return function checkTeam(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const authReq = req as AuthenticatedRequest;
    const teamName = req.params.teamName;

    if (!authReq.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (teamName && authReq.user.teamName !== teamName) {
      res.status(403).json({
        error: 'Not a member of this team',
        team: teamName,
      });
      return;
    }

    next();
  };
}
