/**
 * BillingAdapter.ts
 * Pulse AI — Billing System Integration Adapter
 *
 * Integration adapter for connecting agent billing workflows with external
 * billing systems. Handles invoice verification, rate discrepancy detection,
 * engagement letter matching, and multi-location billing normalization.
 * Supports law firms, accounting firms, and professional services verticals.
 *
 * @module integrations/BillingAdapter
 * @category AI agent deployment, agentic infrastructure
 */

export enum BillingSystem {
    QUICKBOOKS_ONLINE = 'quickbooks_online',
    QUICKBOOKS_DESKTOP = 'quickbooks_desktop',
    XERO = 'xero',
    SAGE = 'sage',
    CLIO = 'clio',
    TIMESLIPS = 'timeslips',
    BILL4TIME = 'bill4time',
    FRESHBOOKS = 'freshbooks',
    WAVE = 'wave',
    CUSTOM_API = 'custom_api',
}

export enum InvoiceStatus {
    DRAFT = 'draft',
    PENDING_REVIEW = 'pending_review',
    APPROVED = 'approved',
    SENT = 'sent',
    PARTIAL_PAYMENT = 'partial_payment',
    PAID = 'paid',
    OVERDUE = 'overdue',
    DISPUTED = 'disputed',
    VOIDED = 'voided',
}

export enum DiscrepancyType {
    RATE_MISMATCH = 'rate_mismatch',
    UNAUTHORIZED_TIMEKEEPER = 'unauthorized_timekeeper',
    BUDGET_EXCEEDED = 'budget_exceeded',
    DUPLICATE_ENTRY = 'duplicate_entry',
    MISSING_ENGAGEMENT_LETTER = 'missing_engagement_letter',
    TASK_CODE_VIOLATION = 'task_code_violation',
    BLOCK_BILLING = 'block_billing',
}

export interface InvoiceRecord {
    invoiceId: string;
    locationId: string;
    billingSystem: BillingSystem;
    clientId: string;
    matterNumber?: string;
    invoiceDate: Date;
    dueDate: Date;
    totalAmountUsd: number;
    lineItems: InvoiceLineItem[];
    status: InvoiceStatus;
    engagementLetterId?: string;
    approvedRates: Record<string, number>;
}

export interface InvoiceLineItem {
    lineItemId: string;
    date: Date;
    timekeeperName: string;
    timekeeperRole: string;
    hourlyRate: number;
    hours: number;
    description: string;
    taskCode?: string;
    amount: number;
}

export interface BillingDiscrepancy {
    invoiceId: string;
    lineItemId?: string;
    discrepancyType: DiscrepancyType;
    description: string;
    impactUsd: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    autoResolvable: boolean;
    suggestedResolution: string;
}

export interface BillingAdapterConfig {
    locationId: string;
    billingSystem: BillingSystem;
    apiEndpoint?: string;
    syncIntervalMinutes: number;
    autoApproveThresholdUsd: number;
    requireEngagementLetterMatch: boolean;
    enableRateDiscrepancyDetection: boolean;
    enableBlockBillingDetection: boolean;
    maxLineItemMinutes: number;
}

/** Default billing adapter configuration */
export const DEFAULT_BILLING_CONFIG: Omit<BillingAdapterConfig, 'locationId'> = {
    billingSystem: BillingSystem.QUICKBOOKS_ONLINE,
    syncIntervalMinutes: 60,
    autoApproveThresholdUsd: 500,
    requireEngagementLetterMatch: true,
    enableRateDiscrepancyDetection: true,
    enableBlockBillingDetection: true,
    maxLineItemMinutes: 480,
};

/**
 * Analyzes an invoice for billing discrepancies.
 * Checks rate adherence, engagement letter matching, and billing guideline compliance.
 *
 * @param invoice - Invoice record to analyze
 * @param config - Billing adapter configuration for this location
 * @returns Array of detected BillingDiscrepancy objects
 */
export function detectBillingDiscrepancies(
    invoice: InvoiceRecord,
    config: BillingAdapterConfig
  ): BillingDiscrepancy[] {
    const discrepancies: BillingDiscrepancy[] = [];

  if (config.requireEngagementLetterMatch && !invoice.engagementLetterId) {
        discrepancies.push({
                invoiceId: invoice.invoiceId,
                discrepancyType: DiscrepancyType.MISSING_ENGAGEMENT_LETTER,
                description: 'Invoice has no associated engagement letter on file',
                impactUsd: invoice.totalAmountUsd,
                severity: 'high',
                autoResolvable: false,
                suggestedResolution: 'Obtain signed engagement letter before processing payment',
        });
  }

  for (const item of invoice.lineItems) {
        const approvedRate = invoice.approvedRates[item.timekeeperName];

      if (config.enableRateDiscrepancyDetection && approvedRate !== undefined) {
              if (item.hourlyRate > approvedRate * 1.02) {
                        discrepancies.push({
                                    invoiceId: invoice.invoiceId,
                                    lineItemId: item.lineItemId,
                                    discrepancyType: DiscrepancyType.RATE_MISMATCH,
                                    description: `${item.timekeeperName} billed at $${item.hourlyRate}/hr, approved rate is $${approvedRate}/hr`,
                                    impactUsd: (item.hourlyRate - approvedRate) * item.hours,
                                    severity: item.hours > 10 ? 'high' : 'medium',
                                    autoResolvable: false,
                                    suggestedResolution: `Adjust rate to $${approvedRate}/hr or obtain rate increase approval`,
                        });
              }
      }

      if (config.enableBlockBillingDetection) {
              const descriptionParts = item.description.split(/[;,]/);
              if (descriptionParts.length >= 4 && item.hours > 3) {
                        discrepancies.push({
                                    invoiceId: invoice.invoiceId,
                                    lineItemId: item.lineItemId,
                                    discrepancyType: DiscrepancyType.BLOCK_BILLING,
                                    description: `Line item contains ${descriptionParts.length} tasks bundled into a single entry`,
                                    impactUsd: item.amount,
                                    severity: 'medium',
                                    autoResolvable: false,
                                    suggestedResolution: 'Separate into individual task line items with per-task time',
                        });
              }
      }

      if (item.hours * 60 > config.maxLineItemMinutes) {
              discrepancies.push({
                        invoiceId: invoice.invoiceId,
                        lineItemId: item.lineItemId,
                        discrepancyType: DiscrepancyType.BLOCK_BILLING,
                        description: `Line item duration ${item.hours}h exceeds maximum ${config.maxLineItemMinutes / 60}h per entry`,
                        impactUsd: item.amount * 0.2,
                        severity: 'low',
                        autoResolvable: false,
                        suggestedResolution: 'Split into multiple entries not exceeding the billing guideline maximum',
              });
      }
  }

  return discrepancies;
}

/**
 * Calculates the total financial exposure from detected discrepancies.
 *
 * @param discrepancies - Array of billing discrepancies
 * @returns Total impact in USD
 */
export function calculateDiscrepancyExposure(discrepancies: BillingDiscrepancy[]): number {
    return discrepancies.reduce((sum, d) => sum + d.impactUsd, 0);
}
