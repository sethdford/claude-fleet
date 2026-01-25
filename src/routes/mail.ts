/**
 * Mail Route Handlers
 *
 * Inter-agent mail and handoff endpoints.
 */

import type { Request, Response } from 'express';
import {
  validateBody,
  sendMailSchema,
  createHandoffSchema,
} from '../validation/schemas.js';
import type { ErrorResponse } from '../types.js';
import type { RouteDependencies } from './types.js';
import { asyncHandler } from './types.js';

// ============================================================================
// MAIL HANDLERS
// ============================================================================

export function createSendMailHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(sendMailSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, to, body, subject } = validation.data;
    const mail = await deps.storage.mail.sendMail(from, to, body, subject);
    console.log(`[MAIL] ${from} -> ${to}: ${(subject ?? body).slice(0, 50)}...`);
    res.json(mail);
  });
}

export function createGetMailHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;
    const messages = await deps.storage.mail.getMail(handle);
    res.json(messages);
  });
}

export function createGetUnreadMailHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;
    const messages = await deps.storage.mail.getUnreadMail(handle);
    res.json(messages);
  });
}

export function createMarkMailReadHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const mailId = parseInt(id, 10);

    if (isNaN(mailId)) {
      res.status(400).json({ error: 'Invalid mail ID' } as ErrorResponse);
      return;
    }

    await deps.storage.mail.markMailRead(mailId);
    res.json({ success: true, id: mailId });
  });
}

// ============================================================================
// HANDOFF HANDLERS
// ============================================================================

export function createCreateHandoffHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const validation = validateBody(createHandoffSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ error: validation.error } as ErrorResponse);
      return;
    }

    const { from, to, context } = validation.data;
    const handoff = await deps.storage.mail.createHandoff(from, to, context);
    console.log(`[HANDOFF] ${from} -> ${to}`);
    res.json(handoff);
  });
}

export function createGetHandoffsHandler(deps: RouteDependencies) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { handle } = req.params;
    const handoffs = await deps.storage.mail.getHandoffs(handle, { pendingOnly: true });
    res.json(handoffs);
  });
}
