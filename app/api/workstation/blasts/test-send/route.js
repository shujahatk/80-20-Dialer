import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/authGuard';
import { sendEmail } from '@/lib/emailService';
import { generatePersonalizedMessage } from '@/lib/aiService';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const body = await req.json();
    const { testEmail, subject, templateBody, useAiPersonalization, tone } = body;

    if (!testEmail || !testEmail.includes('@')) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid test email recipient is required.' } },
        { status: 400 }
      );
    }

    if (!subject || !templateBody) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Subject and body template are required.' } },
        { status: 400 }
      );
    }

    let finalBody = templateBody;
    const sampleLead = {
      contact: { name: 'Test User', email: testEmail },
      company: { name: 'Acme Corp' }
    };

    if (useAiPersonalization) {
      try {
        finalBody = await generatePersonalizedMessage({
          lead: sampleLead,
          basePrompt: templateBody,
          tone: tone || 'professional',
          channel: 'email'
        });
      } catch (e) {
        finalBody = templateBody.replace(/{{firstName}}/g, 'Test User').replace(/{{company}}/g, 'Acme Corp');
      }
    } else {
      finalBody = templateBody.replace(/{{firstName}}/g, 'Test User').replace(/{{company}}/g, 'Acme Corp');
    }

    const result = await sendEmail({
      to: testEmail,
      subject: `[TEST BLAST] ${subject.replace(/{{firstName}}/g, 'Test User').replace(/{{company}}/g, 'Acme Corp')}`,
      html: finalBody,
      fromName: user.name || '80/20 Outbound Test',
      fromEmail: user.email || 'onboarding@resend.dev'
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { code: 'SEND_FAILED', message: result.error || 'Failed to dispatch test email.' } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Test email successfully dispatched to ${testEmail}`
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Error executing test send.' } },
      { status: 500 }
    );
  }
}
