/**
 * ROI Benchmarks
 * 
 * Industry benchmark data for comparative analysis when projecting
 * agent deployment ROI. Derived from publicly available industry data —
 * no proprietary client data included.
 * 
 * @module roi/Benchmarks
 */

import type { OperationalBaseline, ProjectedState } from './types';

export interface VerticalBenchmark {
  vertical: string;
  baseline: OperationalBaseline;
  conservativeProjection: ProjectedState;
  aggressiveProjection: ProjectedState;
  notes: string;
}

export const VERTICAL_BENCHMARKS: Record<string, VerticalBenchmark> = {
  mortgage_brokerage: {
    vertical: 'Mortgage Brokerage',
    baseline: {
      monthlyTransactionVolume: 25, avgCostPerTransaction: 950, fullTimeEmployees: 3,
      avgEmployeeCostMonthly: 5_500, manualProcessingHoursPerWeek: 28, errorRatePercent: 4.2,
      avgErrorCostUsd: 375, complianceIncidentsPerYear: 6, avgComplianceCostUsd: 2_800,
      technologySpendMonthly: 1_450, avgProcessingTimeDays: 42, locationCount: 1,
    },
    conservativeProjection: {
      automatedTransactionPercent: 65, reducedProcessingHoursPercent: 45, errorReductionPercent: 55,
      complianceReductionPercent: 60, processingTimeReductionPercent: 30, capacityIncreasePercent: 35,
      technologyConsolidationSavingsMonthly: 400,
    },
    aggressiveProjection: {
      automatedTransactionPercent: 82, reducedProcessingHoursPercent: 65, errorReductionPercent: 78,
      complianceReductionPercent: 85, processingTimeReductionPercent: 48, capacityIncreasePercent: 60,
      technologyConsolidationSavingsMonthly: 650,
    },
    notes: 'Based on independent brokers originating 20-30 loans/month across multiple states.',
  },
  construction_management: {
    vertical: 'Construction Management',
    baseline: {
      monthlyTransactionVolume: 150, avgCostPerTransaction: 85, fullTimeEmployees: 8,
      avgEmployeeCostMonthly: 5_200, manualProcessingHoursPerWeek: 45, errorRatePercent: 6.1,
      avgErrorCostUsd: 1_200, complianceIncidentsPerYear: 4, avgComplianceCostUsd: 5_500,
      technologySpendMonthly: 2_100, avgProcessingTimeDays: 14, locationCount: 3,
    },
    conservativeProjection: {
      automatedTransactionPercent: 60, reducedProcessingHoursPercent: 40, errorReductionPercent: 50,
      complianceReductionPercent: 55, processingTimeReductionPercent: 35, capacityIncreasePercent: 30,
      technologyConsolidationSavingsMonthly: 500,
    },
    aggressiveProjection: {
      automatedTransactionPercent: 78, reducedProcessingHoursPercent: 60, errorReductionPercent: 72,
      complianceReductionPercent: 78, processingTimeReductionPercent: 50, capacityIncreasePercent: 55,
      technologyConsolidationSavingsMonthly: 850,
    },
    notes: 'Based on GCs managing 8-20 active projects with subcontractor coordination.',
  },
  healthcare_practice: {
    vertical: 'Healthcare Practice',
    baseline: {
      monthlyTransactionVolume: 800, avgCostPerTransaction: 22, fullTimeEmployees: 6,
      avgEmployeeCostMonthly: 4_800, manualProcessingHoursPerWeek: 35, errorRatePercent: 3.8,
      avgErrorCostUsd: 450, complianceIncidentsPerYear: 8, avgComplianceCostUsd: 3_200,
      technologySpendMonthly: 1_800, avgProcessingTimeDays: 7, locationCount: 2,
    },
    conservativeProjection: {
      automatedTransactionPercent: 70, reducedProcessingHoursPercent: 50, errorReductionPercent: 60,
      complianceReductionPercent: 65, processingTimeReductionPercent: 38, capacityIncreasePercent: 40,
      technologyConsolidationSavingsMonthly: 450,
    },
    aggressiveProjection: {
      automatedTransactionPercent: 85, reducedProcessingHoursPercent: 68, errorReductionPercent: 80,
      complianceReductionPercent: 85, processingTimeReductionPercent: 55, capacityIncreasePercent: 65,
      technologyConsolidationSavingsMonthly: 750,
    },
    notes: 'Based on multi-provider practices with revenue cycle management and patient scheduling.',
  },
  property_management: {
    vertical: 'Property Management',
    baseline: {
      monthlyTransactionVolume: 1_200, avgCostPerTransaction: 12, fullTimeEmployees: 5,
      avgEmployeeCostMonthly: 4_500, manualProcessingHoursPerWeek: 30, errorRatePercent: 5.5,
      avgErrorCostUsd: 180, complianceIncidentsPerYear: 10, avgComplianceCostUsd: 1_500,
      technologySpendMonthly: 1_200, avgProcessingTimeDays: 3, locationCount: 8,
    },
    conservativeProjection: {
      automatedTransactionPercent: 75, reducedProcessingHoursPercent: 55, errorReductionPercent: 62,
      complianceReductionPercent: 70, processingTimeReductionPercent: 45, capacityIncreasePercent: 50,
      technologyConsolidationSavingsMonthly: 350,
    },
    aggressiveProjection: {
      automatedTransactionPercent: 88, reducedProcessingHoursPercent: 72, errorReductionPercent: 82,
      complianceReductionPercent: 88, processingTimeReductionPercent: 60, capacityIncreasePercent: 70,
      technologyConsolidationSavingsMonthly: 600,
    },
    notes: 'Based on firms managing 200-1,500 units across multiple properties.',
  },
  pe_portfolio_operations: {
    vertical: 'PE Portfolio Operations',
    baseline: {
      monthlyTransactionVolume: 500, avgCostPerTransaction: 45, fullTimeEmployees: 12,
      avgEmployeeCostMonthly: 7_500, manualProcessingHoursPerWeek: 60, errorRatePercent: 3.2,
      avgErrorCostUsd: 2_500, complianceIncidentsPerYear: 5, avgComplianceCostUsd: 8_000,
      technologySpendMonthly: 3_500, avgProcessingTimeDays: 10, locationCount: 12,
    },
    conservativeProjection: {
      automatedTransactionPercent: 58, reducedProcessingHoursPercent: 42, errorReductionPercent: 52,
      complianceReductionPercent: 58, processingTimeReductionPercent: 32, capacityIncreasePercent: 28,
      technologyConsolidationSavingsMonthly: 800,
    },
    aggressiveProjection: {
      automatedTransactionPercent: 75, reducedProcessingHoursPercent: 62, errorReductionPercent: 74,
      complianceReductionPercent: 80, processingTimeReductionPercent: 50, capacityIncreasePercent: 50,
      technologyConsolidationSavingsMonthly: 1_400,
    },
    notes: 'Based on operating partners managing 8-15 portfolio companies with standardized reporting.',
  },
  insurance_agency: {
    vertical: 'Insurance Agency',
    baseline: {
      monthlyTransactionVolume: 200, avgCostPerTransaction: 35, fullTimeEmployees: 4,
      avgEmployeeCostMonthly: 4_800, manualProcessingHoursPerWeek: 25, errorRatePercent: 4.8,
      avgErrorCostUsd: 280, complianceIncidentsPerYear: 7, avgComplianceCostUsd: 2_200,
      technologySpendMonthly: 950, avgProcessingTimeDays: 5, locationCount: 1,
    },
    conservativeProjection: {
      automatedTransactionPercent: 68, reducedProcessingHoursPercent: 48, errorReductionPercent: 58,
      complianceReductionPercent: 62, processingTimeReductionPercent: 35, capacityIncreasePercent: 38,
      technologyConsolidationSavingsMonthly: 250,
    },
    aggressiveProjection: {
      automatedTransactionPercent: 82, reducedProcessingHoursPercent: 65, errorReductionPercent: 76,
      complianceReductionPercent: 82, processingTimeReductionPercent: 52, capacityIncreasePercent: 58,
      technologyConsolidationSavingsMonthly: 500,
    },
    notes: 'Based on independent agencies handling personal and commercial lines across multiple carriers.',
  },
};

export function getAvailableVerticals(): string[] { return Object.keys(VERTICAL_BENCHMARKS); }
export function getBenchmark(vertical: string): VerticalBenchmark | null { return VERTICAL_BENCHMARKS[vertical] ?? null; }
export function compareBenchmarks(a: string, b: string): { a: VerticalBenchmark; b: VerticalBenchmark } | null {
  const va = VERTICAL_BENCHMARKS[a]; const vb = VERTICAL_BENCHMARKS[b];
  if (!va || !vb) return null;
  return { a: va, b: vb };
}
