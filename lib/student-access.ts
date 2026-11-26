"use client";

// API-backed student access store. The backend is the source of truth for
// incidents, restrictions, late-return candidates and account deletion.
// This module keeps a synchronously readable cache for component render
// paths and refreshes it from /api/ats/access.

import { isRestrictionPreview, previewStudent, appStorage } from "@/lib/preview-storage";
import {
  fetchStudentAccess,
  recordIncident as apiRecordIncident,
  liftRestriction as apiLiftRestriction,
  deleteStudentAccount as apiDeleteStudentAccount,
  fetchStaffStudentsSafe,
  type AccessIncident,
  type AccessRestriction,
  type LateReturnCandidateData,
} from "@/lib/api-client";

export const STUDENTS_KEY = "practice-ready-students-v1";
export const ACCESS_KEY = "practice-ready-student-access-v1";
export const ACCESS_EVENT = "practice-ready-student-access-changed";

export type Student = {
  id?: number;
  name: string;
  email: string;
  phone: string;
  auth?: { salt: string; digest: string };
  guidelinesAcceptance?: unknown;
  deletedAt?: string;
  deletedBy?: string;
  deletionReason?: string;
};

export type IncidentKind = "no-show" | "unreported-damage" | "late-return";

export type Incident = {
  id: string;
  email: string;
  kind: IncidentKind;
  reference: string;
  description: string;
  explanation: string;
  decision: "confirmed" | "justified";
  review: string;
  at: string;
  by: string;
};

export type Restriction = {
  scope?: "equipment" | "facilities";
  id: string;
  email: string;
  reason: string;
  start: string;
  end: string;
  by: string;
  at: string;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
};

export type LateReturnCandidate = LateReturnCandidateData & { email?: string };

export type AccessData = {
  incidents: Incident[];
  restrictions: Restriction[];
  lateReturns: LateReturnCandidate[];
};

export const normalEmail = (v: string) => v.trim().toLowerCase();

function incidentFromApi(value: AccessIncident): Incident {
  return {
    id: String(value.id),
    email: value.email,
    kind: value.kind,
    reference: value.reference,
    description: value.description,
    explanation: value.explanation,
    decision: value.decision,
    review: value.review,
    at: value.createdAt,
    by: value.recordedBy,
  };
}

function restrictionFromApi(value: AccessRestriction): Restriction {
  return {
    scope: value.scope,
    id: String(value.id),
    email: value.email,
    reason: value.reason,
    start: value.startsAt,
    end: value.endsAt,
    by: value.createdBy,
    at: value.createdAt,
    ...(value.liftedAt
      ? { revokedAt: value.liftedAt, revokedBy: value.liftedBy ?? "", revocationReason: value.liftReason ?? "" }
      : {}),
  };
}

// ---- Synchronous cache hydrated from the backend ----

const emptyAccess: AccessData = { incidents: [], restrictions: [], lateReturns: [] };
let cachedAccess: AccessData = emptyAccess;
let cachedStudents: Student[] = [];
let accessInFlight: Promise<void> | null = null;
let studentsInFlight: Promise<void> | null = null;

function previewAccessData(): AccessData {
  try {
    const raw = appStorage().getItem(ACCESS_KEY);
    if (!raw) return emptyAccess;
    const parsed = JSON.parse(raw) as Partial<AccessData>;
    return {
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      restrictions: Array.isArray(parsed.restrictions) ? parsed.restrictions : [],
      lateReturns: [],
    };
  } catch {
    return emptyAccess;
  }
}

export function accessData(): AccessData {
  if (isRestrictionPreview()) return previewAccessData();
  return cachedAccess;
}

export function students(): Student[] {
  if (isRestrictionPreview()) return [previewStudent];
  return cachedStudents;
}

export function emitAccess() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ACCESS_EVENT));
}

/** Hydrates the cache from the backend. Students receive their own records; staff receive everyone's. */
export async function refreshAccess(): Promise<void> {
  if (accessInFlight) return accessInFlight;
  accessInFlight = (async () => {
    try {
      const data = await fetchStudentAccess();
      if (!data) return;
      cachedAccess = {
        incidents: (data.incidents ?? []).map(incidentFromApi),
        restrictions: (data.restrictions ?? []).map(restrictionFromApi),
        lateReturns: (data.lateReturns ?? []).map((candidate) => ({
          ...candidate,
          email: cachedStudents.find((student) => student.id === candidate.userId)?.email,
        })),
      };
      emitAccess();
    } finally {
      accessInFlight = null;
    }
  })();
  return accessInFlight;
}

/** Staff-only: hydrate the registered-student directory used by review screens. */
export async function refreshStudents(query = ""): Promise<void> {
  if (studentsInFlight) return studentsInFlight;
  studentsInFlight = (async () => {
    try {
      const list = await fetchStaffStudentsSafe(query);
      if (!list) return;
      cachedStudents = list.map((user) => ({
        id: user.id,
        name: user.fullName,
        email: user.email,
        phone: user.phone ?? "",
        ...(user.deletedAt ? { deletedAt: user.deletedAt, deletionReason: user.deletionReason ?? "" } : {}),
      }));
      emitAccess();
    } finally {
      studentsInFlight = null;
    }
  })();
  return studentsInFlight;
}

