import { getDb } from "@/lib/db";
import { sendHistory } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const list = await getDb()
    .select()
    .from(sendHistory)
    .where(eq(sendHistory.projectId, id))
    .orderBy(desc(sendHistory.sentAt));
  return Response.json(list);
}
