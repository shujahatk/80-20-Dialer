import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Call from '@/models/Call';
import Message from '@/models/Message';
import Lead from '@/models/Lead';
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

    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Fetch all sales agents
    const agents = await User.find({ role: 'salesperson', active: true }).lean();

    const leaderboard = [];

    for (const sp of agents) {
      const spId = sp._id;

      const callsToday = await Call.countDocuments({ userId: spId, createdAt: { $gte: startOfDay } });
      const connectedCalls = await Call.countDocuments({ userId: spId, createdAt: { $gte: startOfDay }, durationSeconds: { $gt: 0 } });
      const booked = await Lead.countDocuments({ assignedTo: spId, status: { $in: ['meeting-booked', 'interested'] } });
      const emailsSent = await Message.countDocuments({ userId: spId, channel: 'email', createdAt: { $gte: startOfDay }, status: 'sent' });
      const repliesCount = await Message.countDocuments({ userId: spId, channel: 'email', direction: 'inbound', createdAt: { $gte: startOfDay } });

      const replyRateNum = emailsSent > 0 ? ((repliesCount / emailsSent) * 100) : 0;
      const replyRate = replyRateNum.toFixed(1) + '%';

      const activeSession = await LoginSession.findOne({ userId: spId, lastHeartbeat: { $gte: fiveMinsAgo } }).lean();

      leaderboard.push({
        _id: spId.toString(),
        name: sp.name,
        email: sp.email,
        callsToday,
        connectedCalls,
        booked,
        emailsSent,
        replyRate,
        isOnline: Boolean(activeSession)
      });
    }

    // Sort descending by callsToday, then connectedCalls, then booked
    leaderboard.sort((a, b) => b.callsToday - a.callsToday || b.connectedCalls - a.connectedCalls || b.booked - a.booked);

    return NextResponse.json({
      success: true,
      data: leaderboard
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { code: 'SERVER_ERROR', message: err.message || 'Failed to generate leaderboard.' } },
      { status: 500 }
    );
  }
}
