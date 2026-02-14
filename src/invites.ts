import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { createInvite, listInvites, revokeInvite, UserRole } from "./db";
import { AppError, normalizeEmail, validateEmail } from "./utils";

export type InviteCreateResult = {
  id: number;
  email: string;
  role: UserRole;
  expiresAt: string;
  inviteUrl: string;
  emailDispatched: boolean;
};

function inviteToken(): string {
  return randomBytes(24).toString("base64url");
}

function inviteUrlForToken(token: string): string {
  const base = config.app.publicBaseUrl.replace(/\/$/, "");
  return `${base}/?invite=${token}`;
}

async function sendInviteEmail(address: string, link: string): Promise<boolean> {
  if (!config.smtp) {
    return false;
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  await transport.sendMail({
    from: config.smtp.from,
    to: address,
    subject: "You were invited to the Hytale server dashboard",
    text: `You were invited to manage the Hytale server dashboard. Open this link to create your account: ${link}`,
  });

  return true;
}

export async function createInviteAndDispatch(
  createdBy: number,
  email: string,
  role: UserRole = "member",
): Promise<InviteCreateResult> {
  if (!validateEmail(email)) {
    throw new AppError(400, "A valid email address is required.");
  }

  const token = inviteToken();
  const expiresAt = new Date(Date.now() + config.app.inviteTtlHours * 60 * 60 * 1000).toISOString();
  const invite = createInvite(normalizeEmail(email), token, role, createdBy, expiresAt);
  const inviteUrl = inviteUrlForToken(token);

  let emailDispatched = false;
  try {
    emailDispatched = await sendInviteEmail(invite.email, inviteUrl);
  } catch {
    emailDispatched = false;
  }

  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    inviteUrl,
    emailDispatched,
  };
}

export function getInviteSummaries() {
  return listInvites();
}

export function removeInvite(inviteId: number): void {
  revokeInvite(inviteId);
}
