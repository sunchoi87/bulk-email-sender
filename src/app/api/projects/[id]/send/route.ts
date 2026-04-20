import { getDb } from "@/lib/db";
import { sendHistory } from "@/lib/schema";
import { sendEmail, interpolateTemplate } from "@/lib/email";

export const maxDuration = 300;

interface Recipient {
  email: string;
  name: string;
  company: string;
  bcc?: string;
  customFields: Record<string, string>;
}

interface SendRequest {
  recipients: Recipient[];
  subject: string;
  body: string;
  senderName: string;
  globalBcc: string;
  attachments: Array<{
    filename: string;
    content: string;
    encoding: "base64";
  }>;
  isTest: boolean;
  testEmail: string;
  testBcc: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  try {
    const data: SendRequest = await request.json();
    const {
      recipients,
      subject,
      body,
      senderName,
      globalBcc,
      attachments,
      isTest,
      testEmail,
      testBcc,
    } = data;

    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return Response.json(
        { error: "Gmail credentials not configured" },
        { status: 500 }
      );
    }

    const results: Array<{
      email: string;
      success: boolean;
      error?: string;
    }> = [];

    if (isTest) {
      const firstRecipient = recipients[0];
      if (!firstRecipient) {
        return Response.json(
          { error: "No recipients to preview" },
          { status: 400 }
        );
      }

      const variables: Record<string, string> = {
        name: firstRecipient.name,
        email: firstRecipient.email,
        company: firstRecipient.company,
        ...firstRecipient.customFields,
      };

      const interpolatedSubject = interpolateTemplate(subject, variables);
      const interpolatedBody = interpolateTemplate(body, variables);

      try {
        await sendEmail({
          to: testEmail,
          bcc: testBcc || undefined,
          subject: `[TEST] ${interpolatedSubject}`,
          html: interpolatedBody,
          senderName,
          attachments,
        });
        results.push({ email: testEmail, success: true });

        // Save test send to history
        await getDb().insert(sendHistory).values({
          projectId,
          recipientEmail: `[TEST] ${testEmail}`,
          recipientName: firstRecipient.name,
          subject: `[TEST] ${interpolatedSubject}`,
          success: true,
        });
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        results.push({ email: testEmail, success: false, error: errorMsg });

        await getDb().insert(sendHistory).values({
          projectId,
          recipientEmail: `[TEST] ${testEmail}`,
          recipientName: firstRecipient.name,
          subject: `[TEST] ${interpolatedSubject}`,
          success: false,
          errorMessage: errorMsg,
        });
      }
    } else {
      for (const recipient of recipients) {
        const variables: Record<string, string> = {
          name: recipient.name,
          email: recipient.email,
          company: recipient.company,
          ...recipient.customFields,
        };

        const interpolatedSubject = interpolateTemplate(subject, variables);
        const interpolatedBody = interpolateTemplate(body, variables);

        const bccList = [globalBcc, recipient.bcc]
          .filter(Boolean)
          .join(", ");

        try {
          await sendEmail({
            to: recipient.email,
            bcc: bccList || undefined,
            subject: interpolatedSubject,
            html: interpolatedBody,
            senderName,
            attachments,
          });
          results.push({ email: recipient.email, success: true });

          await getDb().insert(sendHistory).values({
            projectId,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            subject: interpolatedSubject,
            success: true,
          });
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Unknown error";
          results.push({
            email: recipient.email,
            success: false,
            error: errorMsg,
          });

          await getDb().insert(sendHistory).values({
            projectId,
            recipientEmail: recipient.email,
            recipientName: recipient.name,
            subject: interpolatedSubject,
            success: false,
            errorMessage: errorMsg,
          });
        }

        if (recipients.indexOf(recipient) < recipients.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return Response.json({
      success: true,
      summary: {
        total: results.length,
        sent: successCount,
        failed: failCount,
      },
      results,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
