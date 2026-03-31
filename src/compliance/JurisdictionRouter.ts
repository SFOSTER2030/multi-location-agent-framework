/**
 * Jurisdiction Router
 *
 * Routes compliance rules, authority boundaries, and regulatory
 * requirements to agents based on the jurisdiction(s) of their
 * assigned location.
 *
 * A single location may span multiple jurisdictions:
 * - A Miami office operates under Florida state law, US federal law,
 *   and may process transactions subject to FinCEN requirements
 * - A Dubai office operates under UAE federal law, RAKEZ free zone
 *   regulations, and may be VARA-licensed for digital assets
 * - A São Paulo office operates under Brazilian federal law, state
 *   regulations, Central Bank rules, and LGPD data protection
 *
 * The router ensures every agent action complies with ALL applicable
 * jurisdictions for its location — not just the primary one.
 */

export interface Jurisdiction {
  id: string;
  name: string;
  type: 'country' | 'state' | 'free_zone' | 'regulatory_body' | 'industry_specific';
  parentId?: string;
  regulations: Regulation[];
}

export interface Regulation {
  id: string;
  jurisdictionId: string;
  name: string;
  shortName: string;
  category: RegulationCategory;
  requirements: ComplianceRequirement[];
  thresholds: RegulatoryThreshold[];
  reportingObligations: ReportingObligation[];
  effectiveDate: string;
  lastUpdated: string;
}

export type RegulationCategory =
  | 'data_protection'
  | 'financial_services'
  | 'healthcare'
  | 'employment'
  | 'consumer_protection'
  | 'digital_assets'
  | 'anti_money_laundering'
  | 'tax'
  | 'industry_licensing';

export interface ComplianceRequirement {
  id: string;
  description: string;
  agentImpact: 'authority_boundary' | 'data_handling' | 'reporting' | 'escalation' | 'retention';
  automationLevel: 'auto_resolve' | 'assisted' | 'escalated';
  auditRequired: boolean;
}

export interface RegulatoryThreshold {
  name: string;
  amount: number;
  currency: string;
  action: 'report' | 'review' | 'escalate' | 'block';
  description: string;
}

export interface ReportingObligation {
  name: string;
  frequency: 'per_transaction' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  deadline: string;
  recipientBody: string;
  automatable: boolean;
}

// Pre-configured jurisdiction database
const JURISDICTIONS: Record<string, Partial<Jurisdiction>> = {
  // United States
  'us_federal': {
    name: 'United States — Federal',
    type: 'country',
  },
  'us_fl': {
    name: 'Florida',
    type: 'state',
    parentId: 'us_federal',
  },
  'us_ca': {
    name: 'California',
    type: 'state',
    parentId: 'us_federal',
  },
  'us_ny': {
    name: 'New York',
    type: 'state',
    parentId: 'us_federal',
  },
  'us_tx': {
    name: 'Texas',
    type: 'state',
    parentId: 'us_federal',
  },

  // UAE
  'uae_federal': {
    name: 'United Arab Emirates — Federal',
    type: 'country',
  },
  'uae_rakez': {
    name: 'RAKEZ Free Zone',
    type: 'free_zone',
    parentId: 'uae_federal',
  },
  'uae_difc': {
    name: 'DIFC',
    type: 'free_zone',
    parentId: 'uae_federal',
  },
  'uae_adgm': {
    name: 'ADGM',
    type: 'free_zone',
    parentId: 'uae_federal',
  },
  'uae_vara': {
    name: 'VARA — Virtual Assets Regulatory Authority',
    type: 'regulatory_body',
    parentId: 'uae_federal',
  },

  // Brazil
  'br_federal': {
    name: 'Brazil — Federal',
    type: 'country',
  },
  'br_sp': {
    name: 'São Paulo',
    type: 'state',
    parentId: 'br_federal',
  },

  // European Union
  'eu': {
    name: 'European Union',
    type: 'country',
  },
  'eu_gdpr': {
    name: 'GDPR',
    type: 'regulatory_body',
    parentId: 'eu',
  },
  'eu_mica': {
    name: 'MiCA — Markets in Crypto-Assets',
    type: 'regulatory_body',
    parentId: 'eu',
  },

  // Regulatory bodies (cross-jurisdiction)
  'fincen': {
    name: 'FinCEN — Financial Crimes Enforcement Network',
    type: 'regulatory_body',
    parentId: 'us_federal',
  },
  'sec': {
    name: 'SEC — Securities and Exchange Commission',
    type: 'regulatory_body',
    parentId: 'us_federal',
  },
  'finra': {
    name: 'FINRA — Financial Industry Regulatory Authority',
    type: 'regulatory_body',
    parentId: 'us_federal',
  },
  'hipaa': {
    name: 'HIPAA — Health Insurance Portability and Accountability Act',
    type: 'industry_specific',
    parentId: 'us_federal',
  },
};

