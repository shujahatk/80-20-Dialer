import { NextResponse } from 'next/server';
import { UserStore } from '@/lib/store';
import { checkRateLimitAsync } from '@/lib/rateLimiter';
import { validatePasswordStrength } from '@/lib/auth/passwordValidator';
import { logAuditEvent } from '@/lib/auditLogger';
export async function POST(req) {
  try {
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const rate = await checkRateLimitAsync('register_' + ip, 5, 60000);
    if (!rate.success) return rate.errorResponse;
    const { name, email, password } = await req.json();
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.includes('@')) return NextResponse.json({ success: false, message: 'Name and email are required.' }, { status: 400 });
    const validation = validatePasswordStrength(password);
    if (!validation.valid) return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
    if (await UserStore.findOne({ email })) return NextResponse.json({ success: false, message: 'An account with this email already exists.' }, { status: 409 });
    // First owner selection is serialized in PostgreSQL; public registration never accepts privileged roles.
    const user = await UserStore.register({ name, email, password });
    await logAuditEvent({ userId: user.id, action: 'USER_REGISTERED', entityType: 'auth', notes: user.email, req });
    return NextResponse.json({ success: true, message: user.approved ? 'Owner account created and approved.' : 'Account registered. Administrator approval is required.',
      data: { _id: user.id, name: user.name, email: user.email, role: user.role, approved: user.approved, createdAt: user.createdAt } }, { status: 201 });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
