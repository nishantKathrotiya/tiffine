import { handleApiRoute, parseOrThrow, readJson } from "@/lib/api/response";
import { signUpSchema } from "@/lib/schemas/auth";
import { signUp } from "@/lib/services/auth-service";

export const POST = handleApiRoute(async (request) => {
  const input = parseOrThrow(signUpSchema, await readJson(request));

  const result = await signUp({
    email: input.email,
    password: input.password,
    name: input.name,
  });

  return {
    personId: result.personId,
    accountStatus: result.accountStatus,
    // New accounts are always pending, so the UI can explain the wait rather
    // than dropping the person on a dashboard they cannot act on.
    message:
      "Account created. An admin needs to approve you before you can place orders — you can look around in the meantime.",
  };
});
