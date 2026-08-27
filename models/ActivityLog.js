import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['call', 'sms', 'email', 'note', 'status-change', 'callback', 'booking', 'assign', 'reassign'],
    required: true
  },
  channel: {
    type: String,
    enum: ['phone', 'email', 'sms', 'whatsapp', ''],
    default: ''
  },
  direction: {
    type: String,
    enum: ['outbound', 'inbound', ''],
    default: 'outbound'
  },
  outcome: {
    type: String,
    default: ''
  },
  previousStatus: {
    type: String,
    default: ''
  },
  newStatus: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  duration: {
    type: Number,
    default: 0
  },
  callSid: {
    type: String,
    default: ''
  },
  messageSid: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

activityLogSchema.index({ leadId: 1, timestamp: -1 });

const ActivityLog = mongoose.models.ActivityLog || mongoose.model('ActivityLog', activityLogSchema);
export default ActivityLog;
