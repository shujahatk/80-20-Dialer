import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/middleware/authGuard';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { LeadStore, UserStore } from '@/lib/store';

export async function GET(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter') || 'all';

    let leads = [];

    if (filter === 'trash' || filter === 'deleted') {
      leads = await LeadStore.findDeleted();
      return NextResponse.json({
        success: true,
        count: leads.length,
        data: leads
      });
    }

    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      let query = client.from('leads').select('*').is('deleted_at', null).order('created_at', { ascending: false });

      if (filter === 'unassigned') {
        query = query.or('assigned_to.is.null,assigned_to.eq.');
      }

      const { data, error } = await query;
      if (error) {
        console.error('[Supabase Manager Leads Error]:', error.message);
      } else if (data) {
        const users = await UserStore.findAllUsers();
        const userMap = new Map(users.map(u => [String(u._id || u.id), u]));

        leads = data.map(l => {
          const assignedUser = l.assigned_to ? userMap.get(String(l.assigned_to)) : null;
          return {
            ...l,
            _id: l._id || l.id,
            contact: { name: l.name, email: l.email, phone: l.phone },
            company: { name: l.company },
            assignedTo: l.assigned_to,
            assigned_to: l.assigned_to,
            assignedUser: assignedUser ? { _id: assignedUser._id, name: assignedUser.name, email: assignedUser.email, role: assignedUser.role } : null
          };
        });
      }
    } else {
      const allLeads = await LeadStore.findAll();
      if (filter === 'unassigned') {
        leads = allLeads.filter(l => !l.assignedTo && !l.assigned_to);
      } else {
        leads = allLeads;
      }
    }

    return NextResponse.json({
      success: true,
      count: leads.length,
      data: leads
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

