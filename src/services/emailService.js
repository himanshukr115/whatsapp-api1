// src/services/emailService.js
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const from = `"${process.env.SMTP_FROM_NAME || 'FlowGram'}" <${process.env.SMTP_FROM || 'noreply@flowgram.in'}>`;

const baseTemplate = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px}
  .container{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#7c5cfc,#9333ea);padding:32px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:24px;font-weight:700}
  .header p{color:rgba(255,255,255,.8);margin:8px 0 0;font-size:14px}
  .body{padding:32px}
  .body p{color:#444;line-height:1.7;margin:0 0 16px}
  .btn{display:inline-block;background:#7c5cfc;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0}
  .footer{background:#f9f9f9;padding:20px 32px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee}
</style></head><body>
<div class="container">
  <div class="header"><h1>⚡ FlowGram</h1><p>Instagram Automation Platform</p></div>
  <div class="body">${content}</div>
  <div class="footer">FlowGram · <a href="${process.env.APP_URL}" style="color:#7c5cfc">flowgram.in</a> · You received this because you signed up for FlowGram.</div>
</div></body></html>`;

async function send(to, subject, html) {
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      logger.warn('SMTP not configured, skipping email', {
        to,
        subject,
        hasHost: !!process.env.SMTP_HOST,
        hasUser: !!process.env.SMTP_USER,
        hasPass: !!process.env.SMTP_PASS,
      });
      return false;
    }
    await transporter.sendMail({ from, to, subject, html });
    logger.info('Email sent', { to, subject });
    return true;
  } catch (err) {
    logger.error('Email send error', { error: err.message, to, subject });
    return false;
  }
}

exports.sendVerificationEmail = (email, name, token) => {
  const url = `${process.env.APP_URL}/auth/verify/${token}`;
  return send(email, 'Verify your FlowGram email', baseTemplate(`
    <p>Hi <strong>${name}</strong>,</p>
    <p>Welcome to FlowGram! Please verify your email address to get started.</p>
    <p><a href="${url}" class="btn">Verify Email Address</a></p>
    <p>This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
  `));
};

exports.sendPasswordResetEmail = (email, name, token) => {
  const url = `${process.env.APP_URL}/auth/reset-password/${token}`;
  return send(email, 'Reset your FlowGram password', baseTemplate(`
    <p>Hi <strong>${name}</strong>,</p>
    <p>Someone requested a password reset for your account. Click below to reset it.</p>
    <p><a href="${url}" class="btn">Reset Password</a></p>
    <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
  `));
};

exports.sendPaymentReceipt = (email, name, planName, amount, cycle, paymentId) => {
  return send(email, `Payment Receipt — FlowGram ${planName} Plan`, baseTemplate(`
    <p>Hi <strong>${name}</strong>,</p>
    <p>Thank you for your payment! Your subscription has been activated.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0">
      <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Plan</td><td style="padding:10px 0;font-weight:600">${planName}</td></tr>
      <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Amount</td><td style="padding:10px 0;font-weight:600">₹${amount}</td></tr>
      <tr style="border-bottom:1px solid #eee"><td style="padding:10px 0;color:#888">Billing</td><td style="padding:10px 0;font-weight:600">${cycle}</td></tr>
      <tr><td style="padding:10px 0;color:#888">Payment ID</td><td style="padding:10px 0;font-family:monospace;font-size:13px">${paymentId || 'N/A'}</td></tr>
    </table>
    <p><a href="${process.env.APP_URL}/billing" class="btn">View Billing</a></p>
  `));
};

exports.sendWelcomeEmail = (email, name) => {
  return send(email, `Welcome to FlowGram, ${name}!`, baseTemplate(`
    <p>Hi <strong>${name}</strong>,</p>
    <p>Welcome to FlowGram! You're all set to start automating your Instagram.</p>
    <p>Here's what you can do:</p>
    <ul style="color:#444;line-height:2">
      <li>Create keyword-triggered automation flows</li>
      <li>Auto-reply to DMs and comments</li>
      <li>Track your performance with analytics</li>
    </ul>
    <p><a href="${process.env.APP_URL}/dashboard" class="btn">Go to Dashboard</a></p>
  `));
};