// Pre-configured regulatory thresholds
const COMMON_THRESHOLDS: Record<string, RegulatoryThreshold[]> = {
  'fincen': [
    { name: 'Currency Transaction Report', amount: 10000, currency: 'USD', action: 'report', description: 'CTR required for cash transactions over $10,000' },
    { name: 'Suspicious Activity Report', amount: 5000, currency: 'USD', action: 'escalate', description: 'SAR evaluation required for suspicious transactions over $5,000' },
    { name: 'Wire Transfer Record', amount: 3000, currency: 'USD', action: 'report', description: 'Record-keeping required for wire transfers over $3,000' },
  ],
  'uae_vara': [
    { name: 'Enhanced Due Diligence', amount: 55000, currency: 'AED', action: 'review', description: 'Enhanced KYC required for virtual asset transactions over AED 55,000' },
    { name: 'Large Transaction Report', amount: 150000, currency: 'AED', action: 'report', description: 'Reporting required for transactions over AED 150,000' },
  ],
  'eu_mica': [
    { name: 'Enhanced KYC', amount: 1000, currency: 'EUR', action: 'review', description: 'Enhanced verification for crypto transfers over €1,000' },
  ],
};

export function getJurisdictionsForLocation(locationJurisdictionIds: string[]): Jurisdiction[] {
  const jurisdictions: Jurisdiction[] = [];
  const seen = new Set<string>();

  for (const id of locationJurisdictionIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    const jurisdiction = JURISDICTIONS[id];
    if (!jurisdiction) continue;

    jurisdictions.push({
      id,
      name: jurisdiction.name || id,
      type: jurisdiction.type || 'country',
      parentId: jurisdiction.parentId,
      regulations: [],
    });

    // Include parent jurisdiction (e.g., Florida → US Federal)
    if (jurisdiction.parentId && !seen.has(jurisdiction.parentId)) {
      seen.add(jurisdiction.parentId);
      const parent = JURISDICTIONS[jurisdiction.parentId];
      if (parent) {
        jurisdictions.push({
          id: jurisdiction.parentId,
          name: parent.name || jurisdiction.parentId,
          type: parent.type || 'country',
          parentId: parent.parentId,
          regulations: [],
        });
      }
    }
  }

  return jurisdictions;
}

export function getThresholdsForJurisdictions(jurisdictionIds: string[]): RegulatoryThreshold[] {
  const thresholds: RegulatoryThreshold[] = [];

  for (const id of jurisdictionIds) {
    const jurisdictionThresholds = COMMON_THRESHOLDS[id];
    if (jurisdictionThresholds) {
      thresholds.push(...jurisdictionThresholds);
    }
  }

  // Sort by amount ascending — most restrictive threshold applies first
  return thresholds.sort((a, b) => a.amount - b.amount);
}

export function getMostRestrictiveThreshold(
  jurisdictionIds: string[],
  transactionType: string
): RegulatoryThreshold | null {
  const allThresholds = getThresholdsForJurisdictions(jurisdictionIds);

  // Return the lowest threshold — the most restrictive jurisdiction wins
  return allThresholds.length > 0 ? allThresholds[0] : null;
}

export function getDataRetentionRequirement(jurisdictionIds: string[]): number {
  // Return the longest retention period across all jurisdictions (in years)
  const retentionMap: Record<string, number> = {
    'sec': 7,
    'finra': 7,
    'fincen': 5,
    'hipaa': 6,
    'eu_gdpr': 5,
    'uae_vara': 5,
    'br_federal': 5,
  };

  let maxRetention = 3; // Default 3 years

  for (const id of jurisdictionIds) {
    const retention = retentionMap[id];
    if (retention && retention > maxRetention) {
      maxRetention = retention;
    }
  }

  return maxRetention;
}
