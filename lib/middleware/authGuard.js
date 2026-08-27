import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';

/**
 * Authenticates request and verifies user role.
 * If user is unauthenticated, returns 401.
 * If user does not have an allowed role, returns 403.
 * Returns { user } on success, or { response } on failure.
 */
export async function requireAuth(req, allowedRoles = []) {
  const user = await verifyAuth(req);
  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
        { status: 401 }
      )
    };
  }

  if (user.approved === false || user.active === false) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: { code: 'ACCOUNT_DISABLED', message: 'Account is pending approval or disabled.' } },
        { status: 403 }
      )
    };
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Access denied for this role.' } },
        { status: 403 }
      )
    };
  }

  return { user };
}

/**
 * Verifies if user owns or is authorized to access a resource.
 * Owner, Admin, and Manager can access any resource; Salesperson can only access resources they own/are assigned to.
 */
export function canAccessResource(user, resourceOwnerId) {
  if (!user) return false;
  if (['owner', 'admin', 'manager'].includes(user.role)) return true;
  if (!resourceOwnerId) return false;
  return user._id.toString() === resourceOwnerId.toString();
}
