const MERGE_FIELD_REGEX = /\{\{(\w+)\}\}/g;

export function applyMergeFields(template, lead, senderUser = null, closerUser = null) {
  if (!template) return '';
  return template.replace(MERGE_FIELD_REGEX, (match, field) => {
    const key = field.toLowerCase();
    
    // Contact fields
    if (key === 'name' || key === 'contact_name') return lead?.contact?.name || '';
    if (key === 'first_name') return (lead?.contact?.name || '').split(' ')[0] || '';
    if (key === 'last_name') {
      const parts = (lead?.contact?.name || '').split(' ');
      return parts.length > 1 ? parts.slice(1).join(' ') : '';
    }
    if (key === 'phone') return lead?.contact?.phone || '';
    if (key === 'email') return lead?.contact?.email || '';
    if (key === 'position' || key === 'title') return lead?.contact?.position || '';
    
    // Company fields
    if (key === 'company' || key === 'company_name') return lead?.company?.name || '';
    if (key === 'website' || key === 'company_website') return lead?.company?.website || '';
    if (key === 'niche' || key === 'industry') return lead?.company?.niche || '';
    
    // Geography fields
    if (key === 'city') return lead?.geography?.city || '';
    if (key === 'country') return lead?.geography?.country || '';
    
    // Booking / Calendar links
    if (key === 'booking_link' || key === 'calendar_link' || key === 'calendar' || key === 'meeting_link') {
      return lead?.booking?.meetingLink || closerUser?.calendarLink || senderUser?.calendarLink || '';
    }
    
    // Closer / Sender names
    if (key === 'closer_name' || key === 'closer') {
      return closerUser?.name || lead?.booking?.closer || senderUser?.name || '';
    }
    if (key === 'sender_name' || key === 'agent_name' || key === 'user_name') {
      return senderUser?.name || '';
    }
    
    return '';
  });
}
