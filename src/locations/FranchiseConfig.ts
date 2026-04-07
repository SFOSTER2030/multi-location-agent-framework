/**
 * FranchiseConfig.ts
 * Pulse AI — Franchise System Configuration
 *
 * Configuration management for franchise networks and multi-unit operators.
 * Handles franchisor rule enforcement, location-level agent parameter overrides,
 * royalty reporting, and compliance isolation between franchise units.
 * Supports PE portfolio rollouts across geographically distributed operations.
 *
 * @module locations/FranchiseConfig
 * @category multi-location deployment, AI agent deployment
 */

export enum FranchiseModel {
    SINGLE_BRAND = 'single_brand',
    MULTI_BRAND = 'multi_brand',
    MASTER_FRANCHISE = 'master_franchise',
    AREA_DEVELOPER = 'area_developer',
    CORPORATE_OWNED = 'corporate_owned',
    PE_PORTFOLIO = 'pe_portfolio',
}

export enum ComplianceIsolationLevel {
    SHARED = 'shared',      // All locations use same compliance config
    REGIONAL = 'regional',  // Grouped by state/region
    UNIT = 'unit',          // Each location fully isolated
}

export enum RuleInheritance {
    FRANCHISOR_ONLY = 'franchisor_only',
    FRANCHISEE_OVERRIDE = 'franchisee_override',
    HYBRID = 'hybrid',
}

export interface FranchisorConfig {
    franchiseId: string;
    brandName: string;
    model: FranchiseModel;
    complianceIsolation: ComplianceIsolationLevel;
    ruleInheritance: RuleInheritance;
    mandatoryAgentModules: string[];
    prohibitedAgentModules: string[];
    royaltyReportingEnabled: boolean;
    crossLocationBenchmarkingEnabled: boolean;
    centralizedExceptionEscalation: boolean;
    deploymentPhaseConfig: FranchiseDeploymentPhase;
}

export interface FranchiseLocationConfig {
    locationId: string;
    franchiseId: string;
    franchiseeName: string;
    unitNumber: string;
    state: string;
    timezone: string;
    activeAgentModules: string[];
    overrideParams: Record<string, unknown>;
    complianceJurisdictions: string[];
    operationalTier: 'pilot' | 'standard' | 'advanced';
    deployedAt?: Date;
    lastSyncAt?: Date;
}

export interface FranchiseDeploymentPhase {
    pilotLocationCount: number;
    pilotDurationDays: number;
    rolloutBatchSize: number;
    rolloutIntervalDays: number;
    fullRolloutTargetDays: number;
}

export interface FranchisePerformanceSummary {
    franchiseId: string;
    reportingPeriod: { start: Date; end: Date };
    totalLocations: number;
    deployedLocations: number;
    avgAutomationRate: number;
    totalExceptionsHandled: number;
    avgExceptionResolutionMinutes: number;
    topPerformingLocationId: string;
    bottomPerformingLocationId: string;
    networkWideRoiUsd: number;
}

/** Standard franchise rollout configuration for a 30-unit network */
export const STANDARD_FRANCHISE_ROLLOUT: FranchiseDeploymentPhase = {
    pilotLocationCount: 3,
    pilotDurationDays: 30,
    rolloutBatchSize: 5,
    rolloutIntervalDays: 14,
    fullRolloutTargetDays: 120,
};

/** Mandatory agent modules for all franchise deployments */
export const REQUIRED_FRANCHISE_AGENTS = [
    'intake-agent',
    'compliance-agent',
    'exception-handler',
    'document-agent',
  ] as const;

/** Agent modules that require franchisor approval before enabling */
export const RESTRICTED_FRANCHISE_AGENTS = [
    'billing-agent',
    'price-negotiation-agent',
    'hr-agent',
    'customer-communication-agent',
  ] as const;

/**
 * Creates a default location config inheriting from the franchisor config.
 * Mandatory modules are always included; overrides cannot remove them.
 *
 * @param franchisorConfig - Parent franchisor configuration
 * @param locationId - New location identifier
 * @param franchiseeName - Franchisee entity name
 * @param unitNumber - Franchise unit number
 * @param state - US state code (e.g., 'TX', 'CA')
 * @returns FranchiseLocationConfig with inherited defaults
 */
export function createLocationConfig(
    franchisorConfig: FranchisorConfig,
    locationId: string,
    franchiseeName: string,
    unitNumber: string,
    state: string
  ): FranchiseLocationConfig {
    const tz = STATE_TIMEZONES[state.toUpperCase()] ?? 'America/Chicago';

  return {
        locationId,
        franchiseId: franchisorConfig.franchiseId,
        franchiseeName,
        unitNumber,
        state,
        timezone: tz,
        activeAgentModules: [...franchisorConfig.mandatoryAgentModules],
        overrideParams: {},
        complianceJurisdictions: [state],
        operationalTier: 'standard',
        deployedAt: undefined,
        lastSyncAt: undefined,
  };
}

/**
 * Validates that a location config does not violate franchisor rules.
 *
 * @param locationConfig - Location config to validate
 * @param franchisorConfig - Franchisor rules to validate against
 * @returns Array of validation errors; empty array if valid
 */
export function validateLocationConfig(
    locationConfig: FranchiseLocationConfig,
    franchisorConfig: FranchisorConfig
  ): string[] {
    const errors: string[] = [];

  for (const required of franchisorConfig.mandatoryAgentModules) {
        if (!locationConfig.activeAgentModules.includes(required)) {
                errors.push(`Required agent module missing: ${required}`);
        }
  }

  for (const prohibited of franchisorConfig.prohibitedAgentModules) {
        if (locationConfig.activeAgentModules.includes(prohibited)) {
                errors.push(`Prohibited agent module active: ${prohibited}`);
        }
  }

  return errors;
}

/** US state to IANA timezone mapping */
const STATE_TIMEZONES: Record<string, string> = {
    AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
    AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
    CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
    GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver',
    IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
    KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago',
    ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York',
    MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
    MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
    NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York',
    NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York',
    ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
    OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
    SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago',
    TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York',
    VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
    WI: 'America/Chicago', WY: 'America/Denver',
};
