import { desc, eq } from 'drizzle-orm';
import type {
  LeadInput,
  QualificationOutcome,
  QualificationResult,
  RunStatus,
  SaveToCrmOutput,
} from '../../contracts/index.js';
import type { Db } from '../client.js';
import { leads } from '../schema.js';

type LeadRow = typeof leads.$inferSelect;

export type StoredLead = {
  lead: LeadInput;
  result: QualificationResult;
  approvedAt: Date | null;
  createdAt: Date;
};

export type ApproveResult =
  | { status: 'approved'; lead: StoredLead }
  | { status: 'not_found' }
  | { status: 'not_pending'; current: QualificationResult['status'] }
  | { status: 'no_draft' };

function toStoredLead(row: LeadRow): StoredLead {
  return {
    lead: {
      name: row.name,
      email: row.email,
      message: row.message,
      source: row.source,
      ...(row.company !== null && { company: row.company }),
      ...(row.website !== null && { website: row.website }),
    },
    result: { ...row.outcome, leadId: row.id },
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

export class LeadRepository {
  constructor(private readonly db: Db) {}

  async create(lead: LeadInput, outcome: QualificationOutcome): Promise<SaveToCrmOutput> {
    const [row] = await this.db
      .insert(leads)
      .values({
        name: lead.name,
        email: lead.email,
        company: lead.company ?? null,
        website: lead.website ?? null,
        message: lead.message,
        source: lead.source,
        status: outcome.status,
        decision: outcome.decision,
        tier: outcome.tier,
        score: outcome.score,
        outcome,
      })
      .returning({ leadId: leads.id, status: leads.status });
    if (!row) throw new Error('Insert into leads returned no row');
    return row;
  }

  async findById(id: string): Promise<StoredLead | null> {
    const [row] = await this.db.select().from(leads).where(eq(leads.id, id));
    return row ? toStoredLead(row) : null;
  }

  /** Newest first, optionally filtered by status (e.g. the human review queue). */
  async list({ status, limit }: { status?: RunStatus; limit: number }): Promise<StoredLead[]> {
    const rows = await this.db
      .select()
      .from(leads)
      .where(status ? eq(leads.status, status) : undefined)
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(limit);
    return rows.map(toStoredLead);
  }

  /** Human approval of a lead the agent parked as `pending_approval`. */
  async markApproved(id: string): Promise<ApproveResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(leads).where(eq(leads.id, id)).for('update');
      if (!row) return { status: 'not_found' };
      if (row.status !== 'pending_approval') return { status: 'not_pending', current: row.status };
      // Approving means "send this reply": without a draft a person has to write it by hand
      if (!row.outcome.draftReply) return { status: 'no_draft' };

      const [updated] = await tx
        .update(leads)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          outcome: { ...row.outcome, status: 'approved' },
        })
        .where(eq(leads.id, id))
        .returning();
      if (!updated) throw new Error(`Lead ${id} disappeared during approval`);
      return { status: 'approved', lead: toStoredLead(updated) };
    });
  }
}
