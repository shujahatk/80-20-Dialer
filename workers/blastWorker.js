// Long-running worker for blast email/SMS campaigns.
/// Polls MongoDB every ~5s for BlastCampaign documents with status 'queued'.
/// Processes lead list, checks suppression, personalizes template, sends via
/// emailService (email) or sendBlastSms (SMS stub), logs each send to Message model,
/// updates campaign stats incrementally.

import mongoose from 'mongoose';
import { connectDB } from '../lib/db.js';
import Lead from '../models/Lead.js';
import Message from '../models/Message.js';
import BlastCampaign from '../models/BlastCampaign.js';
import User from '../models/User.js';
import { sendBlastSms } from '../lib/sms/sendBlastSms.js';
import { sendEmail } from '../lib/emailService.js';
import { generatePersonalizedMessage } from '../lib/aiService.js';

// Increase poll interval if DB is not yet connected; reduce once running
const POLL_INTERVAL_MS = 5000;

// Fetch queued campaigns and process them
async function processQueuedCampaigns() {
  try {
    const isConnected = await connectDB();
    if (!isConnected) {
      console.log('[Blast Worker] Database not connected. Skipping poll.');
      return;
    }

    const campaigns = await BlastCampaign.find({ status: 'queued' })
      .limit(5) // limit concurrent processing to 5 at a time
      .lean();

    for (const camp of campaigns) {
      await processBlastCampaign(camp._id);
    }
  } catch (err) {
    console.error('[Blast Worker] Error polling campaigns:', err.message);
  }
}

