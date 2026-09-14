/**
 * Canonical 10-Stage Pipeline Lifecycle & State Machine
 */

export const PIPELINE_STAGES = [
  {
    id: 'NEW',
    label: 'New',
    shortLabel: 'New',
    icon: '📥',
    color: 'sky',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    headerBg: 'from-sky-500/20 to-sky-950/40',
    dotColor: 'bg-sky-400',
    description: 'Freshly ingested or uncontacted prospects'
  },
  {
    id: 'CONTACTED',
    label: 'Contacted',
    shortLabel: 'Contacted',
    icon: '📞',
    color: 'blue',
    badgeClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    headerBg: 'from-blue-500/20 to-blue-950/40',
    dotColor: 'bg-blue-400',
    description: 'Initial touchpoint attempted or outbound message sent'
  },
  {
    id: 'ENGAGED',
    label: 'Engaged',
    shortLabel: 'Engaged',
    icon: '💬',
    color: 'indigo',
    badgeClass: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    headerBg: 'from-indigo-500/20 to-indigo-950/40',
    dotColor: 'bg-indigo-400',
    description: 'Inbound reply or active conversation engaged'
  },
  {
    id: 'INTERESTED',
    label: 'Interested',
    shortLabel: 'Interested',
    icon: '📅',
    color: 'cyan',
    badgeClass: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    headerBg: 'from-cyan-500/20 to-cyan-950/40',
    dotColor: 'bg-cyan-400',
    description: 'Positive interest confirmed or discovery meeting booked'
  },
  {
    id: 'QUALIFIED',
    label: 'Qualified',
    shortLabel: 'Qualified',
    icon: '🎯',
    color: 'teal',
    badgeClass: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
    headerBg: 'from-teal-500/20 to-teal-950/40',
    dotColor: 'bg-teal-400',
    description: 'BANT criteria verified and high intent verified'
  },
  {
    id: 'CUSTOMER',
    label: 'Customer',
    shortLabel: 'Won',
    icon: '🏆',
    color: 'emerald',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    headerBg: 'from-emerald-500/20 to-emerald-950/40',
    dotColor: 'bg-emerald-400',
    description: 'Closed won customer deal'
  },
  {
    id: 'FOLLOW_UP',
    label: 'Follow Up',
    shortLabel: 'Follow Up',
    icon: '⏳',
    color: 'amber',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    headerBg: 'from-amber-500/20 to-amber-950/40',
    dotColor: 'bg-amber-400',
    description: 'Scheduled for future touchpoint'
  },
  {
    id: 'NO_RESPONSE',
    label: 'No Response',
    shortLabel: 'No Resp',
    icon: '📵',
    color: 'slate',
    badgeClass: 'bg-slate-700/40 text-slate-300 border-slate-600/30',
    headerBg: 'from-slate-700/20 to-slate-900/40',
    dotColor: 'bg-slate-400',
    description: 'Sequence completed with no opens or replies'
  },
  {
    id: 'NOT_INTERESTED',
    label: 'Not Interested',
    shortLabel: 'Not Int',
    icon: '🔴',
    color: 'rose',
    badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    headerBg: 'from-rose-500/20 to-rose-950/40',
    dotColor: 'bg-rose-400',
    description: 'Prospect declined or email bounced'
  },
  {
    id: 'DO_NOT_CONTACT',
    label: 'Do Not Contact',
    shortLabel: 'DNC',
    icon: '🚫',
    color: 'red',
    badgeClass: 'bg-red-600/20 text-red-300 border-red-500/40',
    headerBg: 'from-red-600/20 to-red-950/40',
    dotColor: 'bg-red-400',
    description: 'Unsubscribed, spam reported, or suppressed'
  }
];

export const VALID_STAGE_IDS = PIPELINE_STAGES.map(s => s.id);

/**
 * Normalizes any legacy, snake_case, or lowercase stage strings to canonical uppercase stages
 */
export function normalizePipelineStage(input) {
  if (!input) return 'NEW';
  const str = String(input).trim().toUpperCase();

  const stageMap = {
    'NEW': 'NEW',
    'NEW_LEAD': 'NEW',
    'NEW-LEAD': 'NEW',
    'CONTACTED': 'CONTACTED',
    'CALL_1': 'CONTACTED',
    'CALL_2': 'CONTACTED',
    'CALL_3': 'CONTACTED',
    'CALL_4': 'CONTACTED',
    'ENGAGED': 'ENGAGED',
    'REPLIED': 'ENGAGED',
    'INTERESTED': 'INTERESTED',
    'APPOINTMENT_BOOKED': 'INTERESTED',
    'BOOKED': 'INTERESTED',
    'PROPOSAL_SENT': 'QUALIFIED',
    'QUALIFIED': 'QUALIFIED',
    'CUSTOMER': 'CUSTOMER',
    'WON': 'CUSTOMER',
    'CLOSED_WON': 'CUSTOMER',
    'FOLLOW_UP': 'FOLLOW_UP',
    'FOLLOW-UP': 'FOLLOW_UP',
    'CALLBACK': 'FOLLOW_UP',
    'NO_RESPONSE': 'NO_RESPONSE',
    'NO-RESPONSE': 'NO_RESPONSE',
    'NO_ANSWER': 'NO_RESPONSE',
    'VOICEMAIL': 'NO_RESPONSE',
    'NOT_INTERESTED': 'NOT_INTERESTED',
    'NOT-INTERESTED': 'NOT_INTERESTED',
    'LOST': 'NOT_INTERESTED',
    'CLOSED_LOST': 'NOT_INTERESTED',
    'DO_NOT_CONTACT': 'DO_NOT_CONTACT',
    'DNC': 'DO_NOT_CONTACT',
    'OPTED_OUT': 'DO_NOT_CONTACT',
    'OPTED-OUT': 'DO_NOT_CONTACT',
    'UNSUBSCRIBED': 'DO_NOT_CONTACT'
  };

  return stageMap[str] || (VALID_STAGE_IDS.includes(str) ? str : 'NEW');
}

export function getStageConfig(stageId) {
  const normalized = normalizePipelineStage(stageId);
  return PIPELINE_STAGES.find(s => s.id === normalized) || PIPELINE_STAGES[0];
}
