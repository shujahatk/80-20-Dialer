import mongoose from 'mongoose';

const sendingInboxSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: 'Default Inbox'
  },
  fromEmail: {
    type: String,
    trim: true,
    default: ''
  },
  fromName: {
    type: String,
    default: ''
  },
  dailyLimit: {
    type: Number,
    default: 50
  },
  status: {
    type: String,
    enum: ['healthy', 'warming', 'throttled', 'flagged'],
    default: 'healthy'
  },
  active: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dailyCounters: [{
    date: { type: String, required: true },
    emailsSent: { type: Number, default: 0 }
  }],
  // Backward compatibility fields
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  date: {
    type: String,
    index: true
  },
  emailsSent: {
    type: Number,
    default: 0
  },
  smsSent: {
    type: Number,
    default: 0
  },
  callsMade: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const SendingInbox = mongoose.models.SendingInbox || mongoose.model('SendingInbox', sendingInboxSchema);
export default SendingInbox;
