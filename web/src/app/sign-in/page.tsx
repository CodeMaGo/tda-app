'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Callout, Field, Input } from '@/components/ui/controls';
import { supabase } from '@/lib/supabase';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function SignInPage() {
  const router = useRouter();
  const [problem, setProblem] = React.useState<string | null>(null);
  const [resetSent, setResetSent] = React.useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setProblem(null);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      // Deliberately the same message for a wrong password and an unknown
      // address, so the form cannot be used to discover who has an account.
      setProblem('That email address and password do not match an account.');
      return;
    }
    router.push('/');
  });

  const sendReset = async () => {
    const email = form.getValues('email');
    if (!schema.shape.email.safeParse(email).success) {
      form.setError('email', { message: 'Enter your email address first' });
      return;
    }
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password/`,
    });
    setResetSent(true);
  };

  return (
    <main
      id="main"
      className="flex min-h-screen items-center justify-center bg-wash px-4 py-12"
    >
      <div className="w-full max-w-[26rem]">
        <div className="mb-7 border-t-[3px] border-blueprint pt-5">
          <h1 className="font-serif text-2xl font-semibold leading-tight text-ink">
            Technical Decision Authority
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in to record, review and account for technical decisions.
          </p>
        </div>

        <form onSubmit={onSubmit} className="sheet space-y-5 p-6" noValidate>
          {problem ? <Callout tone="alert">{problem}</Callout> : null}
          {resetSent ? (
            <Callout tone="info" title="Check your email">
              If that address has an account, a link to set a new password is on its way.
            </Callout>
          ) : null}

          <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              autoFocus
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
          </Field>

          <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={form.formState.isSubmitting}
          >
            Sign in
          </Button>

          <div className="border-t border-rule pt-4 text-center">
            <button
              type="button"
              onClick={() => void sendReset()}
              className="text-sm text-blueprint hover:underline"
            >
              Forgotten your password?
            </button>
          </div>
        </form>

        <p className="mt-5 text-center text-xs text-ink-muted">
          Accounts are created by your organisation admin.
        </p>
      </div>
    </main>
  );
}
