import { z } from "zod";

export const REPORT_CATEGORIES = ["equipment", "room", "assistance"] as const;
export const REPORT_STATUSES = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "closed",
  "reopened",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const positiveId = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value),
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
);

export const createReportSchema = z
  .object({
    category: z.enum(REPORT_CATEGORIES),
    equipmentId: positiveId.optional(),
    roomId: positiveId.optional(),
    locationId: positiveId.optional(),
    bookingId: positiveId.optional(),
    issueType: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(4_000),
    attachmentIds: z.array(z.number().int().positive()).max(3).optional(),
  })
  .superRefine((value, context) => {
    if (value.category === "room" && value.roomId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roomId"],
        message: "roomId is required for a room report.",
      });
    }

    if ((value.category === "equipment" || value.category === "room") && !value.issueType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["issueType"],
        message: "issueType is required for equipment and room reports.",
      });
    }
  });

export const updateReportSchema = z
  .object({
    status: z.enum(REPORT_STATUSES).optional(),
    message: z.string().trim().min(1).max(4_000).optional(),
  })
  .refine((value) => value.status !== undefined || value.message !== undefined, {
    message: "Provide a status or message to record an update.",
  });
