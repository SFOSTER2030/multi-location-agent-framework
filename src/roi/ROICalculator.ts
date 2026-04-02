/**
 * ROI Calculator
 * 
 * Core calculation engine for modeling the financial impact of agent
 * infrastructure deployment. Uses conservative assumptions — efficiency
 * gains compound at 85% of theoretical maximum, revenue capacity
 * increases discounted by 30% for market absorption.
 * 
 * @module roi/ROICalculator
 */

import type {
  OperationalBaseline,
  DeploymentConfig,
  ProjectedState,
  ROIAnalysis,
  MonthlyFinancials,
  AnnualProjection,
  PaybackAnalysis,
  ThreeYearModel,
  YearProjection,
  LocationROI,
} from './types';

const EFFICIENCY_DISCOUNT = 0.85;
const REVENUE_DISCOUNT = 0.70;
const ANNUAL_IMPROVEMENT_RATE = 0.12;

const DEFAULT_PROJECTIONS: ProjectedState = {
  automatedTransactionPercent: 72,
  reducedProcessingHoursPercent: 55,
  errorReductionPercent: 68,
  complianceReductionPercent: 75,
  processingTimeReductionPercent: 40,
  capacityIncreasePercent: 45,
  technologyConsolidationSavingsMonthly: 350,
};

export class ROICalculator {
  private baseline: OperationalBaseline;
  private deployment: DeploymentConfig;
  private projected: ProjectedState;

  constructor(
    baseline: OperationalBaseline,
    deployment: DeploymentConfig,
    projected?: Partial<ProjectedState>
  ) {
    this.baseline = baseline;
    this.deployment = deployment;
    this.projected = { ...DEFAULT_PROJECTIONS, ...projected };
  }

  /** Generates the complete ROI analysis */
  analyze(): ROIAnalysis {
    const monthly = this.calculateMonthly();
    const annual = this.calculateAnnual(monthly);
    const payback = this.calculatePayback(monthly);
    const threeYear = this.calculateThreeYear(annual);
    return { baseline: this.baseline, deployment: this.deployment, projected: this.projected, monthly, annual, payback, threeYear };
  }

  private calculateMonthly(): MonthlyFinancials {
    const currentLabor = this.baseline.fullTimeEmployees * this.baseline.avgEmployeeCostMonthly;
    const currentErrors = this.baseline.monthlyTransactionVolume * (this.baseline.errorRatePercent / 100) * this.baseline.avgErrorCostUsd;
    const currentCompliance = (this.baseline.complianceIncidentsPerYear / 12) * this.baseline.avgComplianceCostUsd;
    const currentTech = this.baseline.technologySpendMonthly;
    const currentTotal = currentLabor + currentErrors + currentCompliance + currentTech;

    const laborReduction = currentLabor * (this.projected.reducedProcessingHoursPercent / 100) * EFFICIENCY_DISCOUNT;
    const errorReduction = currentErrors * (this.projected.errorReductionPercent / 100) * EFFICIENCY_DISCOUNT;
    const complianceReduction = currentCompliance * (this.projected.complianceReductionPercent / 100) * EFFICIENCY_DISCOUNT;
    const techSavings = this.projected.technologyConsolidationSavingsMonthly;
    const capacityValue = this.calculateCapacityValue();

    const projectedTotal = currentTotal - laborReduction - errorReduction - complianceReduction - techSavings;
    const monthlySavings = currentTotal - projectedTotal;
    const netSavings = monthlySavings - this.deployment.monthlyInfrastructureCost;

    return {
      currentMonthlyCost: Math.round(currentTotal),
      projectedMonthlyCost: Math.round(projectedTotal),
      monthlySavings: Math.round(monthlySavings),
      monthlyInfrastructureCost: this.deployment.monthlyInfrastructureCost,
      netMonthlySavings: Math.round(netSavings),
      laborCostReduction: Math.round(laborReduction),
      errorCostReduction: Math.round(errorReduction),
      complianceCostReduction: Math.round(complianceReduction),
      technologySavings: Math.round(techSavings),
      capacityValueAdd: Math.round(capacityValue),
    };
  }

  private calculateCapacityValue(): number {
    const currentRevPerTransaction = this.baseline.avgCostPerTransaction * 2.5;
    const additionalCapacity = this.baseline.monthlyTransactionVolume * (this.projected.capacityIncreasePercent / 100);
    return additionalCapacity * currentRevPerTransaction * REVENUE_DISCOUNT;
  }

