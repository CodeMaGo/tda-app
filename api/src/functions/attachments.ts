import { app } from '@azure/functions';
import { schema as s } from '@tda/db';
import { confirmUploadSchema, requestUploadSchema } from '@tda/shared';
import { eq, isNull } from 'drizzle-orm';
import { audit } from '../core/audit.js';
import { withOrg } from '../core/context.js';
import { conflict, forbidden, json, notFound, readBody, uuidParam } from '../core/http.js';
import { buildStorageKey, presignDownload, presignUpload } from '../core/storage.js';
import { assertVisible, loadDecision } from './decisions.js';

/**
 * Evidence (spec §27, §58).
 *
 * Two-phase upload: the API records the intent and hands back a short-lived
 * presigned PUT; the browser uploads directly to R2; the API then confirms.
 * A row that is never confirmed is a harmless orphan, cleaned up by the nightly
 * job — much better than a confirmed row pointing at a file that never arrived.
 */

app.http('attachmentRequestUpload', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'attachments/upload-url',
  handler: withOrg({ permissions: ['decision:upload_evidence'] }, async (ctx) => {
    const input = await readBody(ctx.request, requestUploadSchema);
    const decision = await loadDecision(ctx, input.decisionId);
    await assertVisible(ctx, decision);

    if (decision.lockedAt) {
      throw conflict(`${decision.reference} is closed to new evidence. Supersede it instead.`);
    }

    const storageKey = buildStorageKey({
      organisationId: ctx.scope.organisationId,
      decisionId: input.decisionId,
      filename: input.filename,
    });

    const [pending] = await ctx.tx
      .insert(s.attachments)
      .values(
        ctx.scope.own({
          decisionId: input.decisionId,
          filename: input.filename,
          description: input.description ?? null,
          version: input.version,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          storageKey,
          uploadedByUserId: ctx.session.userId,
          scanStatus: 'pending',
        }),
      )
      .returning();

    const { url, expiresInSeconds } = await presignUpload({
      organisationId: ctx.scope.organisationId,
      storageKey,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    return json({ uploadId: pending!.id, storageKey, url, expiresInSeconds }, 201);
  }),
});

app.http('attachmentConfirm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'attachments/confirm',
  handler: withOrg({ permissions: ['decision:upload_evidence'] }, async (ctx) => {
    const input = await readBody(ctx.request, confirmUploadSchema);

    const [pending] = await ctx.tx
      .select()
      .from(s.attachments)
      .where(ctx.scope.where(s.attachments, eq(s.attachments.id, input.uploadId)));
    if (!pending) throw notFound('That upload');
    if (pending.storageKey !== input.storageKey) throw forbidden('That upload does not match');
    if (pending.uploadedByUserId !== ctx.session.userId) {
      throw forbidden('That upload was started by someone else');
    }

    const [confirmed] = await ctx.tx
      .update(s.attachments)
      .set({ uploadConfirmedAt: new Date(), scanStatus: 'clean' })
      .where(ctx.scope.where(s.attachments, eq(s.attachments.id, input.uploadId)))
      .returning();

    const decision = await loadDecision(ctx, pending.decisionId);
    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'attachment_uploaded',
      objectType: 'attachment',
      objectId: pending.id,
      objectReference: decision.reference,
      details: { filename: pending.filename, version: pending.version },
    });

    return json(confirmed);
  }),
});

app.http('attachmentDownload', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'attachments/{id}/download',
  handler: withOrg({ permissions: ['decision:read'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');

    const [attachment] = await ctx.tx
      .select()
      .from(s.attachments)
      .where(
        ctx.scope.where(s.attachments, eq(s.attachments.id, id), isNull(s.attachments.deletedAt)),
      );
    if (!attachment) throw notFound('That file');

    // The attachment row passed the tenant filter; the decision check enforces
    // per-decision visibility on top of it.
    const decision = await loadDecision(ctx, attachment.decisionId);
    await assertVisible(ctx, decision);

    if (attachment.scanStatus === 'infected') {
      throw forbidden('This file failed a malware scan and cannot be downloaded');
    }
    if (!attachment.uploadConfirmedAt) {
      throw conflict('That upload never completed');
    }

    const { url, expiresInSeconds } = await presignDownload({
      organisationId: ctx.scope.organisationId,
      storageKey: attachment.storageKey,
      filename: attachment.filename,
    });

    return json({ url, expiresInSeconds, filename: attachment.filename });
  }),
});

app.http('attachmentRemove', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'attachments/{id}',
  handler: withOrg({ permissions: ['decision:upload_evidence'] }, async (ctx) => {
    const id = uuidParam(ctx.request, 'id');
    const [attachment] = await ctx.tx
      .select()
      .from(s.attachments)
      .where(ctx.scope.where(s.attachments, eq(s.attachments.id, id)));
    if (!attachment) throw notFound('That file');

    const decision = await loadDecision(ctx, attachment.decisionId);
    if (decision.lockedAt) {
      throw conflict('Evidence for a recorded decision cannot be removed');
    }
    if (attachment.uploadedByUserId !== ctx.session.userId && !ctx.can('org:manage_config')) {
      throw forbidden('You can only remove evidence you uploaded');
    }

    // Soft delete: the object stays in R2 and the row stays in the audit story.
    const [removed] = await ctx.tx
      .update(s.attachments)
      .set({ deletedAt: new Date() })
      .where(ctx.scope.where(s.attachments, eq(s.attachments.id, id)))
      .returning();

    await audit(ctx.tx, {
      organisationId: ctx.scope.organisationId,
      userId: ctx.session.userId,
      userName: ctx.session.name,
      eventType: 'attachment_removed',
      objectType: 'attachment',
      objectId: id,
      objectReference: decision.reference,
      details: { filename: attachment.filename },
    });

    return json(removed);
  }),
});
