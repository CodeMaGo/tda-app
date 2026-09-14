import { formatDistanceToNowStrict } from 'date-fns';

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const DATETIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' && value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATETIME.format(date);
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '';
  try {
    return `${formatDistanceToNowStrict(new Date(value))} ago`;
  } catch {
    return '';
  }
}

export const today = () => new Date().toISOString().slice(0, 10);

export function isPast(value: string | null | undefined): boolean {
  return Boolean(value && value.slice(0, 10) < today());
}

/** Days until a date; negative when it has passed. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = new Date(`${value.slice(0, 10)}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

/** "not_started" -> "Not started" */
export function humanise(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase();
}

/** Plain-language description of an audit event for the history panel. */
export function describeEvent(event: {
  eventType: string;
  userName: string | null;
  objectReference: string | null;
  oldStatus: string | null;
  newStatus: string | null;
}): string {
  const who = event.userName ?? 'The platform';
  const ref = event.objectReference ?? '';
  switch (event.eventType) {
    case 'decision_created': return `${who} raised ${ref}`;
    case 'decision_submitted': return `${who} submitted ${ref} for review`;
    case 'decision_approved': return `${who} approved ${ref}`;
    case 'decision_approved_with_conditions': return `${who} approved ${ref} with conditions`;
    case 'decision_rejected': return `${who} rejected ${ref}`;
    case 'decision_deferred': return `${who} deferred ${ref}`;
    case 'decision_escalated': return `${who} escalated ${ref}`;
    case 'information_requested': return `${who} requested more information`;
    case 'information_provided': return `${who} answered a request for information`;
    case 'decision_superseded': return `${who} superseded ${ref}`;
    case 'comment_added': return `${who} commented`;
    case 'attachment_uploaded': return `${who} uploaded evidence`;
    case 'attachment_removed': return `${who} removed evidence`;
    case 'risk_recorded': return `${who} recorded a risk`;
    case 'action_created': return `${who} created ${ref}`;
    case 'action_completed': return `${who} completed ${ref}`;
    case 'action_overdue': return `${ref} became overdue`;
    case 'decision_status_changed':
      return `${who} moved ${ref} to ${humanise(event.newStatus ?? '')}`.trim();
    case 'user_invited': return `${who} invited a new user`;
    case 'user_roles_changed': return `${who} changed a user's roles`;
    case 'report_generated': return `${who} generated a TDA report`;
    default: return `${who} · ${humanise(event.eventType)}`;
  }
}