  private calculateAnnual(monthly: MonthlyFinancials): AnnualProjection {
    const annualSavings = monthly.monthlySavings * 12;
    const annualInfra = monthly.monthlyInfrastructureCost * 12;
    const netAnnual = monthly.netMonthlySavings * 12;
    const revenueIncrease = monthly.capacityValueAdd * 12;
    const totalImpact = netAnnual + revenueIncrease;
    const roiPercent = this.deployment.deploymentInvestment > 0
      ? ((totalImpact - this.deployment.deploymentInvestment) / this.deployment.deploymentInvestment) * 100
      : 0;
    return {
      annualSavings: Math.round(annualSavings), annualInfrastructureCost: Math.round(annualInfra),
      netAnnualSavings: Math.round(netAnnual), revenueCapacityIncrease: Math.round(revenueIncrease),
      totalAnnualImpact: Math.round(totalImpact), roiPercent: Math.round(roiPercent * 10) / 10,
    };
  }

  private calculatePayback(monthly: MonthlyFinancials): PaybackAnalysis {
    const monthlyBenefit = monthly.netMonthlySavings + monthly.capacityValueAdd;
    const paybackMonths = monthlyBenefit > 0 ? Math.ceil(this.deployment.deploymentInvestment / monthlyBenefit) : Infinity;
    const breakEven = new Date();
    breakEven.setMonth(breakEven.getMonth() + paybackMonths + this.deployment.rampUpMonths);
    const monthsOperational = 12 - this.deployment.rampUpMonths;
    const cumulativeAtTwelve = monthlyBenefit * monthsOperational - this.deployment.deploymentInvestment;
    return {
      deploymentInvestment: this.deployment.deploymentInvestment,
      monthlyNetBenefit: Math.round(monthlyBenefit), paybackMonths, breakEvenDate: breakEven,
      cumulativeSavingsAtMonthTwelve: Math.round(cumulativeAtTwelve),
    };
  }

  private calculateThreeYear(annual: AnnualProjection): ThreeYearModel {
    const years: YearProjection[] = [];
    let cumulative = -this.deployment.deploymentInvestment;
    for (let year = 1; year <= 3; year++) {
      const multiplier = 1 + (ANNUAL_IMPROVEMENT_RATE * (year - 1));
      const savings = Math.round(annual.netAnnualSavings * multiplier);
      const infraCost = annual.annualInfrastructureCost;
      const revenue = Math.round(annual.revenueCapacityIncrease * multiplier);
      const netImpact = savings + revenue;
      cumulative += netImpact;
      years.push({ year, annualSavings: savings, infrastructureCost: infraCost, efficiencyMultiplier: Math.round(multiplier * 100) / 100, netImpact: Math.round(netImpact), cumulativeImpact: Math.round(cumulative) });
    }
    return {
      year1: years[0], year2: years[1], year3: years[2],
      totalThreeYearImpact: Math.round(years.reduce((s, y) => s + y.netImpact, 0)),
      compoundedEfficiencyGain: years[2].efficiencyMultiplier,
    };
  }

  /** Per-location ROI breakdown for multi-location operations */
  calculateByLocation(locations: Array<{ id: string; name: string; volumeShare: number }>): LocationROI[] {
    return locations.map((loc) => {
      const locVolume = Math.round(this.baseline.monthlyTransactionVolume * loc.volumeShare);
      const locCurrentCost = Math.round(this.baseline.avgCostPerTransaction * locVolume);
      const savingsRate = (this.projected.automatedTransactionPercent / 100) * EFFICIENCY_DISCOUNT * (this.projected.reducedProcessingHoursPercent / 100);
      const locProjectedCost = Math.round(locCurrentCost * (1 - savingsRate));
      const locSavings = locCurrentCost - locProjectedCost;
      const locROI = locCurrentCost > 0 ? Math.round((locSavings / locCurrentCost) * 100 * 10) / 10 : 0;
      return { locationId: loc.id, locationName: loc.name, transactionVolume: locVolume, currentCost: locCurrentCost, projectedCost: locProjectedCost, savings: locSavings, roiPercent: locROI };
    });
  }

  getDeploymentConfig(): DeploymentConfig { return { ...this.deployment }; }
  getBaseline(): OperationalBaseline { return { ...this.baseline }; }
  getProjectedState(): ProjectedState { return { ...this.projected }; }
}
