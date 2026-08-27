import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { UserStore } from '@/lib/store';

export async function POST(req) {
  try {
    await connectDB();
    const body = await req.json();
    const { name, email, password, role } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, message: 'Please provide name, email, and password.' },
        { status: 400 }
      );
    }

    if (role && !['owner', 'manager', 'salesperson', 'admin'].includes(role)) {
      return NextResponse.json(
        { success: false, message: 'Invalid role. Must be one of: owner, manager, salesperson, admin.' },
        { status: 400 }
      );
    }

    const userExists = await UserStore.findOne({ email: email.toLowerCase() });
    if (userExists) {
      return NextResponse.json(
        { success: false, message: 'An account with this email already exists. Please sign in.' },
        { status: 400 }
      );
    }

    // Auto-approve first user as owner
    const allUsers = await UserStore.findAllUsers();
    const isFirstUser = allUsers.length === 0;

    const user = await UserStore.create({
      name,
      email: email.toLowerCase(),
      password,
      role: isFirstUser ? 'owner' : (role || 'salesperson'),
      approved: isFirstUser
    });

    return NextResponse.json(
      {
        success: true,
        message: isFirstUser 
          ? 'First account created and approved as Owner.'
          : 'Account created successfully. Please wait for manager approval.',
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          approved: user.approved,
          createdAt: user.createdAt
        }
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
