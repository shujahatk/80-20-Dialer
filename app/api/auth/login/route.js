import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { UserStore, LoginSessionStore } from '@/lib/store';
import { generateToken } from '@/lib/auth';

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

    const user = await UserStore.findOne({ email: email.toLowerCase() });
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'No account found with this email. Please register first.' },
        { status: 401 }
      );
    }

    const isMatch = await UserStore.matchPassword(password, user.password);
    if (!isMatch) {
      return NextResponse.json(
        { success: false, message: 'Incorrect password. Access denied.' },
        { status: 401 }
      );
    }

    if (!user.approved) {
      return NextResponse.json(
        { success: false, message: 'Your account is pending manager approval. Please wait.' },
        { status: 403 }
      );
    }

    await UserStore.updateLastLogin(user._id);

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

    const token = generateToken(user._id);

    return NextResponse.json({
      success: true,
      message: 'Login successful.',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
