import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { settlementPeriodSchema } from "@/lib/schemas/settlement";
import { findUnbilledGaps, previewSettlement } from "@/lib/services/settlement-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(settlementPeriodSchema, await readJson(request));

  const preview = await previewSettlement(viewer, input);
  // Surfaced alongside the preview so a skipped day is as visible as a
  // double-billed one.
  const gaps = await findUnbilledGaps(viewer, input);

  return { ...preview, unbilledGaps: gaps };
});
