/**
 * ROI Calculator Types
 * 
 * Type definitions for the deployment ROI calculation engine used
 * to model financial impact of agent infrastructure across multi-location
 * operations. All financial values in USD. All time values monthly.
 * 
 * @module roi/types
 */

/** Current operational baseline before agent deployment */
export interface OperationalBaseline {
  monthlyTransactionVolume: number;
  avgCostPerTransaction: number;
  fullTimeEmployees: number;
  avgEmployeeCostMonthly: number;
  manualProcessingHoursPerWeek: number;
  errorRatePercent: number;
  avgErrorCostUsd: number;
  complianceIncidentsPerYear: number;
  avgComplianceCostUsd: number;
  technologySpendMonthly: number;
  avgProcessingTimeDays: number;
  locationCount: number;
}

/** Agent deployment configuration for ROI projection */
export interface DeploymentConfig {
  agentCount: number;
  integrationCount: number;
  deploymentInvestment: number;
  monthlyInfrastructureCost: number;
  deploymentTimelineDays: number;
  rampUpMonths: number;
}

/** Projected operational state after deployment reaches full capacity */
export interface ProjectedState {
  automatedTransactionPercent: number;
  reducedProcessingHoursPercent: number;
  errorReductionPercent: number;
  complianceReductionPercent: number;
  processingTimeReductionPercent: number;
  capacityIncreasePercent: number;
  technologyConsolidationSavingsMonthly: number;
}

/** Complete ROI analysis output */
export interface ROIAnalysis {
  baseline: OperationalBaseline;
  deployment: DeploymentConfig;
  projected: ProjectedState;
  monthly: MonthlyFinancials;
  annual: AnnualProjection;
  payback: PaybackAnalysis;
  threeYear: ThreeYearModel;
}

/** Monthly financial comparison between current and projected states */
export interface MonthlyFinancials {
  currentMonthlyCost: number;
  projectedMonthlyCost: number;
  monthlySavings: number;
  monthlyInfrastructureCost: number;
  netMonthlySavings: number;
  laborCostReduction: number;
  errorCostReduction: number;
  complianceCostReduction: number;
  technologySavings: number;
  capacityValueAdd: number;
}

/** Annualized projection with revenue impact */
export interface AnnualProjection {
  annualSavings: number;
  annualInfrastructureCost: number;
  netAnnualSavings: number;
  revenueCapacityIncrease: number;
  totalAnnualImpact: number;
  roiPercent: number;
}

/** Payback period analysis */
export interface PaybackAnalysis {
  deploymentInvestment: number;
  monthlyNetBenefit: number;
  paybackMonths: number;
  breakEvenDate: Date;
  cumulativeSavingsAtMonthTwelve: number;
}

/** Three-year compounding projection */
export interface ThreeYearModel {
  year1: YearProjection;
  year2: YearProjection;
  year3: YearProjection;
  totalThreeYearImpact: number;
  compoundedEfficiencyGain: number;
}

/** Single-year financial projection */
export interface YearProjection {
  year: number;
  annualSavings: number;
  infrastructureCost: number;
  efficiencyMultiplier: number;
  netImpact: number;
  cumulativeImpact: number;
}

/** Per-location ROI breakdown for multi-location operations */
export interface LocationROI {
  locationId: string;
  locationName: string;
  transactionVolume: number;
  currentCost: number;
  projectedCost: number;
  savings: number;
  roiPercent: number;
}