async function processBlastCampaign(campaignId) {
  // Fetch fresh campaign doc
  const campaign = await BlastCampaign.findById(campaignId).lean();
  if (!campaign || campaign.status !== 'queued') return;

  console.log(`[Blast Worker] Starting campaign: ${campaign.name} (${campaignId})`);

  // Mark as processing immediately
  await BlastCampaign.updateOne({ _id: campaignId }, { status: 'processing', completedAt: null });

  const { type, templateSubject, templateBody, leadIds, createdBy, useAiPersonalization } = campaign;
  const totalLeads = leadIds.length;

  // Retrieve user details for the sender
  const user = await User.findById(createdBy).lean();
  const createdName = user?.name || 'Outbound Dialer';
  const createdEmail = user?.email || 'onboarding@resend.dev';

  // Initialize stats
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // Process each lead
  for (let i = 0; i < leadIds.length; i++) {
    const leadId = leadIds[i];

    // Check if campaign was cancelled or paused mid-run
    const checkCampaign = await BlastCampaign.findById(campaignId).lean();
    if (!checkCampaign || checkCampaign.status === 'cancelled') {
      // Mark remaining as skipped
      skippedCount += leadIds.length - i;
      await BlastCampaign.updateOne(
        { _id: campaignId },
        {
          $set:
          {
            stats: {
              total: totalLeads,
              sent: sentCount,
              failed: failedCount,
              skipped: skippedCount,
            },
            status: 'cancelled',
            completedAt: new Date(),
          },
        }
      );
      console.log(`[Blast Worker] Campaign ${campaignId} was cancelled mid-run.`);
      return;
    }

    if (checkCampaign.status === 'paused') {
      console.log(`[Blast Worker] Campaign ${campaignId} was paused mid-run.`);
      return;
    }

    // Idempotency check: prevent duplicate send if worker restarted or retried
    const existingMessage = await Message.findOne({ blastCampaignId: campaignId, leadId, status: 'sent' }).lean();
    if (existingMessage) {
      sentCount++;
      console.log(`[Blast Worker] Lead ${leadId} already processed for campaign ${campaignId}. Skipping.`);
      continue;
    }

    // Fetch lead with suppression check
    const lead = await Lead.findById(leadId).select('suppression contact company').lean();
    if (!lead) {
      failedCount++;
      // Update stats incrementally
      await BlastCampaign.updateOne(
        { _id: campaignId },
        {
          $set:
          {
            stats: {
              total: totalLeads,
              sent: sentCount,
              failed: failedCount,
              skipped: skippedCount,
            },
          },
        }
      );
      console.warn(`[Blast Worker] Lead ${leadId} not found in campaign ${campaignId}.`);
      continue;
    }

    // Respect suppression check
    const isSuppressed = type === 'email' ? lead.suppression?.email : lead.suppression?.sms;
    if (isSuppressed) {
      skippedCount++;
      // Update stats incrementally
      await BlastCampaign.updateOne(
        { _id: campaignId },
        {
          $set:
          {
            stats: {
              total: totalLeads,
              sent: sentCount,
              failed: failedCount,
              skipped: skippedCount,
            },
          },
        }
      );
      console.log(`[Blast Worker] Lead ${leadId} is suppressed, skipping.`);
      continue;
    }

    // Personalize template with merge tags / Claude AI
    let body = templateBody || '';
    let subject = templateSubject || '';

    const firstName = lead.contact?.name || '';
    const companyName = lead.company?.name || '';

    if (useAiPersonalization !== false) {
      try {
        body = await generatePersonalizedMessage({
          lead,
          basePrompt: templateBody,
          tone: 'professional',
          channel: type
        });
        // Pacing delay (400ms) between Claude API calls to prevent rate limit spikes
        await new Promise(resolve => setTimeout(resolve, 400));
      } catch (aiErr) {
        console.warn(`[Blast Worker] AI generation failed for lead ${leadId}, using fallback:`, aiErr.message);
        if (body) {
          body = body.replace(/{{firstName}}/g, firstName);
          body = body.replace(/{{company}}/g, companyName);
        }
      }
    } else {
      if (body) {
        body = body.replace(/{{firstName}}/g, firstName);
        body = body.replace(/{{company}}/g, companyName);
      }
    }

    if (subject) {
      subject = subject.replace(/{{firstName}}/g, firstName);
      subject = subject.replace(/{{company}}/g, companyName);
    }

    // Send via appropriate channel
    let messageStatus = 'sent';
    let messageChannel = type;
    let sendResult;

    if (type === 'email') {
      try {
        sendResult = await sendEmail({
          to: lead.contact?.email,
          subject: subject,
          html: body,
          fromName: createdName,
          fromEmail: createdEmail,
        });
        if (!sendResult.success) messageStatus = 'failed';
      } catch (err) {
        console.error('[Blast Worker] Email send error:', err.message);
        messageStatus = 'failed';
      }
    } else if (type === 'sms') {
      try {
        const phone = lead.contact?.phone;
        if (!phone) {
          messageStatus = 'failed';
        } else {
          sendResult = await sendBlastSms(
            [phone],
            body,
            [leadId]
          );
          if (!sendResult.success) messageStatus = 'failed';
        }
      } catch (err) {
        console.error('[Blast Worker] SMS send error:', err.message);
        messageStatus = 'failed';
      }
    }

    // Log to Message model with blastCampaignId
    try {
      const recipientContact = type === 'email' ? lead.contact?.email : lead.contact?.phone;
      await Message.create({
        userId: createdBy,
        leadId,
        messageSid: sendResult?.id || sendResult?.results?.[0]?.messageSid || `blast-${campaignId}-${Date.now()}`,
        from: type === 'email' ? `${createdName} <${createdEmail}>` : (process.env.TWILIO_PHONE_NUMBER || 'system'),
        to: recipientContact || 'unknown',
        body,
        status: messageStatus,
        channel: messageChannel,
        direction: 'outbound',
        blastCampaignId: campaignId,
      });
    } catch (err) {
      console.error('[Blast Worker] Message log error:', err.message);
    }

    // Update stats incrementally
    if (messageStatus === 'sent') sentCount++;
    else if (messageStatus === 'failed') failedCount++;

    await BlastCampaign.updateOne(
      { _id: campaignId },
      {
        $set:
        {
          stats: {
            total: totalLeads,
            sent: sentCount,
            failed: failedCount,
            skipped: skippedCount,
          },
        },
      }
    );

    console.log(`[Blast Worker] Lead ${leadId}: ${messageStatus} (sent:${sentCount}, failed:${failedCount}, skipped:${skippedCount})`);
  }

  // Mark campaign completed
  const finalStats = {
    total: totalLeads,
    sent: sentCount,
    failed: failedCount,
    skipped: skippedCount,
  };

  await BlastCampaign.updateOne(
    { _id: campaignId },
    {
      $set:
      {
        status: 'completed',
        stats: finalStats,
        completedAt: new Date(),
      },
    }
  );

  console.log(`[Blast Worker] Campaign ${campaignId} completed: ${JSON.stringify(finalStats)}`);
}

// Start the worker loop
connectDB().then(() => {
  console.log('[Blast Worker] Connected to database. Starting worker loop.');

  // Initial poll
  processQueuedCampaigns();

  // Then poll every POLL_INTERVAL_MS
  setInterval(processQueuedCampaigns, POLL_INTERVAL_MS);
}).catch(err => {
  console.error('[Blast Worker] MongoDB connection error:', err.message);
});

// Export for testing
export { processQueuedCampaigns, processBlastCampaign };