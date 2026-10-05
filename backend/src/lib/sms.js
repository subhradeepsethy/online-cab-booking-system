import { env } from '../config/env.js';
import { HttpError } from './httpError.js';

const smsFailed = () => new HttpError(502, 'SMS_FAILED', 'We could not send the SMS. Please try again in a minute.');

// Sends a one-time code to an Indian mobile number (10 digits, without +91).
export async function sendOtpSms(phone, code) {
  const { provider } = env.sms;
  const text = `${code} is your Cab System verification code. It expires in 10 minutes. Never share it with anyone.`;

  if (provider === 'console') {
    console.log(`[sms:console] To +91${phone}: ${text}`);
    return;
  }

  try {
    let response;
    if (provider === 'twilio') {
      const { accountSid, authToken, from } = env.sms.twilio;
      const body = new URLSearchParams({ To: `+91${phone}`, Body: text });
      body.set(from.startsWith('MG') ? 'MessagingServiceSid' : 'From', from);
      response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } else if (provider === 'msg91') {
      // MSG91 OTP API (v5). The DLT-approved template must contain the ##OTP## variable.
      const { authKey, templateId } = env.sms.msg91;
      const params = new URLSearchParams({ template_id: templateId, mobile: `91${phone}`, otp: code, otp_expiry: '10' });
      response = await fetch(`https://control.msg91.com/api/v5/otp?${params}`, {
        method: 'POST',
        headers: { authkey: authKey, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10_000),
      });
    }

    if (!response?.ok) {
      // Log status only: provider responses can echo the phone number or account details.
      console.error(`[sms:${provider}] send failed with HTTP ${response?.status}`);
      throw smsFailed();
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error(`[sms:${provider}] send failed: ${error.name}`);
    throw smsFailed();
  }
}
