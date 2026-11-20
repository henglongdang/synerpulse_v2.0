/**
 * Financial data provider abstraction.
 *
 * The paper identifies the absence of live bank data as the prototype's main limitation (§4.2).
 * Live aggregation requires a commercial provider (e.g. Plaid, MX, Teller) under contract, with
 * credentials that this repository does not have. Rather than pretending, SynerPulse ships:
 *   - `manual`: ledger entry in the app (always available),
 *   - `csv`:    statement import with duplicate detection (always available),
 *   - `aggregator`: an interface placeholder that reports "not configured".
 *
 * To add an aggregator, implement `FinancialDataProvider`, exchange the provider's public token on
 * the server, store only the provider's access token (encrypted at rest) — never bank passwords —
 * and map synced transactions into `createTransaction(..., { source: 'import', importHash })`.
 */
export interface ProviderStatus {
  id: 'manual' | 'csv' | 'aggregator';
  name: string;
  status: 'available' | 'not_configured';
  description: string;
}

export interface SyncedTransaction {
  externalId: string;
  date: string;
  description: string;
  merchant?: string;
  amountCents: number;
}

export interface FinancialDataProvider {
  readonly id: string;
  createLinkSession(userId: string): Promise<{ linkToken: string }>;
  exchangePublicToken(publicToken: string): Promise<{ itemId: string }>;
  syncTransactions(itemId: string, cursor: string | null): Promise<{ added: SyncedTransaction[]; nextCursor: string | null }>;
}

export function providerStatuses(env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  const aggregatorConfigured = Boolean(env.AGGREGATOR_CLIENT_ID && env.AGGREGATOR_SECRET);
  return [
    { id: 'manual', name: 'Manual entry', status: 'available', description: 'Log income, spending and transfers directly.' },
    { id: 'csv', name: 'CSV statement import', status: 'available', description: 'Import a bank or card CSV export; duplicates are detected automatically.' },
    {
      id: 'aggregator',
      name: 'Automatic bank sync',
      status: aggregatorConfigured ? 'available' : 'not_configured',
      description: aggregatorConfigured
        ? 'A bank-data provider is configured for this deployment.'
        : 'Not connected in this deployment. Requires a contract with a bank-data provider (e.g. Plaid). SynerPulse never asks for your online-banking password.',
    },
  ];
}
