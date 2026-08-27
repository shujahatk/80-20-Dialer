import mongoose from 'mongoose';

const loginSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  loginAt: {
    type: Date,
    default: Date.now
  },
  logoutAt: {
    type: Date
  },
  lastActivityAt: {
    type: Date,
    default: Date.now
  },
  activeTimeSeconds: {
    type: Number,
    default: 0
  },
  dialingTimeSeconds: {
    type: Number,
    default: 0
  },
  breakTimeSeconds: {
    type: Number,
    default: 0
  },
  isOnBreak: {
    type: Boolean,
    default: false
  },
  breakStartedAt: {
    type: Date,
    default: null
  },
  date: {
    type: String,
    index: true
  }
});

loginSessionSchema.index({ userId: 1, date: 1 });

const LoginSession = mongoose.models.LoginSession || mongoose.model('LoginSession', loginSessionSchema);
export default LoginSession;
