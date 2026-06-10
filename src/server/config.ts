import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: z.string().url(),
  AUTHENTIK_BASE_URL: z.string().url(),
  AUTHENTIK_API_TOKEN: z.string().min(1),
  AUTHENTIK_INVITE_FLOW_SLUG: z.string().default("foundry-enrollment"),
  AUTHENTIK_FOUNDRY_GROUP_NAME: z.string().default("foundry-users"),
  AUTHENTIK_FOUNDRY_USER_PATH: z.string().default("users/foundry"),
  AUTHENTIK_FOUNDRY_APP_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  AUTHENTIK_GOOGLE_SOURCE_SLUG: z.string().default("google"),
  SESSION_SECRET: z.string().min(24)
});

export const config = envSchema.parse(process.env);
