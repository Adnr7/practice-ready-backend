import { createClearSessionCookie, revokeSessionFromRequest } from "@/lib/auth";

export async function POST(request: Request) {
  const headers = { "Set-Cookie": createClearSessionCookie(new URL(request.url).protocol === "https:") };
  try {
    await revokeSessionFromRequest(request);
    return Response.json({ success: true }, { headers });
  } catch {
    // Retain the cookie on failure so a retry can still identify and revoke it.
    return Response.json({ error: "Unable to revoke session. Please retry logout." }, { status: 500 });
  }
}
