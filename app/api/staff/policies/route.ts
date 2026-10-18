import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { FrontendWorkflowError, readJson, requireAdmin, workflowErrorResponse } from "@/lib/frontend-workflows";
import { normalizeEndMinutes, timeToMinutes } from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireAdmin({ userId: session.userId, role: session.role });
    const policies = await getDb().$client.prepare(`
      SELECT id, version, slot_minutes AS slotMinutes, minimum_minutes AS minimumMinutes,
        maximum_minutes AS maximumMinutes, advance_days AS advanceDays,
        opening_time AS openingTime, closing_time AS closingTime,
        cancellation_cutoff_minutes AS cancellationCutoffMinutes,
        equipment_handling AS equipmentHandling, movement_rules AS movementRules,
        published_at AS publishedAt, published_by_user_id AS publishedByUserId, is_current AS isCurrent
      FROM booking_policies ORDER BY id DESC
    `).all();
    return Response.json({ policies: policies.results });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireAdmin({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    const version = typeof body.version === "string" ? body.version.trim() : "";
    if (!version) throw new FrontendWorkflowError("Policy version is required.", 400, "POLICY_VERSION_REQUIRED");
    const requiredStrings = ["equipmentHandling", "movementRules"] as const;
    if (requiredStrings.some((key) => typeof body[key] !== "string" || !(body[key] as string).trim())) throw new FrontendWorkflowError("Policy equipment and movement rules are required.", 400, "POLICY_RULES_REQUIRED");
    const slotMinutes = Number(body.slotMinutes ?? 30);
    const minimumMinutes = Number(body.minimumMinutes ?? 30);
    const maximumMinutes = Number(body.maximumMinutes ?? 180);
    const advanceDays = Number(body.advanceDays ?? 14);
    const cancellationCutoffMinutes = Number(body.cancellationCutoffMinutes ?? 0);
    const openingTime = String(body.openingTime ?? "00:00");
    const closingTime = String(body.closingTime ?? "00:00");
    if (slotMinutes !== 30 || ![minimumMinutes, maximumMinutes, advanceDays, cancellationCutoffMinutes].every((value) => Number.isSafeInteger(value) && value >= 0) || minimumMinutes < slotMinutes || maximumMinutes < minimumMinutes || minimumMinutes % 30 !== 0 || maximumMinutes % 30 !== 0 || advanceDays > 365 || cancellationCutoffMinutes > 10080 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(openingTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closingTime)) {
      throw new FrontendWorkflowError("Policy numeric values or operating times are invalid.", 400, "POLICY_VALUES_INVALID");
    }
    if (maximumMinutes > 1440 || timeToMinutes(openingTime) % 30 !== 0 || normalizeEndMinutes(closingTime) % 30 !== 0 || normalizeEndMinutes(closingTime) <= timeToMinutes(openingTime)) {
      throw new FrontendWorkflowError("Operating hours must be aligned to the 30-minute grid and end after opening.", 400, "POLICY_VALUES_INVALID");
    }
    const db = getDb().$client;
    const current = await db.prepare("SELECT id FROM booking_policies WHERE version = ? LIMIT 1").bind(version).first();
    if (current) throw new FrontendWorkflowError("That policy version already exists.", 409, "POLICY_VERSION_EXISTS");
    await db.batch([
      db.prepare("UPDATE booking_policies SET is_current = 0 WHERE is_current = 1"),
      db.prepare(`
        INSERT INTO booking_policies (version, slot_minutes, minimum_minutes, maximum_minutes, advance_days, opening_time, closing_time, cancellation_cutoff_minutes, equipment_handling, movement_rules, published_by_user_id, is_current)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(
         version, slotMinutes, minimumMinutes, maximumMinutes,
         advanceDays, openingTime, closingTime,
         cancellationCutoffMinutes, (body.equipmentHandling as string).trim(), (body.movementRules as string).trim(), session.userId,
       ),
      db.prepare("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,reason,details) SELECT ?,'published','booking_policy',CAST(last_insert_rowid() AS TEXT),?,? WHERE changes()=1")
        .bind(session.userId, `Published policy ${version}`, JSON.stringify({ version, minimumMinutes, maximumMinutes, advanceDays, openingTime, closingTime, cancellationCutoffMinutes })),
    ]);
    const policy = await db.prepare("SELECT id, version, is_current AS isCurrent, published_at AS publishedAt FROM booking_policies WHERE version = ? LIMIT 1").bind(version).first();
    return Response.json({ policy }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
