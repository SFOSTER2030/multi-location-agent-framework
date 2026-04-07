/**
 * PePortfolioDashboard.ts
 * Pulse AI — PE Portfolio Operations Dashboard
 *
 * Aggregates operational performance data across PE portfolio companies.
 * Provides cross-company analytics, exception rollups, agent health status,
 * and ROI tracking for fund-level reporting. Supports GP/LP reporting workflows
 * and value creation monitoring for multi-company PE deployments.
 *
 * @module reporting/PePortfolioDashboard
 * @category PE portfolio operations, AI agent deployment, multi-location deployment
 */

export enum PortfolioCompanyStatus {
    PRE_DEPLOYMENT = 'pre_deployment',
    DEPLOYING = 'deploying',
    LIVE = 'live',
    SCALING = 'scaling',
    FULLY_DEPLOYED = 'fully_deployed',
    EXITED = 'exited',
}

export enum ValueCreationLevers {
    LABOR_COST_REDUCTION = 'labor_cost_reduction',
    ERROR_RATE_REDUCTION = 'error_rate_reduction',
    CYCLE_TIME_IMPROVEMENT = 'cycle_time_improvement',
    COMPLIANCE_RISK_REDUCTION = 'compliance_risk_reduction',
    REVENUE_ENABLEMENT = 'revenue_enablement',
    CAPACITY_EXPANSION = 'capacity_expansion',
}

export interface PortfolioCompanyMetrics {
    companyId: string;
    companyName: string;
    vertical: string;
    locationCount: number;
    status: PortfolioCompanyStatus;
    deploymentStartDate?: Date;
    fullyDeployedDate?: Date;
    activeAgentModules: string[];
    monthlyTransactionsAutomated: number;
    automationRatePercent: number;
    monthlyLaborSavingsUsd: number;
    monthlyErrorSavingsUsd: number;
    totalInvestmentUsd: number;
    cumulativeSavingsUsd: number;
    paybackAchieved: boolean;
    currentMonthExceptions: number;
    exceptionAutoResolutionRate: number;
    agentUptimePercent: number;
}

export interface PortfolioDashboardSnapshot {
    snapshotId: string;
    fundId: string;
    snapshotDate: Date;
    reportingPeriod: { start: Date; end: Date };
    companiesTotal: number;
    companiesLive: number;
    companiesDeploying: number;
    totalLocationsDeployed: number;
    totalMonthlyLaborSavingsUsd: number;
    totalMonthlyErrorSavingsUsd: number;
    totalNetMonthlySavingsUsd: number;
    annualizedSavingsUsd: number;
    weightedAvgAutomationRate: number;
    totalExceptionsHandled: number;
    networkAutoResolutionRate: number;
    companiesPaybackAchieved: number;
    topPerformer: PortfolioCompanyMetrics | null;
    bottomPerformer: PortfolioCompanyMetrics | null;
    valueCreationByLever: Record<ValueCreationLevers, number>;
}

/**
 * Generates a portfolio-level dashboard snapshot from individual company metrics.
 * Used for GP quarterly reporting and LP performance updates.
 *
 * @param fundId - Fund identifier
 * @param companies - Array of portfolio company metrics
 * @param reportingPeriod - Date range for this reporting period
 * @returns Aggregated PortfolioDashboardSnapshot
 */
export function generatePortfolioDashboard(
    fundId: string,
    companies: PortfolioCompanyMetrics[],
    reportingPeriod: { start: Date; end: Date }
  ): PortfolioDashboardSnapshot {
    const liveCompanies = companies.filter(c =>
          c.status === PortfolioCompanyStatus.LIVE ||
          c.status === PortfolioCompanyStatus.SCALING ||
          c.status === PortfolioCompanyStatus.FULLY_DEPLOYED
                                             );

  const deployingCompanies = companies.filter(c => c.status === PortfolioCompanyStatus.DEPLOYING);

  const totalLaborSavings = liveCompanies.reduce((sum, c) => sum + c.monthlyLaborSavingsUsd, 0);
    const totalErrorSavings = liveCompanies.reduce((sum, c) => sum + c.monthlyErrorSavingsUsd, 0);
    const totalExceptions = liveCompanies.reduce((sum, c) => sum + c.currentMonthExceptions, 0);
    const totalLocations = companies.reduce((sum, c) => sum + c.locationCount, 0);

  const weightedAutomation = liveCompanies.length > 0
      ? liveCompanies.reduce((sum, c) => sum + c.automationRatePercent, 0) / liveCompanies.length
        : 0;

  const autoResolutionRates = liveCompanies.filter(c => c.currentMonthExceptions > 0);
    const networkAutoResolution = autoResolutionRates.length > 0
      ? autoResolutionRates.reduce((sum, c) => sum + c.exceptionAutoResolutionRate, 0) / autoResolutionRates.length
          : 0;

  const sorted = [...liveCompanies].sort(
        (a, b) => b.monthlyLaborSavingsUsd - a.monthlyLaborSavingsUsd
      );

  const valueCreation: Record<ValueCreationLevers, number> = {
        [ValueCreationLevers.LABOR_COST_REDUCTION]: totalLaborSavings,
        [ValueCreationLevers.ERROR_RATE_REDUCTION]: totalErrorSavings,
        [ValueCreationLevers.CYCLE_TIME_IMPROVEMENT]: totalLaborSavings * 0.15,
        [ValueCreationLevers.COMPLIANCE_RISK_REDUCTION]: liveCompanies.length * 2500,
        [ValueCreationLevers.REVENUE_ENABLEMENT]: totalLaborSavings * 0.08,
        [ValueCreationLevers.CAPACITY_EXPANSION]: 0,
  };

  return {
        snapshotId: `snap-${fundId}-${Date.now()}`,
        fundId,
        snapshotDate: new Date(),
        reportingPeriod,
        companiesTotal: companies.length,
        companiesLive: liveCompanies.length,
        companiesDeploying: deployingCompanies.length,
        totalLocationsDeployed: totalLocations,
        totalMonthlyLaborSavingsUsd: Math.round(totalLaborSavings),
        totalMonthlyErrorSavingsUsd: Math.round(totalErrorSavings),
        totalNetMonthlySavingsUsd: Math.round(totalLaborSavings + totalErrorSavings),
        annualizedSavingsUsd: Math.round((totalLaborSavings + totalErrorSavings) * 12),
        weightedAvgAutomationRate: Math.round(weightedAutomation * 10) / 10,
        totalExceptionsHandled: totalExceptions,
        networkAutoResolutionRate: Math.round(networkAutoResolution * 10) / 10,
        companiesPaybackAchieved: liveCompanies.filter(c => c.paybackAchieved).length,
        topPerformer: sorted[0] ?? null,
        bottomPerformer: sorted[sorted.length - 1] ?? null,
        valueCreationByLever: valueCreation,
  };
}
