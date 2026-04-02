/**
 * Exception Handler Types
 * 
 * Type definitions for the three-layer exception handling architecture
 * used across multi-location agent deployments. Defines the classification
 * taxonomy, resolution protocols, and escalation boundaries that govern
 * how agents handle situations outside standard processing parameters.
 * 
 * Architecture: Automatic Resolution → Assisted Resolution → Emergency Escalation
 * 
 * @module exceptions/types
 */

/** Severity tiers that determine routing through the three-layer architecture */
export type ExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Resolution layer assignment based on exception classification */
export type ResolutionLayer = 'automatic' | 'assisted' | 'emergency';

/** Current lifecycle state of an exception instance */
export type ExceptionStatus =
  | 'detected'
  | 'classified'
  | 'routing'
  | 'resolving'
  | 'awaiting_human'
  | 'escalated'
  | 'resolved'
  | 'closed';

/** Operational domain where the exception originated */
export type ExceptionDomain =
  | 'document_processing'
  | 'compliance_monitoring'
  | 'payment_reconciliation'
  | 'agent_health'
  | 'integration_failure'
  | 'data_inconsistency'
  | 'authority_boundary'
  | 'workflow_deviation';

/** Core exception record tracked through the resolution lifecycle */
export interface AgentException {
  id: string;
  agentId: string;
  locationId: string;
  domain: ExceptionDomain;
  severity: ExceptionSeverity;
  layer: ResolutionLayer;
  status: ExceptionStatus;
  summary: string;
  context: ExceptionContext;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolution: ExceptionResolution | null;
  escalationChain: EscalationRecord[];
}

/** Contextual data assembled at detection time to support resolution */
export interface ExceptionContext {
  triggerEvent: string;
  affectedWorkflow: string;
  dataSnapshot: Record<string, unknown>;
  relatedDocuments: string[];
  impactAssessment: ImpactAssessment;
}

/** Quantified impact across operational dimensions */
export interface ImpactAssessment {
  financialExposure: number;
  timelineDaysAtRisk: number;
  complianceRiskLevel: ExceptionSeverity;
  affectedTransactionCount: number;
  cascadeRisk: boolean;
}

/** Resolution record capturing how the exception was closed */
export interface ExceptionResolution {
  layer: ResolutionLayer;
  method: string;
  resolvedBy: string;
  durationMinutes: number;
  preventionRule: string | null;
  notes: string;
}

/** Escalation history entry for audit trail */
export interface EscalationRecord {
  fromLayer: ResolutionLayer;
  toLayer: ResolutionLayer;
  reason: string;
  escalatedAt: Date;
  escalatedBy: string;
}

/** Configuration for exception classification rules per domain */
export interface ClassificationRule {
  domain: ExceptionDomain;
  pattern: string;
  severityDefault: ExceptionSeverity;
  layerAssignment: ResolutionLayer;
  autoResolveEligible: boolean;
  maxAutoAttempts: number;
  escalationTimeoutMinutes: number;
}

/** Aggregate metrics for exception handling performance */
export interface ExceptionMetrics {
  totalDetected: number;
  autoResolved: number;
  assistedResolved: number;
  emergencyEscalated: number;
  averageResolutionMinutes: number;
  resolutionRateByLayer: Record<ResolutionLayer, number>;
  topDomains: Array<{ domain: ExceptionDomain; count: number }>;
  meanTimeToDetection: number;
  meanTimeToResolution: number;
}
