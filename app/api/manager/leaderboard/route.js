import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { UserStore, CallStore, MessageStore, LeadStore, ActivityLogStore } from '@/lib/store';

export async function GET(req) {
  try {
    const auth = await requireManager(req);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }
    const user = auth.user;

    const users = await UserStore.findAllUsers();
    const salespeople = users.filter(u => u.role === 'salesperson' && u.approved !== false);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const leaderboard = await Promise.all(salespeople.map(async (sp) => {
      const spId = String(sp._id || sp.id);
      const userStats = await ActivityLogStore.getUserStats(spId).catch(() => ({
        callsToday: 0,
        emailsToday: 0,
        smsToday: 0,
        whatsappToday: 0,
        talkTimeToday: 0
      }));

      // Find user calls from CallStore
      const userCalls = await CallStore.findByUserId(spId).catch(() => []);
      const todayCalls = userCalls.filter(c => {
        const cDate = new Date(c.createdAt || c.created_at || c.startTime || 0);
        return cDate >= startOfDay;
      });

      const callsCount = Math.max(userStats.callsToday || 0, todayCalls.length);
      const connectedCalls = todayCalls.filter(c => 
        (c.duration && c.duration > 0) || 
        ['completed', 'answered', 'in-progress'].includes(c.status)
      ).length;

      // Find user emails from MessageStore
      const userMessages = await MessageStore.findByUserId(spId).catch(() => []);
      const todayEmails = userMessages.filter(m => {
        const mDate = new Date(m.createdAt || m.created_at || 0);
        return m.channel === 'email' && mDate >= startOfDay;
      });
      const emailsSent = Math.max(userStats.emailsToday || 0, todayEmails.length);

      // Find booked/interested leads for this rep
      const managerMetrics = await LeadStore.getManagerMetrics(spId).catch(() => ({ booked: 0, interested: 0 }));
      const bookedCount = (managerMetrics.booked || 0) + (managerMetrics.interested || 0);

      const lastActiveTime = sp.lastActive || sp.last_active;
      const isOnline = Boolean(lastActiveTime && (Date.now() - new Date(lastActiveTime).getTime() < 5 * 60 * 1000));

      const replyRate = emailsSent > 0 
        ? `${((bookedCount / emailsSent) * 100).toFixed(1)}%` 
        : '0.0%';

      return {
        _id: spId,
        name: sp.name,
        email: sp.email,
        callsToday: callsCount,
        connectedCalls,
        booked: bookedCount,
        emailsSent,
        smsSent: userStats.smsToday || 0,
        whatsappSent: userStats.whatsappToday || 0,
        talkTimeSeconds: userStats.talkTimeToday || 0,
        replyRate,
        isOnline,
        status: isOnline ? 'Available' : 'Offline'
      };
    }));

    // Sort leaderboard by most active sales reps (booked desc, calls desc, emails desc)
    leaderboard.sort((a, b) => (b.booked - a.booked) || (b.callsToday - a.callsToday) || (b.emailsSent - a.emailsSent));

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
