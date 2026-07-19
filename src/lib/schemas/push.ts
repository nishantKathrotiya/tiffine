import { z } from "zod";

/** Push subscription payloads from the browser's PushManager. */

export const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url("Invalid push endpoint."),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
});

export const unsubscribeSchema = z.object({
  endpoint: z.string().url("Invalid push endpoint."),
});
