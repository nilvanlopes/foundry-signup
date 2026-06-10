import { nanoid } from "nanoid";
import { config } from "./config.js";

type PendingGoogleSignup = {
  itoken: string;
  createdAt: number;
};

type GoogleTokenResponse = {
  access_token: string;
  id_token?: string;
};

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
};

export type GoogleSignupProfile = GoogleUserInfo & {
  accessToken: string;
};

const pendingGoogleSignups = new Map<string, PendingGoogleSignup>();

export function createGoogleAuthorization(itoken: string): string {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth is not configured");
  }

  const state = nanoid(32);
  pendingGoogleSignups.set(state, {
    itoken,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function consumeGoogleState(state: string): PendingGoogleSignup | null {
  const signup = pendingGoogleSignups.get(state) ?? null;
  pendingGoogleSignups.delete(state);
  return signup;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleSignupProfile> {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth is not configured");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      code,
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed: ${await tokenResponse.text()}`);
  }

  const token = await tokenResponse.json() as GoogleTokenResponse;
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      authorization: `Bearer ${token.access_token}`
    }
  });

  if (!userResponse.ok) {
    throw new Error(`Google userinfo failed: ${await userResponse.text()}`);
  }

  const userInfo = await userResponse.json() as GoogleUserInfo;
  return {
    ...userInfo,
    accessToken: token.access_token
  };
}
