import mongoose from 'mongoose';

const systemConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'main_config'
  },
  callRecordingEnabled: {
    type: Boolean,
    default: false
  },
  allowedHoursStart: {
    type: Number,
    default: 8 // 8 AM
  },
  allowedHoursEnd: {
    type: Number,
    default: 18 // 6 PM
  },
  crmWebhookUrl: {
    type: String,
    default: ''
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', systemConfigSchema);
export default SystemConfig;
