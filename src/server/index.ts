import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import { z } from "zod";
import {
  consumeInvitationIfSingleUse,
  ensureFoundryUser,
  ensureOAuthSourceConnection,
  findAvailableUsername,
  submitFoundryEnrollmentFlow,
  validateInvitation
} from "./authentik.js";
import { config } from "./config.js";
import { consumeGoogleState, createGoogleAuthorization, exchangeGoogleCode } from "./google.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, "../client");

const app = Fastify({
  logger: true
});

await app.register(cookie, {
  secret: config.SESSION_SECRET
});

await app.register(staticFiles, {
  root: clientRoot,
  prefix: "/"
});

const manualSignupSchema = z.object({
  itoken: z.string().uuid(),
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().email(),
  password: z.string().min(10).max(256),
  passwordRepeat: z.string().min(10).max(256)
}).refine((data) => data.password === data.passwordRepeat, {
  path: ["passwordRepeat"],
  message: "Passwords do not match"
});

const googleStartSchema = z.object({
  itoken: z.string().uuid()
});

function normalizeGoogleUsername(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .replace(/[_.-]{2,}/g, "-");

  return normalized.length >= 3 ? normalized : `user-${normalized || "google"}`;
}

function usernameFromGoogleProfile(input: { name?: string; email: string }): string {
  return normalizeGoogleUsername(input.name?.trim() || input.email.split("@")[0] || "google");
}

function authentikGoogleLoginUrl(): string {
  const loginUrl = new URL(`/source/oauth/login/${encodeURIComponent(config.AUTHENTIK_GOOGLE_SOURCE_SLUG)}/`, config.AUTHENTIK_BASE_URL);
  loginUrl.searchParams.set("next", config.AUTHENTIK_FOUNDRY_APP_URL);
  return loginUrl.toString();
}

app.get("/api/config", async () => ({
  foundryUrl: config.AUTHENTIK_FOUNDRY_APP_URL,
  googleEnabled: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI)
}));

app.post("/api/signup/manual", async (request, reply) => {
  const parsed = manualSignupSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_signup", issues: parsed.error.flatten().fieldErrors });
  }

  try {
    await validateInvitation(parsed.data.itoken);
  } catch (error) {
    request.log.warn({ error }, "Invalid authentik invitation");
    return reply.code(403).send({ error: "invalid_invite" });
  }

  try {
    await submitFoundryEnrollmentFlow({
      itoken: parsed.data.itoken,
      username: parsed.data.username,
      email: parsed.data.email,
      password: parsed.data.password,
      passwordRepeat: parsed.data.passwordRepeat
    });
  } catch (error) {
    request.log.error({
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : error
    }, "Foundry enrollment flow failed");
    return reply.code(502).send({ error: "enrollment_flow_failed" });
  }

  return reply.send({
    status: "confirmation_sent",
    message: "Account created. Check your email to confirm access to Foundry."
  });
});

app.post("/api/signup/google/start", async (request, reply) => {
  const parsed = googleStartSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_signup", issues: parsed.error.flatten().fieldErrors });
  }

  try {
    await validateInvitation(parsed.data.itoken);
  } catch (error) {
    request.log.warn({ error }, "Invalid authentik invitation");
    return reply.code(403).send({ error: "invalid_invite" });
  }

  return reply.send({
    redirectTo: createGoogleAuthorization(parsed.data.itoken)
  });
});

app.get("/api/oauth/google/callback", async (request, reply) => {
  const query = z.object({
    state: z.string().min(1),
    code: z.string().min(1)
  }).safeParse(request.query);

  if (!query.success) {
    return reply.redirect("/?error=google_callback_invalid");
  }

  const pending = consumeGoogleState(query.data.state);
  if (!pending) {
    return reply.redirect("/?error=google_state_expired");
  }

  let invitation;
  try {
    invitation = await validateInvitation(pending.itoken);
  } catch (error) {
    request.log.warn({ error }, "Invalid authentik invitation during Google callback");
    return reply.redirect("/?error=invalid_invite");
  }

  const googleUser = await exchangeGoogleCode(query.data.code);
  if (!googleUser.email_verified) {
    return reply.redirect("/?error=google_email_not_verified");
  }

  const username = await findAvailableUsername(usernameFromGoogleProfile(googleUser));
  const user = await ensureFoundryUser({
    username,
    email: googleUser.email,
    name: googleUser.name
  });
  await ensureOAuthSourceConnection({
    userId: user.pk,
    sourceSlug: config.AUTHENTIK_GOOGLE_SOURCE_SLUG,
    identifier: googleUser.sub,
    accessToken: googleUser.accessToken
  });

  await consumeInvitationIfSingleUse(invitation, pending.itoken);

  return reply.redirect(authentikGoogleLoginUrl());
});

app.setNotFoundHandler(async (request, reply) => {
  const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
  const path = request.url.split("?")[0];
  if (path.startsWith("/.") || path.startsWith("/api/") || !acceptsHtml) {
    return reply.code(404).send({ error: "not_found" });
  }

  return reply.sendFile("index.html");
});

await app.listen({
  host: "0.0.0.0",
  port: config.PORT
});
