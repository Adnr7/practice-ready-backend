/** Translate transaction-enforced invariants to useful conflict responses. */
export function operationalConflictResponse(error: unknown): Response | null {
  const messages: string[] = [];
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    messages.push(cause.message);
    cause = cause.cause;
  }
  const message = messages.join(" ");
  const conflicts: Array<[string, string]> = [
    ["BOOKING_OVERLAP", "The room or this student's schedule already has an overlapping reservation."],
    ["BOOKING_ROOM_CLOSED", "The room is closed during this reservation window."],
    ["BOOKING_ROOM_UNAVAILABLE", "The room is inactive or closed."],
    ["ROOM_CLOSURE_BOOKING_CONFLICT", "Resolve overlapping reservations before publishing the closure."],
    ["ROOM_CLOSURE_OVERLAP", "An active closure already overlaps this window."],
  ];
  for (const [code, explanation] of conflicts) {
    if (message.includes(code)) return Response.json({ error: explanation, code }, { status: 409 });
  }
  if (/UNIQUE constraint failed: repair_jobs.equipment_id/.test(message)) {
    return Response.json({ error: "This equipment already has an open repair.", code: "REPAIR_ALREADY_OPEN" }, { status: 409 });
  }
  return null;
}
