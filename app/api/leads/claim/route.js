import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LeadStore } from '@/lib/store';

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const lead = await LeadStore.claimNextLead(user._id);

    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'No unassigned leads available in the pool.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Lead successfully claimed.',
      data: lead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
