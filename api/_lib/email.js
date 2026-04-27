/**
 * PAP Magazine - Email Service
 * Nodemailer-based transactional email sender
 */

const nodemailer = require('nodemailer');

// Create reusable transporter
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

const FROM = process.env.EMAIL_FROM || 'PAP Magazine <contact@pap-magazine.com>';
const FRONTEND_URL = process.env.NEXT_PUBLIC_URL || 'https://www.pap-magazine.com';

// ── Shared HTML wrapper ──
function wrapHtml(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;">
  <!-- Header -->
  <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #222;">
    <a href="${FRONTEND_URL}" style="color:#fff;font-size:28px;font-weight:700;letter-spacing:8px;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">PAP</a>
  </td></tr>
  <!-- Content -->
  <tr><td style="padding:32px 40px;color:#ccc;font-size:14px;line-height:1.7;">
    ${content}
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:24px 40px;border-top:1px solid #222;color:#666;font-size:11px;line-height:1.5;">
    &copy; ${new Date().getFullYear()} PAP Magazine. All rights reserved.<br>
    <a href="${FRONTEND_URL}" style="color:#888;text-decoration:none;">www.pap-magazine.com</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Email Templates ──

const templates = {
  // 1. Welcome email after signup
  welcome(user) {
    return {
      subject: 'Welcome to PAP Magazine',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Welcome, ${user.name || 'Creative'}.</h2>
        <p>Thank you for joining PAP Magazine — a platform for emerging fashion creatives.</p>
        <p>Here's what you can do now:</p>
        <table cellpadding="0" cellspacing="0" style="margin:20px 0;">
          <tr><td style="padding:8px 0;color:#ccc;">
            <strong style="color:#fff;">Submit Your Work</strong><br>
            <span style="color:#999;font-size:13px;">Share your editorial with our curation team</span>
          </td></tr>
          <tr><td style="padding:8px 0;color:#ccc;">
            <strong style="color:#fff;">Request a Pull-Letter</strong><br>
            <span style="color:#999;font-size:13px;">Borrow garments from designer showrooms</span>
          </td></tr>
          <tr><td style="padding:8px 0;color:#ccc;">
            <strong style="color:#fff;">Join the Community</strong><br>
            <span style="color:#999;font-size:13px;">Connect with photographers, stylists, and models</span>
          </td></tr>
        </table>
        <a href="${FRONTEND_URL}/submission.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">START SUBMITTING</a>
      `),
    };
  },

  // 2. Submission received confirmation
  submissionReceived(user, submission) {
    return {
      subject: `Submission Received: ${submission.title}`,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Submission Received</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>We've received your editorial submission <strong style="color:#fff;">"${submission.title}"</strong>.</p>
        <table style="margin:20px 0;width:100%;">
          <tr>
            <td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #fff;">
              <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Status</span><br>
              <span style="color:#fff;font-size:14px;font-weight:600;">Under Review</span>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #333;">
              <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Expected Response</span><br>
              <span style="color:#fff;font-size:14px;">1–3 business days</span>
            </td>
          </tr>
        </table>
        <p>Our editorial team will review your work carefully. You'll receive an email once a decision has been made.</p>
        <a href="${FRONTEND_URL}/submission.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">VIEW MY SUBMISSIONS</a>
      `),
    };
  },

  // 3. Submission approved
  submissionApproved(user, submission, note) {
    return {
      subject: `Congratulations! "${submission.title}" Accepted`,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Your Work Has Been Selected</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>We're pleased to inform you that <strong style="color:#fff;">"${submission.title}"</strong> has been accepted for publication on PAP Magazine.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #4CAF50;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Editor's Note</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <p>Your editorial will be prepared for publication. We'll notify you once it goes live.</p>
        <a href="${FRONTEND_URL}/submission.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">VIEW STATUS</a>
      `),
    };
  },

  // 4. Submission rejected
  submissionRejected(user, submission, note) {
    return {
      subject: `Update on "${submission.title}"`,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Submission Update</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Thank you for submitting <strong style="color:#fff;">"${submission.title}"</strong> to PAP Magazine.</p>
        <p>After careful review, our editorial team has decided not to move forward with this submission at this time.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #888;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Feedback</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <p>We encourage you to continue creating and submit again in the future.</p>
        <a href="${FRONTEND_URL}/submission.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">SUBMIT AGAIN</a>
      `),
    };
  },

  // 4b. Submission revision requested — editor wants the work resubmitted with changes
  submissionRevision(user, submission, note) {
    return {
      subject: `Revision requested: "${submission.title}"`,
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Revision Requested</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Thank you for submitting <strong style="color:#fff;">"${submission.title}"</strong> to PAP Magazine.</p>
        <p>Our editorial team has reviewed your work and would like to see a revised version before making a final publication decision. Please address the feedback below and resubmit.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #4A90E2;"><span style="color:#9ab7e6;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Editor's Feedback</span><br><span style="color:#ddd;font-size:14px;line-height:1.7;white-space:pre-line;">${note}</span></div>` : ''}
        <p>You can review the full status and your original submission in <strong style="color:#fff;">MY SUBMISSIONS</strong>, then resubmit your revised work using the same form.</p>
        <a href="${FRONTEND_URL}/submission.html#mySubsSection" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">VIEW & RESUBMIT</a>
        <p style="font-size:12px;color:#888;margin-top:24px;">Questions about the feedback? Reply to this email and we'll get back to you.</p>
      `),
    };
  },


  // 5. Pull-letter request received
  pullletterReceived(user) {
    return {
      subject: 'Pull-Letter Request Received',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Pull-Letter Request Received</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your pull-letter request has been received. Our team will review the availability of the requested pieces and coordinate with the relevant showrooms.</p>
        <table style="margin:20px 0;width:100%;">
          <tr><td style="padding:12px 16px;background:#1a1a1a;border-left:3px solid #fff;">
            <span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Status</span><br>
            <span style="color:#fff;font-size:14px;font-weight:600;">Processing</span>
          </td></tr>
        </table>
        <p>We'll reach out with next steps once the pull has been confirmed.</p>
      `),
    };
  },

  // 6. Pull-letter accepted
  pullletterAccepted(user, note) {
    return {
      subject: 'Pull-Letter Approved',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Pull-Letter Approved</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your pull-letter request has been approved. We will coordinate the delivery of the garments with the showroom.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #4CAF50;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Details</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <a href="${FRONTEND_URL}/pullletter.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">VIEW REQUESTS</a>
      `),
    };
  },

  // 7. Pull-letter rejected
  pullletterRejected(user, note) {
    return {
      subject: 'Pull-Letter Request Update',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Pull-Letter Update</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Unfortunately, we're unable to fulfill your pull-letter request at this time. This could be due to piece availability or scheduling conflicts.</p>
        ${note ? `<div style="margin:20px 0;padding:16px;background:#1a1a1a;border-left:3px solid #888;"><span style="color:#999;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Reason</span><br><span style="color:#ccc;font-size:14px;">${note}</span></div>` : ''}
        <p>Please feel free to submit a new request when you're ready.</p>
      `),
    };
  },

  // 8. Subscription confirmation
  subscriptionConfirmed(user, plan) {
    const planLabels = {
      standard_monthly: 'Standard (Monthly)',
      standard_yearly: 'Standard (Yearly)',
      premium_monthly: 'Premium (Monthly)',
      premium_yearly: 'Premium (Yearly)',
    };
    return {
      subject: 'Subscription Confirmed',
      html: wrapHtml(`
        <h2 style="color:#fff;font-size:20px;font-weight:600;margin:0 0 16px;">Subscription Active</h2>
        <p>Hi ${user.name || 'there'},</p>
        <p>Your <strong style="color:#fff;">${planLabels[plan] || plan}</strong> subscription is now active.</p>
        <p>You now have access to all subscriber-exclusive content and features.</p>
        <a href="${FRONTEND_URL}/subscribe.html" style="display:inline-block;background:#fff;color:#000;padding:12px 32px;font-size:12px;font-weight:700;letter-spacing:1px;text-decoration:none;margin-top:8px;">MANAGE SUBSCRIPTION</a>
      `),
    };
  },
};

// ── Send function ──
async function sendEmail(to, template) {
  // Skip if SMTP is not configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[EMAIL] SMTP not configured, skipping email to:', to);
    return { skipped: true };
  }

  try {
    const info = await getTransporter().sendMail({
      from: FROM,
      to,
      subject: template.subject,
      html: template.html,
    });
    console.log('[EMAIL] Sent:', template.subject, 'to:', to, 'id:', info.messageId);
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed:', error.message);
    // Don't throw — email failure shouldn't break the API
    return { sent: false, error: error.message };
  }
}

module.exports = { sendEmail, templates };