let currentUser: Student | null = null;
export function setAuthenticatedStudent(user: Student | null): void {
  currentUser = user;
  emitAccess();
}

export function currentStudent(): Student {
  if (isRestrictionPreview()) return previewStudent;
  if (currentUser) return currentUser;
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("practice-ready-sample-session-v1") === "sample") {
    return { name: "Student", email: "", phone: "" };
  }
  return { name: "Student", email: "", phone: "" };
}

// Legacy local-account helpers. Accounts are database-backed now; these are
// compatibility no-ops so existing component code keeps working.
export function rememberStudent(_student: Student): void {}
export function migrateStudent(): void {}

export function warningCount(email: string, kind: IncidentKind, data: AccessData = accessData()): number {
  return data.incidents.filter(
    (i) => i.email === normalEmail(email) && i.kind === kind && i.decision === "confirmed",
  ).length;
}

export function activeRestriction(email: string, now = Date.now(), data: AccessData = accessData()): Restriction | undefined {
  return data.restrictions.find(
    (r) => r.email === normalEmail(email) && !r.revokedAt && Date.parse(r.start) <= now && Date.parse(r.end) > now,
  );
}

export function accessIssue(email = currentStudent().email, now = Date.now()): string {
  const student = students().find((s) => s.email === normalEmail(email));
  if (student?.deletedAt) return "This account was deleted by ATS. Contact ATS for assistance.";
  const restriction = accessData().restrictions.find(
    (r) => r.email === normalEmail(email) && r.scope !== "equipment" && !r.revokedAt && Date.parse(r.start) <= now && Date.parse(r.end) > now,
  );
  return restriction
    ? `TSM facility access is restricted until ${new Date(restriction.end).toLocaleString("en-GB")}. You can review the reason and contact ATS in Reports & Support.`
    : "";
}

export function incidentLabel(kind: IncidentKind): string {
  return kind === "no-show" ? "No-show" : kind === "late-return" ? "Late equipment return" : "Unreported equipment damage";
}

export function equipmentMoveIssue(email = currentStudent().email, now = Date.now()): string {
  const issue = accessIssue(email, now);
  if (issue) return issue;
  const restriction = accessData().restrictions.find(
    (r) => r.email === normalEmail(email) && r.scope === "equipment" && !r.revokedAt && Date.parse(r.start) <= now && Date.parse(r.end) > now,
  );
  return restriction
    ? `New equipment moves are restricted until ${new Date(restriction.end).toLocaleString("en-GB")}. Returns and room bookings remain available.`
    : "";
}

export function lateReturnCandidates(email: string, data: AccessData = accessData()): LateReturnCandidate[] {
  if (isRestrictionPreview()) return [];
  const target = normalEmail(email);
  return data.lateReturns.filter((candidate) => {
    if (candidate.email) return candidate.email === target;
    const owner = cachedStudents.find((student) => student.id === candidate.userId);
    return owner ? normalEmail(owner.email) === target : false;
  });
}

export async function recordIncident(
  input: Omit<Incident, "id" | "at" | "email"> & { email: string },
  period?: { start: string; end: string },
  _now = Date.now(),
): Promise<void> {
  const student = students().find((s) => s.email === normalEmail(input.email));
  if (!student?.id) throw Error("Choose an active student account.");
  const result = await apiRecordIncident({
    userId: student.id,
    kind: input.kind,
    reference: input.reference,
    description: input.description,
    explanation: input.explanation,
    decision: input.decision,
    review: input.review,
    ...(input.decision === "confirmed" && warningCount(input.email, input.kind) + 1 >= 3 && period
      ? { restrictionStartsAt: period.start, restrictionEndsAt: period.end }
      : {}),
  });
  if (!result.success) throw Error(result.error ?? "Could not record the incident.");
  await refreshAccess();
}

export async function liftRestriction(id: string, by: string, reason: string): Promise<void> {
  if (reason.trim().length < 5) throw Error("Explain why the restriction is being lifted.");
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) throw Error("This restriction is no longer active.");
  const result = await apiLiftRestriction(numericId, reason);
  if (!result.success) throw Error(result.error ?? "Could not lift the restriction.");
  await refreshAccess();
}

export async function deleteStudent(email: string, _by: string, reason: string): Promise<void> {
  email = normalEmail(email);
  if (reason.trim().length < 5) throw Error("Enter the reason for account deletion.");
  const student = students().find((s) => s.email === email);
  if (!student?.id) throw Error("This account is no longer active.");
  const result = await apiDeleteStudentAccount(student.id, reason);
  if (!result.success) throw Error(result.error ?? "Could not delete the account.");
  await Promise.all([refreshAccess(), refreshStudents()]);
}

export function canManageSession(
  r: { ownerEmail?: string; sample?: boolean },
  email = currentStudent().email,
): boolean {
  return !r.sample && !!email && (!r.ownerEmail || normalEmail(r.ownerEmail) === normalEmail(email));
}

export function belongsToStudent(
  r: { ownerEmail?: string; participants?: { email: string; status: string }[] },
  email = currentStudent().email,
): boolean {
  return (
    !r.ownerEmail ||
    normalEmail(r.ownerEmail) === normalEmail(email) ||
    !!r.participants?.some((p) => p.email === normalEmail(email) && p.status === "accepted")
  );
}
