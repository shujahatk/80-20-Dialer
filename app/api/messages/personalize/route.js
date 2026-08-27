import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { LeadStore } from '@/lib/store';
import { generatePersonalizedMessage } from '@/lib/aiService';

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { leadId, basePrompt, tone, channel } = body;

    if (!leadId) {
      return NextResponse.json(
        { success: false, message: 'leadId parameter is required.' },
        { status: 400 }
      );
    }

    await connectDB();

    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    const generatedBody = await generatePersonalizedMessage({
      lead,
      basePrompt,
      tone: tone || 'professional',
      channel: channel || 'email',
    });

    return NextResponse.json({
      success: true,
      data: {
        body: generatedBody,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to personalize message.' },
      { status: 500 }
    );
  }
}
