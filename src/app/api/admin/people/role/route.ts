import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { setAdminRoleSchema } from "@/lib/schemas/people";
import { setAdminRole } from "@/lib/services/people-service";
import { requireViewer } from "@/lib/auth/session";

export const POST = handleApiRoute(async (request) => {
  const viewer = await requireViewer();
  const input = parseOrThrow(setAdminRoleSchema, await readJson(request));

  // Promote is open to any admin; demote is owner-only. Both rules live in
  // permissions.ts and are enforced here, not in the UI.
  await setAdminRole(viewer, input.personId, input.isAdmin);
  return { updated: true };
});
