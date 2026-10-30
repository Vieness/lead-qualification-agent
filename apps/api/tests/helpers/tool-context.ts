import { LeadRepository, PortfolioRepository } from '../../src/db/repositories/index.js';
import { MockProvider, type LLMProvider } from '../../src/llm/index.js';
import { FilePromptLoader } from '../../src/prompts/loader.js';
import {
  StaticCompanyDirectory,
  type CompanyDirectory,
  type ToolContext,
} from '../../src/tools/index.js';
import { createTestDb } from './db.js';

/** A ToolContext over in-memory Postgres, real prompts and a scripted mock LLM. */
export async function createToolContext(
  overrides: { llm?: LLMProvider; companies?: CompanyDirectory } = {},
): Promise<{ ctx: ToolContext; llm: LLMProvider; close: () => Promise<void> }> {
  const { db, close } = await createTestDb();
  const llm = overrides.llm ?? new MockProvider();
  const ctx: ToolContext = {
    llm,
    prompts: new FilePromptLoader(),
    portfolio: new PortfolioRepository(db),
    leads: new LeadRepository(db),
    companies: overrides.companies ?? new StaticCompanyDirectory([]),
    maxRetries: 2,
  };
  return { ctx, llm, close };
}
