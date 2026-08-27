import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import Lead from '@/models/Lead';
import Call from '@/models/Call';
import Message from '@/models/Message';
import BlastCampaign from '@/models/BlastCampaign';
import LoginSession from '@/models/LoginSession';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user || !['salesperson', 'manager', 'owner', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized access.' } },
        { status: 401 }
      );
    }

    await connectDB();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Aggregate DB Metrics
    const totalLeads = await Lead.countDocuments();
    const callsToday = await Call.countDocuments({ createdAt: { $gte: startOfDay } });
    const connectedCalls = await Call.countDocuments({ createdAt: { $gte: startOfDay }, durationSeconds: { $gt: 0 } });
    const meetingsBooked = await Lead.countDocuments({ status: { $in: ['meeting-booked', 'interested'] } });
    const emailsSent = await Message.countDocuments({ channel: 'email', createdAt: { $gte: startOfDay }, status: 'sent' });
    const repliesCount = await Message.countDocuments({ channel: 'email', direction: 'inbound', createdAt: { $gte: startOfDay } });
    const runningCampaigns = await BlastCampaign.countDocuments({ status: { $in: ['queued', 'processing', 'running'] } });

    // Active Agent Sessions in last 5 minutes
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const activeAgents = await LoginSession.countDocuments({ lastHeartbeat: { $gte: fiveMinsAgo } });

    const smsSent = await Message.countDocuments({ channel: 'sms', createdAt: { $gte: startOfDay } });
    const whatsappSent = await Message.countDocuments({ channel: 'whatsapp', createdAt: { $gte: startOfDay } });

    const connectionRateNum = callsToday > 0 ? ((connectedCalls / callsToday) * 100) : 0;
    const connectionRate = connectionRateNum.toFixed(1) + '%';
    const replyRateNum = emailsSent > 0 ? ((repliesCount / emailsSent) * 100) : 0;
    const replyRate = replyRateNum.toFixed(1) + '%';

    const totalTouches = emailsSent + callsToday + smsSent + whatsappSent;

    return NextResponse.json({
      success: true,
      data: {
        totalLeads,
        callsToday,
        connectedCalls,
        connectionRate,
        meetingsBooked,
        emailsSent,
        smsSent,
        whatsappSent,
        totalTouches,
        replyRate,
        activeAgents,
        runningCampaigns
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Server error occurred.' } },
      { status: 500 }
    );
  }
}
