import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export interface EmailPayload {
  to: string;
  bcc?: string;
  subject: string;
  html: string;
  senderName: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    encoding: "base64";
  }>;
}

export async function sendEmail(payload: EmailPayload) {
  const { to, bcc, subject, html, senderName, attachments } = payload;

  const result = await transporter.sendMail({
    from: `"${senderName}" <${process.env.GMAIL_USER}>`,
    to,
    bcc: bcc || undefined,
    subject,
    html,
    attachments: attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      encoding: a.encoding,
    })),
  });

  return result;
}

export function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}
