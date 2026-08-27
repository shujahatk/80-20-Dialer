import { NextResponse } from 'next/server';
import { UserStore, LeadStore, LoginSessionStore, SendingInboxStore } from '@/lib/store';
import { connectDB } from '@/lib/db';

export async function GET() {
  try {
    await connectDB();
    const results = [];

    // 1. Test Inboxes
    const inbox = await SendingInboxStore.createInbox({
      name: 'Integration Test Inbox',
      fromEmail: 'outreach@testdomain.com',
      fromName: 'Test Representative',
      dailyLimit: 25
    });
    results.push(`Created inbox: ${inbox.name}, Limit: ${inbox.dailyLimit}`);

    const inboxes = await SendingInboxStore.findAllInboxes();
    results.push(`Found inboxes count: ${inboxes.length}`);

    await SendingInboxStore.incrementInboxUsage(inbox._id);
    const updatedInbox = await SendingInboxStore.findInboxById(inbox._id);
    results.push(`Inbox emails sent today: ${updatedInbox.emailsSentToday}`);

    // 2. Test break toggle
    const testEmail = `smith_${Date.now()}@test.com`;
    const user = await UserStore.create({
      name: 'Agent Smith',
      email: testEmail,
      password: 'password123',
      role: 'salesperson',
      approved: true
    });
    results.push(`Created test user: ${user.name}, ID: ${user._id}`);

    const break1 = await LoginSessionStore.toggleBreak(user._id);
    results.push(`Toggled break 1 (should be on break): ${break1.isOnBreak}`);

    const break2 = await LoginSessionStore.toggleBreak(user._id);
    results.push(`Toggled break 2 (should be off break): ${break2.isOnBreak}, Break seconds: ${break2.breakTimeSeconds}`);

    // 3. Test Daily Queue replies
    const lead = await LeadStore.create({
      userId: user._id,
      contact: { name: 'Prospect Jane', phone: '+1234567890', email: 'jane@example.com' },
      status: 'new',
      hasUnansweredReply: true,
      lastReplyText: 'Yes, please call me back tomorrow!',
      lastReplyChannel: 'sms',
      lastReplyAt: new Date()
    });

    const queue = await LeadStore.findDailyQueue(user._id);
    results.push(`Daily queue replies count: ${queue.replies.length}`);
    if (queue.replies.length > 0) {
      results.push(`First reply text: "${queue.replies[0].lastReplyText}", Channel: ${queue.replies[0].lastReplyChannel}`);
    }

    // Cleanup test data to prevent bloat
    await UserStore.rejectUser(user._id);
    await LeadStore.delete(lead._id);
    if (inbox._id) {
      await SendingInboxStore.deleteInbox(inbox._id);
    }

    return NextResponse.json({
      success: true,
      message: 'All store tests passed successfully!',
      results
    });
  } catch (err) {
    console.error('[API Test Error]', err);
    return NextResponse.json({
      success: false,
      message: 'Integration test failed.',
      error: err.message
    }, { status: 500 });
  }
}
