import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { LeadStore, UserStore } from '@/lib/store';
export async function GET(req) {
  try {
    const { errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;
    const filter = new URL(req.url).searchParams.get('filter') || 'all';
    let leads = ['trash', 'deleted'].includes(filter) ? await LeadStore.findDeleted() : await LeadStore.findAll();
    if (filter === 'unassigned') leads = leads.filter(lead => !lead.assigned_to);
    const users = new Map((await UserStore.findAllUsers()).map(user => [user.id, user]));
    leads = leads.map(lead => {
      const owner = users.get(lead.assigned_to);
      return { ...lead, assignedUser: owner ? { _id: owner.id, name: owner.name, email: owner.email, role: owner.role } : null };
    });
    return NextResponse.json({ success: true, count: leads.length, data: leads });
  } catch (error) { return NextResponse.json({ success: false, message: error.message }, { status: 500 }); }
}
