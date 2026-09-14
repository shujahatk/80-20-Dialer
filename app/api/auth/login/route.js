import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { UserStore, LoginSessionStore } from '@/lib/store';
import { generateToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimiter';
import { logAuditEvent } from '@/lib/auditLogger';

export async function POST(req) {
  try {
    await connectDB();
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Please enter both email and password.' },
        { status: 400 }
      );
    }

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const emailKey = email.toLowerCase().trim();
    const rateLimitKey = `${emailKey}_${ip}`;

    // Brute-force protection: 5 failed attempts in 10 mins -> 15 min lockout
    const { checkLoginRateLimit, recordFailedLogin, clearLoginRateLimit } = await import('@/lib/middleware/rateLimiter.js');
    const rateCheck = checkLoginRateLimit(rateLimitKey);
    if (!rateCheck.allowed) return rateCheck.errorResponse;

    const user = await UserStore.findOne({ email: emailKey });
    if (!user) {
      recordFailedLogin(rateLimitKey);
      return NextResponse.json(
        { success: false, message: 'No account found with this email. Please register first.' },
        { status: 401 }
      );
    }

    const isMatch = await UserStore.matchPassword(password, user.password);
    if (!isMatch) {
      recordFailedLogin(rateLimitKey);
      await logAuditEvent({ userId: user._id, action: 'USER_LOGIN_FAILED', entityType: 'auth', notes: 'Incorrect password', req });
      return NextResponse.json(
        { success: false, message: 'Incorrect password. Access denied.' },
        { status: 401 }
      );
    }

    // Clear failed attempt history upon successful credentials validation
    clearLoginRateLimit(rateLimitKey);

    if (!user.approved) {
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
    const tokens = generateAuthTokens(user);

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
