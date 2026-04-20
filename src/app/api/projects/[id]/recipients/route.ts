import { getDb } from "@/lib/db";
import { recipients } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const list = await getDb()
    .select()
    .from(recipients)
    .where(eq(recipients.projectId, id))
    .orderBy(recipients.createdAt);
  return Response.json(list);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { recipients: recipientList } = await request.json();

  if (!Array.isArray(recipientList) || recipientList.length === 0) {
    return Response.json({ error: "수신자 데이터 필요" }, { status: 400 });
  }

  const values = recipientList.map(
    (r: {
      email: string;
      name?: string;
      company?: string;
      bcc?: string;
      customFields?: Record<string, string>;
    }) => ({
      projectId: id,
      email: r.email,
      name: r.name || "",
      company: r.company || "",
      bcc: r.bcc || "",
      customFields: r.customFields || {},
    })
  );

  const inserted = await getDb().insert(recipients).values(values).returning();
  return Response.json(inserted);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { recipientIds } = await request.json();

  if (recipientIds && Array.isArray(recipientIds)) {
    // Delete specific recipients
    for (const rid of recipientIds) {
      await getDb().delete(recipients).where(eq(recipients.id, rid));
    }
  } else {
    // Delete all recipients for project
    await getDb().delete(recipients).where(eq(recipients.projectId, id));
  }
  return Response.json({ success: true });
}
