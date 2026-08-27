import mongoose from 'mongoose';

const blastCampaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['email', 'sms'],
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  templateSubject: {
    type: String,
    trim: true
  },
  templateBody: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  sendingInboxId: {
    type: String,
    default: 'default'
  },
  tone: {
    type: String,
    default: 'professional'
  },
  salesObjective: {
    type: String,
    default: ''
  },
  useAiPersonalization: {
    type: Boolean,
    default: true
  },
  leadIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  }],
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'queued', 'running', 'processing', 'paused', 'completed', 'cancelled', 'failed'],
    default: 'draft'
  },
  stats: {
    total: {
      type: Number,
      default: 0
    },
    sent: {
      type: Number,
      default: 0
    },
    failed: {
      type: Number,
      default: 0
    },
    skipped: {
      type: Number,
      default: 0
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
}, { timestamps: true });

blastCampaignSchema.index({ createdBy: 1, createdAt: -1 });
blastCampaignSchema.index({ status: 1 });

export default mongoose.models.BlastCampaign || mongoose.model('BlastCampaign', blastCampaignSchema);