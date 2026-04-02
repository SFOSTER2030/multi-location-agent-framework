/**
 * ROI Calculation Module
 * 
 * Financial modeling engine for agent infrastructure deployment.
 * Includes industry benchmarks for mortgage, construction, healthcare,
 * property management, PE portfolio operations, and insurance.
 * 
 * @module roi
 */

export type {
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

export { ROICalculator } from './ROICalculator';

export {
  VERTICAL_BENCHMARKS,
  getAvailableVerticals,
  getBenchmark,
  compareBenchmarks,
} from './Benchmarks';
export type { VerticalBenchmark } from './Benchmarks';
