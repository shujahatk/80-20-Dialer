import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { ActivityLogStore, UserStore } from '@/lib/store';
import { isMongoConnected } from '@/lib/db';
import ActivityLog from '@/models/ActivityLog';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit')) || 50;

    let logs = [];

    if (user.role === 'salesperson') {
      logs = await ActivityLogStore.findByUser(user._id, limit);
    } else {
      if (isMongoConnected()) {
        logs = await ActivityLog.find()
          .sort({ timestamp: -1 })
          .limit(limit)
          .populate('userId', 'name')
          .lean();
      } else {
        const users = await UserStore.findAllUsers();
        const allLogs = [];
        for (const u of users) {
          const userLogs = await ActivityLogStore.findByUser(u._id, limit);
          const mappedLogs = userLogs.map(l => ({
            ...l,
            userId: { _id: u._id, name: u.name }
          }));
          allLogs.push(...mappedLogs);
        }
        logs = allLogs
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, limit);
      }
    }

    return NextResponse.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
