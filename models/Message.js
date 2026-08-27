import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    index: true
  },
  messageSid: {
    type: String,
    required: true,
    unique: true
  },
  from: {
    type: String,
    required: true
  },
  to: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  status: {
    type: String,
    default: 'queued'
  },
  channel: {
    type: String,
    enum: ['sms', 'whatsapp', 'email'],
    default: 'sms'
  },
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    default: 'outbound'
  },
  errorCode: {
    type: String,
    default: ''
  },
  errorMessage: {
    type: String,
    default: ''
  },
  blastCampaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlastCampaign'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;
