import { getDb } from "@/lib/db";
import { projects } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [project] = await getDb()
    .select()
    .from(projects)
    .where(eq(projects.id, id));
  if (!project) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(project);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await request.json();
  const [updated] = await getDb()
    .update(projects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await getDb().delete(projects).where(eq(projects.id, id));
  return Response.json({ success: true });
}
