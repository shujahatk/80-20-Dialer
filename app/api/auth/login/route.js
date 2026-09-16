import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { UserStore, LoginSessionStore } from '@/lib/store';
import { generateToken } from '@/lib/auth';
import { logAuditEvent } from '@/lib/auditLogger';
import { parseAndSanitizeJson } from '@/lib/security/inputSanitizer';
import { checkAuthRateLimit, recordFailedAuth, clearAuthRateLimit, extractClientIp } from '@/lib/middleware/rateLimiter';

export async function POST(req) {
  try {
    await connectDB();
    
    // Parse and sanitize payload with 1MB size limit
    const parsed = await parseAndSanitizeJson(req, {
      requiredFields: ['email', 'password']
    });
    if (!parsed.success) return parsed.errorResponse;

    const { email, password } = parsed.data;
    const ip = extractClientIp(req);
    const emailKey = email.toLowerCase().trim();

    // Brute-force protection: 5 attempts per 15 minutes
    const rateCheck = checkAuthRateLimit(req, emailKey, 'login', 5);
    if (!rateCheck.allowed) return rateCheck.errorResponse;

    const user = await UserStore.findOne({ email: emailKey });
    if (!user) {
      recordFailedAuth(req, emailKey, 'login');
      return NextResponse.json(
        { success: false, message: 'No account found with this email. Please register first.' },
        { status: 401 }
      );
    }

    const isMatch = await UserStore.matchPassword(password, user.password);
    if (!isMatch) {
      recordFailedAuth(req, emailKey, 'login');
      await logAuditEvent({ userId: user._id, action: 'USER_LOGIN_FAILED', entityType: 'auth', notes: 'Incorrect password', req });
      return NextResponse.json(
        { success: false, message: 'Incorrect password. Access denied.' },
        { status: 401 }
      );
    }

    // Clear failed attempt history upon successful credentials validation
    clearAuthRateLimit(req, emailKey, 'login');

    if (!user.approved || user.active === false) {
      return NextResponse.json(
        { success: false, message: 'Your account is pending manager approval. Please wait.' },
        { status: 403 }
      );
    }

    await UserStore.updateLastLogin(user._id);
    await logAuditEvent({ userId: user._id, action: 'USER_LOGIN_SUCCESS', entityType: 'auth', notes: `User logged in with role ${user.role}`, req });

    // Initialize daily session log for salespeople
    if (user.role === 'salesperson') {
      const today = new Date().toISOString().slice(0, 10);
      const session = await LoginSessionStore.findToday(user._id);
      if (!session) {
        await LoginSessionStore.create({
          userId: user._id,
          date: today,
          activeTimeSeconds: 0,
          dialingTimeSeconds: 0,
          breakTimeSeconds: 0,
          isOnBreak: false
        });
      }
    }

    const { generateAuthTokens } = await import('@/lib/auth/tokenManager.js');
    const tokens = await generateAuthTokens(user);

    const response = NextResponse.json({
      success: true,
      message: 'Login successful.',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn
      }
    });

    response.cookies.set('auth_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60
    });

    response.cookies.set('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
