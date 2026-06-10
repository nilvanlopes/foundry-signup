import { config } from "./config.js";

type AuthentikList<T> = {
  results?: T[];
};

type AuthentikGroup = {
  pk: string;
  name: string;
};

type AuthentikUser = {
  pk: number | string;
  username: string;
  email: string;
  groups?: Array<string | { pk: string }>;
};

type AuthentikSource = {
  pk: string;
  slug: string;
  name: string;
};

type AuthentikSourceConnection = {
  pk: string;
  user: number | string;
  source: string;
  identifier: string;
};

type AuthentikInvitation = {
  pk?: string;
  invite_uuid?: string;
  name: string;
  expires?: string | null;
  expiring?: boolean;
  single_use?: boolean;
  flow?: string | {
    pk?: string;
    slug?: string;
    name?: string;
  } | null;
};

type FlowExecutorResponse = {
  component?: string;
  flow_info?: {
    title?: string;
    slug?: string;
  };
  response_errors?: Record<string, string[]>;
  non_field_errors?: string[];
  to?: string;
  [key: string]: unknown;
};

type CookieJar = Map<string, string>;

async function authentikFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, config.AUTHENTIK_BASE_URL), {
    ...init,
    headers: {
      "authorization": `Bearer ${config.AUTHENTIK_API_TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`authentik ${response.status} ${response.statusText}: ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function authentikPublicFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, config.AUTHENTIK_BASE_URL), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

async function authentikPublicFetchWithCookies(
  path: string,
  jar: CookieJar,
  init: RequestInit = {}
): Promise<Response> {
  let nextPath = path;
  let nextInit = init;
  let redirects = 0;

  while (true) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(nextInit.headers).entries())
    };
    const cookies = cookieHeader(jar);
    if (cookies) {
      headers.cookie = cookies;
    }

    const response = await fetch(new URL(nextPath, config.AUTHENTIK_BASE_URL), {
      ...nextInit,
      redirect: "manual",
      headers
    });
    updateCookieJar(jar, response.headers);

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    redirects += 1;
    if (redirects > 10) {
      throw new Error(`Too many Authentik redirects while fetching ${path}`);
    }

    const nextUrl = new URL(location, config.AUTHENTIK_BASE_URL);
    nextPath = `${nextUrl.pathname}${nextUrl.search}`;
    if ([301, 302, 303].includes(response.status)) {
      nextInit = {
        method: "GET"
      };
    }
  }
}

function cookieNameValue(setCookie: string): [string, string] | null {
  const firstPart = setCookie.split(";")[0];
  const separator = firstPart.indexOf("=");
  if (separator === -1) {
    return null;
  }

  return [firstPart.slice(0, separator), firstPart.slice(separator + 1)];
}

function getSetCookies(headers: Headers): string[] {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof maybeHeaders.getSetCookie === "function") {
    return maybeHeaders.getSetCookie();
  }

  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

function updateCookieJar(jar: CookieJar, headers: Headers) {
  for (const setCookie of getSetCookies(headers)) {
    const parsed = cookieNameValue(setCookie);
    if (parsed) {
      jar.set(parsed[0], parsed[1]);
    }
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function getCsrfToken(jar: CookieJar): string | undefined {
  return jar.get("authentik_csrf") ?? jar.get("csrftoken");
}

function invitationPrimaryKey(invitation: AuthentikInvitation, fallback: string): string {
  return invitation.pk ?? invitation.invite_uuid ?? fallback;
}

function invitationFlowMatches(invitation: AuthentikInvitation): boolean {
  if (!invitation.flow) {
    return true;
  }

  if (typeof invitation.flow === "string") {
    const looksLikePk = /^[0-9a-f-]{32,36}$/i.test(invitation.flow);
    return invitation.flow === config.AUTHENTIK_INVITE_FLOW_SLUG || looksLikePk;
  }

  return invitation.flow.slug === config.AUTHENTIK_INVITE_FLOW_SLUG || !invitation.flow.slug;
}

function parseFlowResponse(bodyText: string): FlowExecutorResponse {
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText) as FlowExecutorResponse;
  } catch {
    return {
      component: "ak-stage-error",
      non_field_errors: [bodyText]
    };
  }
}

function flowHasErrors(body: FlowExecutorResponse): boolean {
  return Boolean(
    body.non_field_errors?.length ||
    body.response_errors && Object.keys(body.response_errors).length > 0 ||
    body.component === "ak-stage-access-denied"
  );
}

