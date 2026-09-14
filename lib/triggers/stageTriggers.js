import { syncLeadToListmonk } from '../listmonk.js';

const LISTMONK_URL = process.env.LISTMONK_URL || 'http://localhost:9001';
const LISTMONK_USER = process.env.LISTMONK_ADMIN_USER || 'admin';
const LISTMONK_PASS = process.env.LISTMONK_ADMIN_PASS || 'admin_password_2026';

export function getListmonkAuthHeader() {
  return 'Basic ' + Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString('base64');
}

/**
 * Automated Stage Change Trigger Engine
 * Executes background business logic whenever a lead transitions stages
 */
export async function handleStageChangeTrigger(lead, oldStage, newStage) {
  if (!lead || !newStage || oldStage === newStage) return;

  const email = lead.email || lead.contact?.email;
  const leadId = lead._id || lead.id;
  const leadName = lead.name || lead.contact?.name || 'Prospect';

  console.log(`⚡ [Stage Trigger]: Lead '${leadName}' (${leadId}) transitioned from '${oldStage || 'none'}' -> '${newStage}'`);

  try {
    // TRIGGER 1: "Proposal Sent" -> Enroll in 3-day Listmonk follow-up drip (List ID 2)
    if (newStage === 'proposal_sent' && email) {
      console.log(`📧 [Trigger Executing]: Enrolling ${email} into Proposal Follow-Up Drip List (ID 2)...`);
      await syncLeadToListmonk(lead, [2]).catch(err => console.warn('[Listmonk Drip Sync Notice]:', err.message));
    }

    // TRIGGER 2: "Appointment Booked" -> Pause cold blasts & mark blocklisted in Listmonk
    if (newStage === 'appointment_booked' && email) {
      console.log(`📅 [Trigger Executing]: Halting cold blasts for booked lead ${email}...`);
      await fetch(`${LISTMONK_URL}/api/subscribers/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: getListmonkAuthHeader()
        },
        body: JSON.stringify({ status: 'blocklisted' })
      }).catch(err => console.warn('[Listmonk Pause Blast Notice]:', err.message));
    }

    // TRIGGER 3: "Lost / Disqualified" -> Clean up queue and unsubscribe from Listmonk
    if (newStage === 'lost' && email) {
      console.log(`🔴 [Trigger Executing]: Removing disqualified/lost subscriber ${email}...`);
      await fetch(`${LISTMONK_URL}/api/subscribers/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        headers: { Authorization: getListmonkAuthHeader() }
      }).catch(err => console.warn('[Listmonk Unsubscribe Notice]:', err.message));
    }
  } catch (triggerErr) {
    console.error('[Stage Trigger Engine Error]:', triggerErr.message);
  }
}
