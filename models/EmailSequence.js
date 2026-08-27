import mongoose from 'mongoose';

const emailSequenceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  steps: [{
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailTemplate',
      required: true
    },
    delayDays: {
      type: Number,
      default: 0
    },
    delayHours: {
      type: Number,
      default: 0
    }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const EmailSequence = mongoose.models.EmailSequence || mongoose.model('EmailSequence', emailSequenceSchema);
export default EmailSequence;
