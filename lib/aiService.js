// Central AI Personalization Service using Anthropic Claude API (https://api.anthropic.com/v1/messages)

/**
 * Generate a personalized message for a lead using Claude API
 * @param {Object} params
 * @param {Object} params.lead - Lead document / object
 * @param {string} params.basePrompt - Core message intent / template body
 * @param {string} [params.tone] - Optional tone (e.g. 'friendly', 'professional', 'direct')
 * @param {string} [params.channel] - Communication channel ('email' | 'sms')
 * @returns {Promise<string>} Generated personalized message body
 */
export async function generatePersonalizedMessage({ lead, basePrompt, tone = 'professional', channel = 'email' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const firstName = lead?.contact?.name || 'there';
  const companyName = lead?.company?.name || 'your company';

  // Fallback function for simple template substitution if API key is missing or call fails
  const fallbackMessage = () => {
    if (basePrompt && basePrompt.includes('{{')) {
      let text = basePrompt;
      text = text.replace(/{{firstName}}/g, firstName);
      text = text.replace(/{{company}}/g, companyName);
      return text;
    }
    return `Hi ${firstName},

I noticed your work at ${companyName}.

I wanted to reach out to introduce our outbound sales solution and discuss how we can help support your growth.

Do you have 10 minutes for a brief call later this week?

Best regards`;
  };

  if (!apiKey) {
    console.warn('[AI Service] ANTHROPIC_API_KEY not set. Using template fallback.');
    return fallbackMessage();
  }

  try {
    const model = process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';

    const systemPrompt = `You are an expert sales outreach copywriter for a B2B sales outbound system.
Your task is to write a concise, natural-sounding, highly effective personalized message for a specific prospect based on their provided metadata and the user's intent.

CRITICAL INSTRUCTIONS:
- Write a short, natural message using the prospect's details (name, company, title, niche, notes) naturally.
- If prospect data is thin, do NOT invent fake facts or force awkward personalization; keep it clean and relevant.
- SPAM PREVENTION RULES:
  * NO ALL-CAPS words.
  * NO excessive exclamation marks (max 1 in the whole message).
  * NO spam trigger phrases ("ACT NOW", "FREE", "GUARANTEE", "LIMITED TIME", "RISK-FREE", "NO OBLIGATION", "CLICK HERE").
  * NO hype or aggressive sales pitch tactics.
- CHANNEL RULES:
  * If channel is 'sms': keep the message under 260 characters, concise and punchy.
  * If channel is 'email': keep the message under 150 words, clean line breaks.
- OUTPUT FORMAT: Return ONLY the raw message body. Do NOT include a subject line, preamble, "Here is your message:", markdown formatting, or quotation marks.`;

    const leadInfo = `
PROSPECT METADATA:
Name: ${lead?.contact?.name || 'N/A'}
Position/Title: ${lead?.contact?.position || 'N/A'}
Company Name: ${lead?.company?.name || 'N/A'}
Industry/Niche: ${lead?.company?.niche || 'N/A'}
Notes: ${lead?.company?.notes || 'N/A'}
Status: ${lead?.status || 'N/A'}
Target Channel: ${channel}
Desired Tone: ${tone}

USER CORE INTENT / BASE PROMPT:
${basePrompt || 'Reach out to introduce our outbound sales solution and discuss how we can help their growth.'}
`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: channel === 'sms' ? 300 : 600,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: leadInfo
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Service] Anthropic API error status ${response.status}:`, errorText);
      return fallbackMessage();
    }

    const data = await response.json();
    const generatedText = data?.content?.[0]?.text?.trim();

    if (!generatedText) {
      console.warn('[AI Service] Empty text returned from Claude API. Using fallback.');
      return fallbackMessage();
    }

    return generatedText;
  } catch (err) {
    console.error('[AI Service] Exception during personalization:', err.message);
    return fallbackMessage();
  }
}