async function submitFlowStage(
  executorPath: string,
  jar: CookieJar,
  payload: Record<string, unknown>
): Promise<FlowExecutorResponse> {
  const csrfToken = getCsrfToken(jar);
  const submitHeaders: Record<string, string> = {};
  if (csrfToken) {
    submitHeaders["x-csrftoken"] = csrfToken;
  }

  const response = await authentikPublicFetchWithCookies(executorPath, jar, {
    method: "POST",
    headers: submitHeaders,
    body: JSON.stringify(payload)
  });
  const bodyText = await response.text();
  const body = parseFlowResponse(bodyText);

  if (!response.ok || flowHasErrors(body)) {
    throw new Error(`Flow submit failed: ${response.status} ${bodyText}`);
  }

  return body;
}

export async function validateInvitation(itoken: string): Promise<AuthentikInvitation> {
  const invitation = await authentikFetch<AuthentikInvitation>(
    `/api/v3/stages/invitation/invitations/${encodeURIComponent(itoken)}/`
  );

  if (invitation.expires && new Date(invitation.expires).getTime() <= Date.now()) {
    throw new Error("Invitation is expired");
  }

  if (!invitationFlowMatches(invitation)) {
    throw new Error(`Invitation is not bound to flow ${config.AUTHENTIK_INVITE_FLOW_SLUG}`);
  }

  return invitation;
}

export async function consumeInvitationIfSingleUse(invitation: AuthentikInvitation, itoken: string): Promise<void> {
  if (!invitation.single_use) {
    return;
  }

  await authentikFetch(`/api/v3/stages/invitation/invitations/${encodeURIComponent(invitationPrimaryKey(invitation, itoken))}/`, {
    method: "DELETE"
  });
}

export async function submitFoundryEnrollmentFlow(input: {
  itoken: string;
  username: string;
  email: string;
  password: string;
  passwordRepeat: string;
}): Promise<FlowExecutorResponse> {
  const jar: CookieJar = new Map();
  const flowPath = `/api/v3/flows/executor/${encodeURIComponent(config.AUTHENTIK_INVITE_FLOW_SLUG)}/`;
  const query = new URLSearchParams({ query: `itoken=${input.itoken}` });
  const executorPath = `${flowPath}?${query}`;

  const initial = await authentikPublicFetchWithCookies(executorPath, jar);
  if (!initial.ok) {
    throw new Error(`Flow start failed: ${initial.status} ${await initial.text()}`);
  }

  let body = parseFlowResponse(await initial.text());
  if (flowHasErrors(body)) {
    throw new Error(`Flow start failed: ${JSON.stringify(body)}`);
  }

  if (body.component === "ak-stage-identification") {
    body = await submitFlowStage(executorPath, jar, {
      component: "ak-stage-identification",
      uid_field: input.username
    });
  }

  if (body.component !== "ak-stage-prompt") {
    throw new Error(`Expected prompt stage, got ${body.component ?? "unknown"}: ${JSON.stringify(body)}`);
  }

  body = await submitFlowStage(executorPath, jar, {
      component: "ak-stage-prompt",
      username: input.username,
      email: input.email,
      password: input.password,
      password_repeat: input.passwordRepeat
  });

  return body;
}

export async function findFoundryGroup(): Promise<AuthentikGroup> {
  const groupSearch = new URLSearchParams({
    search: config.AUTHENTIK_FOUNDRY_GROUP_NAME
  });
  const groups = await authentikFetch<AuthentikList<AuthentikGroup>>(`/api/v3/core/groups/?${groupSearch}`);
  const group = groups.results?.find((item) => item.name === config.AUTHENTIK_FOUNDRY_GROUP_NAME);

  if (!group) {
    throw new Error(`Group not found: ${config.AUTHENTIK_FOUNDRY_GROUP_NAME}`);
  }

  return group;
}

export async function findOAuthSourceBySlug(slug: string): Promise<AuthentikSource> {
  const search = new URLSearchParams({ search: slug });
  const sources = await authentikFetch<AuthentikList<AuthentikSource>>(`/api/v3/sources/oauth/?${search}`);
  const source = sources.results?.find((item) => item.slug === slug);

  if (!source) {
    throw new Error(`OAuth source not found: ${slug}`);
  }

  return source;
}

