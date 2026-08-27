import mongoose from 'mongoose';

const whatsappTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['cold-outreach', 'follow-up', 'booking', 'general'],
    default: 'general'
  },
  mergeFields: [{
    type: String
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

const WhatsAppTemplate = mongoose.models.WhatsAppTemplate || mongoose.model('WhatsAppTemplate', whatsappTemplateSchema);
export default WhatsAppTemplate;
