import { getDb } from "@/lib/db";
import { projects } from "@/lib/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const list = await getDb()
    .select()
    .from(projects)
    .orderBy(desc(projects.updatedAt));
  return Response.json(list);
}

export async function POST(request: Request) {
  const { name, senderName, globalBcc } = await request.json();
  if (!name?.trim()) {
    return Response.json({ error: "프로젝트 이름 필요" }, { status: 400 });
  }
  const [project] = await getDb()
    .insert(projects)
    .values({
      name: name.trim(),
      senderName: senderName || "Sun Choi",
      globalBcc: globalBcc || "",
    })
    .returning();
  return Response.json(project);
}
