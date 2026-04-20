import { getDb } from "@/lib/db";
import { templates } from "@/lib/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const list = await getDb()
    .select()
    .from(templates)
    .orderBy(desc(templates.createdAt));
  return Response.json(list);
}

export async function POST(request: Request) {
  const { name, subject, body } = await request.json();
  if (!name?.trim()) {
    return Response.json({ error: "템플릿 이름 필요" }, { status: 400 });
  }
  const [template] = await getDb()
    .insert(templates)
    .values({ name: name.trim(), subject: subject || "", body: body || "" })
    .returning();
  return Response.json(template);
}

export async function DELETE(request: Request) {
  const { id } = await request.json();
  if (!id) {
    return Response.json({ error: "ID 필요" }, { status: 400 });
  }
  await getDb().delete(templates).where(eq(templates.id, id));
  return Response.json({ success: true });
}
