import type {
  ActionStatus,
  DecisionSignificance,
  DecisionStatus,
  OrgRole,
  OrganisationStatus,
  Priority,
  RiskLevel,
} from './domain.js';
import type { Permission } from './permissions.js';

/** Envelope returned by every API endpoint. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Who the caller is, resolved server-side from their token. Never client-supplied. */
export interface SessionContext {
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  organisation: {
    id: string;
    reference: string;
    name: string;
    code: string;
    status: OrganisationStatus;
    logoUrl: string | null;
    timezone: string;
  } | null;
  roles: OrgRole[];
  permissions: Permission[];
  /** Organisations this user belongs to, for the organisation switcher. */
  memberships: { organisationId: string; name: string; code: string; roles: OrgRole[] }[];
}

export interface DecisionSummary {
  id: string;
  reference: string;
  title: string;
  status: DecisionStatus;
  significance: DecisionSignificance;
  priority: Priority;
  typeName: string | null;
  projectName: string | null;
  projectCode: string | null;
  ownerName: string | null;
  authorityName: string | null;
  requiredBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  openActionCount: number;
  overdueActionCount: number;
  highestRiskRating: RiskLevel | null;
}

export interface ActionSummary {
  id: string;
  reference: string;
  description: string;
  status: ActionStatus;
  priority: Priority;
  dueDate: string | null;
  isOverdue: boolean;
  ownerName: string | null;
  ownerTeamName: string | null;
  decisionReference: string | null;
  decisionTitle: string | null;
}

export interface DashboardCounts {
  myDecisions: number;
  myContributions: number;
  myActions: number;
  myOverdueActions: number;
  pendingMyAction: number;
  openDecisions: number;
  awaitingMyDecision: number;
  pendingInformation: number;
  overdueActions: number;
  decisionsThisYear: number;
  users?: number;
  projects?: number;
  teams?: number;
  technologies?: number;
}

export interface ReportModel {
  organisation: { name: string; code: string; logoUrl: string | null };
  period: { start: string; end: string };
  generatedAt: string;
  generatedBy: string;
  summary: {
    raised: number;
    completed: number;
    approved: number;
    approvedWithConditions: number;
    rejected: number;
    deferred: number;
    open: number;
    pending: number;
    overdueDecisions: number;
    outstandingActions: number;
    overdueActions: number;
    averageDaysToDecision: number | null;
  };
  decisionsTaken: DecisionSummary[];
  openDecisions: DecisionSummary[];
  pendingDecisions: (DecisionSummary & { waitingOn: string })[];
  outstandingActions: ActionSummary[];
  risks: {
    decisionReference: string;
    decisionTitle: string;
    summary: string;
    rating: RiskLevel;
    residualRating: RiskLevel | null;
    mitigation: string | null;
    ownerName: string | null;
    status: string;
  }[];
  exceptions: {
    reference: string;
    title: string;
    decidedAt: string | null;
    authorityName: string | null;
    expiresOn: string | null;
    conditions: string[];
  }[];
  analytics: {
    byType: { label: string; count: number }[];
    byProject: { label: string; count: number }[];
    byOutcome: { label: string; count: number }[];
    byAuthority: { label: string; count: number }[];
    byTechnology: { label: string; count: number }[];
  };
}
