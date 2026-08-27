/**
 * Safe serializers to prevent exposing sensitive credentials, secrets, and internal hashes to the client.
 */

export function serializeSendingInbox(inbox) {
  if (!inbox) return null;
  const doc = typeof inbox.toObject === 'function' ? inbox.toObject() : { ...inbox };

  // Never return secret credentials through API responses
  delete doc.apiKey;
  delete doc.smtpPassword;
  delete doc.secret;
  delete doc.credentials;

  return {
    _id: doc._id?.toString() || doc._id,
    name: doc.name || 'Outbound Inbox',
    fromEmail: doc.fromEmail || 'onboarding@resend.dev',
    fromName: doc.fromName || 'Outbound Sales',
    dailyLimit: doc.dailyLimit || 500,
    sentToday: doc.sentToday || 0,
    status: doc.status || 'active',
    domainStatus: doc.domainStatus || 'verified',
    assignedUsers: doc.assignedUsers || [],
    createdAt: doc.createdAt
  };
}

export function serializeUser(user) {
  if (!user) return null;
  const doc = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete doc.password;
  return {
    _id: doc._id?.toString() || doc._id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    approved: doc.approved,
    active: doc.active,
    timezone: doc.timezone || 'UTC',
    dailyLeadTarget: doc.dailyLeadTarget || 50,
    dailyEmailLimit: doc.dailyEmailLimit || 50,
    calendarLink: doc.calendarLink || '',
    lastLogin: doc.lastLogin,
    lastActive: doc.lastActive
  };
}
