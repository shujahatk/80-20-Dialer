import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LeadStore } from '@/lib/store';

// GET /api/leads/[id] - Retrieves lead and locks it
export async function GET(req, { params }) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { id: leadId } = await params;
    const lead = await LeadStore.findById(leadId);
    if (!lead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    // Check lock status (locks expire in 5 minutes)
    const lockExpiry = 5 * 60 * 1000;
    const now = new Date();

    if (
      lead.currentlyBeingWorked &&
      lead.currentlyBeingWorkedBy &&
      lead.currentlyBeingWorkedBy.toString() !== user._id.toString() &&
      lead.currentlyBeingWorkedAt &&
      (now - new Date(lead.currentlyBeingWorkedAt)) < lockExpiry
    ) {
      return NextResponse.json(
        { success: false, message: 'This lead is currently being contacted by another agent.' },
        { status: 423 } // Locked
      );
    }

    // Acquire lock
    const lockedLead = await LeadStore.update(leadId, {
      currentlyBeingWorked: true,
      currentlyBeingWorkedBy: user._id,
      currentlyBeingWorkedAt: now
    });

    return NextResponse.json({
      success: true,
      data: lockedLead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}

// PUT /api/leads/[id] - Updates general lead fields
export async function PUT(req, { params }) {
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized access.' },
        { status: 401 }
      );
    }

    const { id: leadId } = await params;
    const body = await req.json();

    const updatedLead = await LeadStore.update(leadId, body);
    if (!updatedLead) {
      return NextResponse.json(
        { success: false, message: 'Lead not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Lead updated successfully.',
      data: updatedLead
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
