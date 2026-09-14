import { NextResponse } from 'next/server.js';
import { verifyAuth } from '../auth.js';

function createJsonResponse(data, status = 200) {
  try {
    return NextResponse.json(data, { status });
  } catch (e) {
    return { status, json: () => data, ...data };
  }
}

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  OWNER: 'owner',
  SALESPERSON: 'salesperson',
  USER: 'user',
  UPDATER_ONLY: 'updater_only'
};

export function normalizeRole(role) {
  if (!role) return ROLES.SALESPERSON;
  const r = String(role).toLowerCase().trim();
  if (['owner', 'manager', 'admin'].includes(r)) return ROLES.ADMIN;
  if (['updater_only', 'updater', 'triage'].includes(r)) return ROLES.UPDATER_ONLY;
  return ROLES.SALESPERSON;
}

export function isManagerOrAdmin(user) {
  if (!user) return false;
  const r = String(user.role || '').toLowerCase().trim();
  return ['owner', 'manager', 'admin'].includes(r);
}

export async function requireAuth(req, allowedRoles = []) {
  const user = await verifyAuth(req);
  if (!user) {
    return {
      errorResponse: createJsonResponse(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' } },
        401
      )
    };
  }

  if (user.approved === false || user.active === false) {
    return {
      errorResponse: createJsonResponse(
        { success: false, error: { code: 'ACCOUNT_PENDING', message: 'Account is pending manager approval or disabled.' } },
        403
      )
    };
  }

  if (allowedRoles.length > 0) {
    const userRole = normalizeRole(user.role);
    const normalizedAllowed = allowedRoles.map(normalizeRole);
    const hasDirectMatch = allowedRoles.includes(user.role);
    const hasNormalizedMatch = normalizedAllowed.includes(userRole);

    if (!hasDirectMatch && !hasNormalizedMatch) {
      return {
        errorResponse: createJsonResponse(
          { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden. Access denied for your role.' } },
          403
        )
      };
    }
  }

  return { user, errorResponse: null };
}

export async function requireRole(req, ...allowedRoles) {
  return await requireAuth(req, allowedRoles);
}

export async function requireRoles(...allowedRoles) {
  return async (req) => await requireAuth(req, allowedRoles);
}

export async function requireManager(req) {
  return await requireAuth(req, ['owner', 'manager', 'admin', ROLES.ADMIN]);
}

export async function requireManagerOrAdmin(req) {
  return await requireManager(req);
}

export async function requireAdminOrOwner(req) {
  return await requireManager(req);
}

/**
 * IDOR Protection Helpers:
 */

export function canAccessResource(user, resourceOwnerId) {
  if (!user) return false;
  if (isManagerOrAdmin(user) || normalizeRole(user.role) === ROLES.UPDATER_ONLY) return true;
  if (!resourceOwnerId) return true; // Unassigned pool leads are accessible
  const ownerStr = String(resourceOwnerId).trim().toLowerCase();
  const uId = user._id ? String(user._id).trim().toLowerCase() : '';
  const uUuid = user.id ? String(user.id).trim().toLowerCase() : '';
  const uEmail = user.email ? String(user.email).trim().toLowerCase() : '';
  return ownerStr === uId || ownerStr === uUuid || ownerStr === uEmail;
}

export function assertLeadAccess(user, lead) {
  if (!user) return false;
  if (isManagerOrAdmin(user)) return true;
  if (!lead) return false;
  const assigned = lead.assignedTo || lead.assigned_to || lead.userId || lead.user_id;
  if (!assigned) return true; // Pool/unassigned lead
  return canAccessResource(user, assigned);
}

export function assertDraftAccess(user, draft) {
  if (!user) return false;
  if (isManagerOrAdmin(user)) return true;
  if (!draft) return false;
  const draftOwner = draft.userId || draft.user_id || draft.createdBy || draft.created_by;
  if (!draftOwner) return true;
  return canAccessResource(user, draftOwner);
}

export function assertCampaignAccess(user, campaign) {
  if (!user) return false;
  if (isManagerOrAdmin(user)) return true;
  if (!campaign) return false;
  const creator = campaign.createdBy || campaign.created_by || campaign.userId || campaign.user_id;
  if (!creator) return true;
  return canAccessResource(user, creator);
}

export function assertStatsAccess(user, targetUserId) {
  if (!user) return false;
  if (isManagerOrAdmin(user)) return true;
  if (!targetUserId) return true;
  return canAccessResource(user, targetUserId);
}
