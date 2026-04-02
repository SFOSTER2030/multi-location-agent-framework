/**
 * Exception Handling Module
 * 
 * Three-layer exception handling architecture for multi-location
 * agent deployments. Provides classification, routing, and metrics
 * for exceptions across all operational domains.
 * 
 * @module exceptions
 */

export type {
  ExceptionSeverity,
  ResolutionLayer,
  ExceptionStatus,
  ExceptionDomain,
  AgentException,
  ExceptionContext,
  ImpactAssessment,
  ExceptionResolution,
  EscalationRecord,
  ClassificationRule,
  ExceptionMetrics,
} from './types';

export { ExceptionClassifier } from './ExceptionClassifier';
export { ExceptionRouter } from './ExceptionResolver';
export type { ResolverResult } from './ExceptionResolver';
export { ExceptionMetricsTracker } from './ExceptionMetrics';
export type { MetricSnapshot, TrendIndicator } from './ExceptionMetrics';
