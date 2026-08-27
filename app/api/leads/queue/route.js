import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LeadStore, SystemConfigStore } from '@/lib/store';

function isWithinContactHours(timezone, startHour, endHour) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      hour12: false
    });
    const hour = parseInt(formatter.format(now), 10);
    return hour >= startHour && hour < endHour;
  } catch {
    return true; // default true if timezone parse fails
  }
}

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const config = await SystemConfigStore.getConfig();
    const startHour = config.allowedHoursStart ?? 8;
    const endHour = config.allowedHoursEnd ?? 18;

    const queue = await LeadStore.findDailyQueue(user._id);

    const checkLeadHours = (lead) => {
      const timezone = lead.geography?.timezone || 'UTC';
      const allowed = isWithinContactHours(timezone, startHour, endHour);
      return {
        ...lead,
        outOfHours: !allowed
      };
    };

    const replies = (queue.replies || []).map(checkLeadHours);
    const overdue = (queue.overdue || []).map(checkLeadHours);
    const dueToday = (queue.dueToday || []).map(checkLeadHours);
    const interested = (queue.interested || []).map(checkLeadHours);
    const newLeads = (queue.newLeads || []).map(checkLeadHours);

    // Merge into single prioritized feed for the dialer
    // Order: Overdue callbacks -> Due today callbacks -> Incoming replies -> Interested follow-up -> New leads
    const sortedList = [];
    sortedList.push(...overdue);
    sortedList.push(...dueToday);
    sortedList.push(...replies);
    sortedList.push(...interested);
    sortedList.push(...newLeads);

    return NextResponse.json({
      success: true,
      data: {
        categories: {
          overdue,
          dueToday,
          replies,
          interested,
          newLeads
        },
        sortedList,
        config: {
          allowedHoursStart: startHour,
          allowedHoursEnd: endHour
        }
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
