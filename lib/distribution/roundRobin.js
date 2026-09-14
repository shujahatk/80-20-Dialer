/**
 * Smart Round-Robin Lead Distribution Engine
 * Evenly balances leads across active sales rep queues
 */
export function distributeLeadsRoundRobin(leads, activeSalespersonIds) {
  if (!leads || !Array.isArray(leads) || leads.length === 0) return [];
  if (!activeSalespersonIds || !Array.isArray(activeSalespersonIds) || activeSalespersonIds.length === 0) {
    return leads;
  }

  const numReps = activeSalespersonIds.length;

  return leads.map((lead, index) => {
    const assignedRepId = activeSalespersonIds[index % numReps];
    return {
      ...lead,
      assigned_to: assignedRepId,
      assignedTo: assignedRepId,
      status: 'assigned',
      stage: lead.stage || 'new_lead'
    };
  });
}
