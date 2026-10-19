import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    const pattern = `%${query}%`;
    const students = await getDb().$client.prepare(`
      SELECT id, email, full_name AS fullName, student_id AS studentId, phone, created_at AS createdAt
      FROM users WHERE role = 'student' AND is_active = 1 AND (full_name LIKE ? OR email LIKE ? OR COALESCE(student_id, '') LIKE ?)
      ORDER BY full_name LIMIT 100
    `).bind(pattern, pattern, pattern).all();
    return Response.json({ students: students.results });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
