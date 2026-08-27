import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    index: true
  },
  contact: {
    name: { type: String, required: true, trim: true },
    position: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    preferredChannel: { type: String, enum: ['phone', 'email', 'sms', 'whatsapp', ''], default: '' }
  },
  company: {
    name: { type: String, default: '' },
    website: { type: String, default: '' },
    niche: { type: String, default: '' },
    notes: { type: String, default: '' }
  },
  geography: {
    country: { type: String, default: '' },
    city: { type: String, default: '' },
    region: { type: String, default: '' },
    timezone: { type: String, default: 'UTC' }
  },
  assignment: {
    list: { type: String, default: '' },
    priority: { type: Number, default: 0 },
    dateAssigned: { type: Date },
    dailyQueuePosition: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['new', 'no-answer', 'busy', 'voicemail', 'callback', 'send-info', 'interested', 'meeting-booked', 'not-interested', 'wrong-number', 'dnc', 'opted-out'],
    default: 'new'
  },
  lastAction: {
    type: String,
    default: ''
  },
  lastActionDate: {
    type: Date
  },
  nextAction: {
    type: String,
    default: 'call'
  },
  callbackDate: {
    type: Date
  },
  callbackNote: {
    type: String,
    default: ''
  },
  hasUnansweredReply: {
    type: Boolean,
    default: false,
    index: true
  },
  lastReplyText: {
    type: String,
    default: ''
  },
  lastReplyChannel: {
    type: String,
    default: ''
  },
  lastReplyAt: {
    type: Date
  },
  suppression: {
    phone: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false }
  },
  booking: {
    booked: { type: Boolean, default: false },
    meetingDate: { type: Date },
    meetingTimezone: { type: String },
    closer: { type: String },
    meetingLink: { type: String }
  },
  emailSequence: {
    status: { type: String, enum: ['active', 'stopped'], default: 'active' },
    stopReason: { type: String, default: '' },
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailSequence', default: null },
    currentStep: { type: Number, default: 0 },
    nextSendAt: { type: Date, default: null },
    lastSentDate: { type: Date },
    emailsSent: { type: Number, default: 0 }
  },
  coldOutreachStopped: {
    type: Boolean,
    default: false
  },
  currentlyBeingWorked: {
    type: Boolean,
    default: false
  },
  currentlyBeingWorkedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  currentlyBeingWorkedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

leadSchema.index({ userId: 1, status: 1 });
leadSchema.index({ userId: 1, 'callbackDate': 1 });
leadSchema.index({ 'contact.phone': 1 });
leadSchema.index({ 'contact.email': 1 });

const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
export default Lead;
