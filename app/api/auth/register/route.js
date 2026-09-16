import { NextResponse } from 'next/server';
import { UserStore } from '@/lib/store';
import { validatePasswordStrength } from '@/lib/auth/passwordValidator';
import { logAuditEvent } from '@/lib/auditLogger';
import { parseAndSanitizeJson } from '@/lib/security/inputSanitizer';
import { checkAuthRateLimit, recordFailedAuth, clearAuthRateLimit } from '@/lib/middleware/rateLimiter';

export async function POST(req) {
  try {
    // 5 attempts per 15 minutes limit on registration
    const rate = checkAuthRateLimit(req, '', 'register', 5);
    if (!rate.allowed) return rate.errorResponse;

    const parsed = await parseAndSanitizeJson(req, {
      requiredFields: ['name', 'email', 'password']
    });
    if (!parsed.success) return parsed.errorResponse;

    const { name, email, password } = parsed.data;

    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.includes('@')) {
      recordFailedAuth(req, '', 'register');
      return NextResponse.json({ success: false, message: 'Valid name and email are required.' }, { status: 400 });
    }

    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      recordFailedAuth(req, '', 'register');
      return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
    }

    if (await UserStore.findOne({ email })) {
      recordFailedAuth(req, '', 'register');
      return NextResponse.json({ success: false, message: 'An account with this email already exists.' }, { status: 409 });
    }

    // First owner selection is serialized in PostgreSQL; public registration never accepts privileged roles.
    const user = await UserStore.register({ name, email, password });
    clearAuthRateLimit(req, '', 'register');

    await logAuditEvent({ userId: user.id, action: 'USER_REGISTERED', entityType: 'auth', notes: user.email, req });

    return NextResponse.json({
      success: true,
      message: user.approved ? 'Owner account created and approved.' : 'Account registered. Administrator approval is required.',
      data: { _id: user.id, name: user.name, email: user.email, role: user.role, approved: user.approved, createdAt: user.createdAt }
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
