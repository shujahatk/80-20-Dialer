import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { LeadStore } from '@/lib/store';

export async function GET(req) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    await connectDB();

    const { searchParams } = new URL(req.url, 'http://localhost');
    const page = parseInt(searchParams.get('page'), 10) || 1;
    const limit = parseInt(searchParams.get('limit'), 10) || 100;
    const search = searchParams.get('search') || '';
    const stage = searchParams.get('stage') || '';
    const status = searchParams.get('status') || '';
    const all = searchParams.get('all') === 'true';

    const assignedTo = user.role === 'salesperson' ? user._id : (searchParams.get('assignedTo') || null);

    if (all) {
      const leads = assignedTo ? await LeadStore.findByUser(assignedTo) : await LeadStore.findAll();
      return NextResponse.json({
        success: true,
        count: leads.length,
        data: leads
      });
    }

    const result = await LeadStore.findPaginated({
      page,
      limit,
      search,
      stage,
      status,
      assignedTo,
      light: true
    });

    return NextResponse.json({
      success: true,
      count: result.total,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      data: result.leads
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
