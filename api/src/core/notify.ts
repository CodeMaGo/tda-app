import { schema as s } from '@tda/db';
import type { NotificationType } from '@tda/shared';
import { inArray } from 'drizzle-orm';
import { Resend } from 'resend';
import type { Tx } from './context.js';

/**
 * Notifications are written to the database first and emailed second (spec §42).
 * A failed send is logged and never rolls back the governance change that
 * caused it — the in-app notification is the record of truth.
 */

let resend: Resend | null = null;
function mailer(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resend ??= new Resend(key);
  return resend;
}

export interface NotifyInput {
  organisationId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  /** Path within the app, e.g. /decisions/detail?id=... */
  linkPath?: string;
  sendEmail?: boolean;
}

export async function notify(tx: Tx, input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.userIds)].filter(Boolean);
  if (recipients.length === 0) return;

  const rows = await tx
    .insert(s.notifications)
    .values(
      recipients.map((userId) => ({
        organisationId: input.organisationId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        linkPath: input.linkPath ?? null,
      })),
    )
    .returning({ id: s.notifications.id, userId: s.notifications.userId });

  if (input.sendEmail === false) return;

  const people = await tx
    .select({ id: s.users.id, email: s.users.email, name: s.users.name })
    .from(s.users)
    .where(inArray(s.users.id, recipients));

  // Fire and forget — email delivery must not block or fail the transaction.
  void sendEmails(
    people.map((person) => ({
      to: person.email,
      name: person.name,
      subject: input.title,
      body: input.body ?? '',
      linkPath: input.linkPath,
    })),
  );

  void rows;
}

interface Mail {
  to: string;
  name: string;
  subject: string;
  body: string;
  linkPath?: string;
}

async function sendEmails(messages: Mail[]): Promise<void> {
  const client = mailer();
  if (!client) return;
  const from = process.env.EMAIL_FROM ?? 'TDA Platform <tda@example.com>';
  const base = process.env.APP_BASE_URL ?? '';

  await Promise.allSettled(
    messages.map((message) =>
      client.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        html: renderEmail({ ...message, url: message.linkPath ? `${base}${message.linkPath}` : undefined }),
      }),
    ),
  );
}

function renderEmail(input: Mail & { url?: string }): string {
  const escape = (value: string) =>
    value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#EEF1F4;padding:32px 16px;font-family:'IBM Plex Sans',-apple-system,Segoe UI,sans-serif;color:#16222E">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #D3DAE1">
    <tr><td style="border-top:3px solid #1F5FA9;padding:28px 32px 8px">
      <p style="margin:0;font-size:13px;letter-spacing:.02em;color:#5A6B7B">Technical Decision Authority</p>
      <h1 style="margin:8px 0 0;font-size:19px;line-height:1.35;font-weight:600">${escape(input.subject)}</h1>
    </td></tr>
    <tr><td style="padding:8px 32px 28px">
      <p style="margin:16px 0;font-size:15px;line-height:1.6">${escape(input.body).replace(/\n/g, '<br>')}</p>
      ${
        input.url
          ? `<p style="margin:24px 0 0"><a href="${input.url}" style="display:inline-block;background:#1F5FA9;color:#fff;text-decoration:none;padding:10px 18px;font-size:14px;font-weight:500">Open in the platform</a></p>`
          : ''
      }
      <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #D3DAE1;font-size:12px;color:#5A6B7B">
        You are receiving this because you are named on this decision.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

export { sendEmails };
