'use client';

import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Button, Callout, Field, Input, Select, Textarea } from '@/components/ui/controls';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { today } from '@/lib/format';
import { cn } from '@/lib/utils';

type Outcome =
  | 'approved'
  | 'approved_with_conditions'
  | 'rejected'
  | 'deferred'
  | 'escalated'
  | 'more_information_required';

interface Condition {
  description: string;
  ownerId: string;
  dueDate: string;
}

/**
 * The decision panel (spec §32–33).
 *
 * Each outcome asks for exactly what it needs and nothing more: an approval
 * needs the decision and a rationale, a conditional approval needs conditions
 * with owners and dates, a rejection needs a reason. The server validates the
 * same shape, so a missing rationale is refused whatever the client does.
 */
export function DecisionPanel({
  decision,
  detail,
  onDecided,
}: {
  decision: { id: string; reference: string; title: string };
  detail: {
    alternatives: { id: string; name: string }[];
    contributors: { userId: string; name: string }[];
    owner: { id: string; name: string } | null;
    scores: { alternativeId: string; name: string; weightedScore: number }[];
  };
  onDecided: () => void;
}) {
  const toast = useToast();
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const [rationale, setRationale] = React.useState('');
  const [decisionText, setDecisionText] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState(today());
  const [reviewDate, setReviewDate] = React.useState('');
  const [assignedTo, setAssignedTo] = React.useState('');
  const [escalateTo, setEscalateTo] = React.useState('');
  const [conditions, setConditions] = React.useState<Condition[]>([
    { description: '', ownerId: '', dueDate: '' },
  ]);
  const [problem, setProblem] = React.useState<string | null>(null);

  const people = React.useMemo(() => {
    const map = new Map<string, string>();
    if (detail.owner) map.set(detail.owner.id, detail.owner.name);
    for (const contributor of detail.contributors) map.set(contributor.userId, contributor.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [detail]);

  const reset = () => {
    setOutcome(null);
    setRationale('');
    setDecisionText('');
    setProblem(null);
    setConditions([{ description: '', ownerId: '', dueDate: '' }]);
  };

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/decisions/${decision.id}/decide`, body),
    onSuccess: () => {
      toast.confirm(CONFIRMATIONS[outcome!], `${decision.reference} has been recorded.`);
      reset();
      onDecided();
    },
    onError: (error) => {
      setProblem(error instanceof ApiError ? error.message : 'That could not be recorded. Try again.');
    },
  });

  const submit = () => {
    setProblem(null);
    if (!outcome) return;

    const base: Record<string, unknown> = { outcome, rationale };

    if (outcome === 'approved' || outcome === 'approved_with_conditions') {
      base.decisionText = decisionText;
      base.effectiveDate = effectiveDate;
    }
    if (outcome === 'approved_with_conditions') {
      const filled = conditions.filter((c) => c.description.trim() && c.dueDate);
      if (filled.length === 0) {
        setProblem('A conditional approval needs at least one condition with a due date.');
        return;
      }
      base.conditions = filled.map((c) => ({
        description: c.description,
        ownerId: c.ownerId || null,
        dueDate: c.dueDate,
      }));
    }
    if (outcome === 'deferred') {
      if (!reviewDate) {
        setProblem('Set the date this will be looked at again.');
        return;
      }
      base.reviewDate = reviewDate;
    }
    if (outcome === 'escalated') {
      if (!escalateTo) {
        setProblem('Choose who this is escalating to.');
        return;
      }
      base.escalatedToUserId = escalateTo;
    }
    if (outcome === 'more_information_required') {
      if (!assignedTo) {
        setProblem('Choose who should provide the information.');
        return;
      }
      base.assignedToUserId = assignedTo;
    }

    mutation.mutate(base);
  };

  const ranked = [...detail.scores].sort((a, b) => b.weightedScore - a.weightedScore);

  return (
    <section className="sheet border-t-[3px] border-t-blueprint p-5">
      <h2 className="font-serif text-base font-semibold text-ink">Your decision</h2>
      <p className="mt-1 text-sm text-ink-muted">
        You hold the authority to decide {decision.reference}.
      </p>

      {ranked.length > 0 && ranked[0]!.weightedScore > 0 ? (
        <p className="mt-3 border-l-[3px] border-l-rule bg-wash px-3 py-2 text-xs text-ink-muted">
          Weighted scoring puts {ranked[0]!.name} highest at {ranked[0]!.weightedScore}. Scoring is
          an aid, not the answer.
        </p>
      ) : null}

      {!outcome ? (
        <div className="mt-4 space-y-1.5">
          {(Object.keys(OUTCOMES) as Outcome[]).map((key) => (
            <button
              key={key}
              onClick={() => setOutcome(key)}
              className={cn(
                'flex w-full items-center gap-2.5 border border-rule px-3 py-2.5 text-left text-sm transition-colors hover:bg-wash',
                'border-l-[3px]',
                OUTCOMES[key].border,
              )}
            >
              <span className="font-medium text-ink">{OUTCOMES[key].label}</span>
              <span className="ml-auto text-xs text-ink-muted">{OUTCOMES[key].hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between border-b border-rule pb-2">
            <p className="text-sm font-semibold text-ink">{OUTCOMES[outcome].label}</p>
            <Button variant="ghost" size="sm" onClick={reset}>
              Change
            </Button>
          </div>

          {problem ? <Callout tone="alert">{problem}</Callout> : null}

          {outcome === 'approved' || outcome === 'approved_with_conditions' ? (
            <>
              <Field
                label="The decision"
                required
                hint="State plainly what has been decided. This is what the record will say."
              >
                <Textarea
                  value={decisionText}
                  onChange={(event) => setDecisionText(event.target.value)}
                  rows={3}
                  placeholder="Azure is selected as the strategic cloud platform for customer-facing workloads."
                />
              </Field>
              <Field label="Effective from" required>
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                />
              </Field>
            </>
          ) : null}

          <Field
            label={RATIONALE_LABELS[outcome]}
            required
            hint="Someone reading this in two years should understand the reasoning."
          >
            <Textarea
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              rows={4}
            />
          </Field>

          {outcome === 'approved_with_conditions' ? (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Conditions</p>
              <p className="mb-3 text-xs text-ink-muted">
                Each condition becomes a tracked action. The decision cannot be marked implemented
                until they are met.
              </p>
              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <div key={index} className="border border-rule p-3">
                    <Textarea
                      rows={2}
                      value={condition.description}
                      placeholder="Complete a production security review"
                      aria-label={`Condition ${index + 1}`}
                      onChange={(event) =>
                        setConditions((current) =>
                          current.map((c, i) =>
                            i === index ? { ...c, description: event.target.value } : c,
                          ),
                        )
                      }
                    />
                    <div className="mt-2 flex gap-2">
                      <Select
                        aria-label={`Owner for condition ${index + 1}`}
                        value={condition.ownerId}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((c, i) =>
                              i === index ? { ...c, ownerId: event.target.value } : c,
                            ),
                          )
                        }
                      >
                        <option value="">Choose an owner</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="date"
                        aria-label={`Due date for condition ${index + 1}`}
                        value={condition.dueDate}
                        onChange={(event) =>
                          setConditions((current) =>
                            current.map((c, i) =>
                              i === index ? { ...c, dueDate: event.target.value } : c,
                            ),
                          )
                        }
                      />
                      {conditions.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove condition ${index + 1}`}
                          onClick={() =>
                            setConditions((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() =>
                  setConditions((current) => [...current, { description: '', ownerId: '', dueDate: '' }])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add another condition
              </Button>
            </div>
          ) : null}

          {outcome === 'deferred' ? (
            <Field label="Look at this again on" required>
              <Input
                type="date"
                value={reviewDate}
                onChange={(event) => setReviewDate(event.target.value)}
              />
            </Field>
          ) : null}

          {outcome === 'escalated' ? (
            <Field
              label="Escalate to"
              required
              hint="They must hold authority over this decision, or the escalation is refused."
            >
              <Select value={escalateTo} onChange={(event) => setEscalateTo(event.target.value)}>
                <option value="">Choose an authority</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {outcome === 'more_information_required' ? (
            <Field label="Ask" required hint="They will be notified and the decision pauses here.">
              <Select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
                <option value="">Choose a contributor</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Button
            variant={outcome === 'rejected' ? 'danger' : 'primary'}
            className="w-full"
            loading={mutation.isPending}
            onClick={submit}
          >
            {OUTCOMES[outcome].action}
          </Button>
        </div>
      )}
    </section>
  );
}

/* The verb on the button is the verb in the confirmation. */
const OUTCOMES: Record<
  Outcome,
  { label: string; hint: string; action: string; border: string }
> = {
  approved: {
    label: 'Approve',
    hint: 'On the record',
    action: 'Approve this decision',
    border: 'border-l-good',
  },
  approved_with_conditions: {
    label: 'Approve with conditions',
    hint: 'Creates actions',
    action: 'Approve with conditions',
    border: 'border-l-good',
  },
  more_information_required: {
    label: 'Request more information',
    hint: 'Pauses review',
    action: 'Send the request',
    border: 'border-l-warn',
  },
  deferred: {
    label: 'Defer',
    hint: 'Revisit later',
    action: 'Defer this decision',
    border: 'border-l-warn',
  },
  escalated: {
    label: 'Escalate',
    hint: 'Pass upward',
    action: 'Escalate this decision',
    border: 'border-l-alert',
  },
  rejected: {
    label: 'Reject',
    hint: 'On the record',
    action: 'Reject this decision',
    border: 'border-l-alert',
  },
};

const CONFIRMATIONS: Record<Outcome, string> = {
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  rejected: 'Rejected',
  deferred: 'Deferred',
  escalated: 'Escalated',
  more_information_required: 'Request sent',
};

const RATIONALE_LABELS: Record<Outcome, string> = {
  approved: 'Why you are approving this',
  approved_with_conditions: 'Why you are approving this',
  rejected: 'Why you are rejecting this',
  deferred: 'Why this is being deferred',
  escalated: 'Why this is being escalated',
  more_information_required: 'What information you need',
};