export async function findUserByEmail(email: string): Promise<AuthentikUser | null> {
  const search = new URLSearchParams({ search: email });
  const users = await authentikFetch<AuthentikList<AuthentikUser>>(`/api/v3/core/users/?${search}`);
  return users.results?.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
}

async function findOAuthConnection(input: {
  sourceSlug: string;
  identifier: string;
}): Promise<AuthentikSourceConnection | null> {
  const search = new URLSearchParams({
    source__slug: input.sourceSlug,
    search: input.identifier
  });
  const connections = await authentikFetch<AuthentikList<AuthentikSourceConnection>>(
    `/api/v3/sources/user_connections/oauth/?${search}`
  );

  return connections.results?.find((connection) => connection.identifier === input.identifier) ?? null;
}

export async function ensureOAuthSourceConnection(input: {
  userId: string | number;
  sourceSlug: string;
  identifier: string;
  accessToken?: string;
}): Promise<void> {
  const existing = await findOAuthConnection({
    sourceSlug: input.sourceSlug,
    identifier: input.identifier
  });

  if (existing) {
    if (String(existing.user) !== String(input.userId)) {
      throw new Error(`OAuth identifier already linked to another user: ${input.identifier}`);
    }
    return;
  }

  const source = await findOAuthSourceBySlug(input.sourceSlug);
  await authentikFetch<AuthentikSourceConnection>("/api/v3/sources/user_connections/oauth/", {
    method: "POST",
    body: JSON.stringify({
      user: input.userId,
      source: source.pk,
      identifier: input.identifier,
      access_token: input.accessToken
    })
  });
}

export async function findUserByUsername(username: string): Promise<AuthentikUser | null> {
  const search = new URLSearchParams({ search: username });
  const users = await authentikFetch<AuthentikList<AuthentikUser>>(`/api/v3/core/users/?${search}`);
  return users.results?.find((user) => user.username.toLowerCase() === username.toLowerCase()) ?? null;
}

export async function findAvailableUsername(baseUsername: string): Promise<string> {
  const safeBase = baseUsername.slice(0, 48) || "user";
  if (!await findUserByUsername(safeBase)) {
    return safeBase;
  }

  for (let index = 2; index <= 99; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${safeBase.slice(0, 64 - suffix.length)}${suffix}`;
    if (!await findUserByUsername(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No available username for base: ${safeBase}`);
}

async function getUser(userId: string | number): Promise<AuthentikUser> {
  return authentikFetch<AuthentikUser>(`/api/v3/core/users/${userId}/`);
}

function userGroupPk(group: string | { pk: string }): string {
  return typeof group === "string" ? group : group.pk;
}

async function ensureUserInFoundryGroup(userId: string | number): Promise<void> {
  const [user, group] = await Promise.all([
    getUser(userId),
    findFoundryGroup()
  ]);
  const currentGroups = user.groups?.map(userGroupPk) ?? [];
  if (currentGroups.includes(group.pk)) {
    return;
  }

  await authentikFetch(`/api/v3/core/users/${userId}/`, {
    method: "PATCH",
    body: JSON.stringify({
      groups: [...currentGroups, group.pk]
    })
  });
}

export async function createUser(input: {
  username: string;
  email: string;
  name?: string;
  password?: string;
  active?: boolean;
}): Promise<AuthentikUser> {
  const group = await findFoundryGroup();
  return authentikFetch<AuthentikUser>("/api/v3/core/users/", {
    method: "POST",
    body: JSON.stringify({
      username: input.username,
      name: input.name ?? input.username,
      email: input.email,
      is_active: input.active ?? true,
      groups: [group.pk],
      path: config.AUTHENTIK_FOUNDRY_USER_PATH
    })
  });
}

export async function setUserPassword(userId: string | number, password: string): Promise<void> {
  await authentikFetch(`/api/v3/core/users/${userId}/set_password/`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function ensureFoundryUser(input: {
  username: string;
  email: string;
  name?: string;
  password?: string;
}): Promise<AuthentikUser> {
  const existing = await findUserByEmail(input.email);
  const user = existing ?? await createUser({
    username: input.username,
    email: input.email,
    name: input.name,
    password: input.password,
    active: true
  });

  if (input.password && !existing) {
    await setUserPassword(user.pk, input.password);
  }

  await ensureUserInFoundryGroup(user.pk);

  return user;
}
