/**
 * Exception Classifier
 * 
 * Analyzes incoming exception events and assigns severity, resolution layer,
 * and priority ranking based on domain-specific classification rules. The
 * classifier is the entry point for all exceptions — every detected anomaly
 * passes through classification before routing to the appropriate resolution layer.
 * 
 * Classification logic uses a weighted scoring model that evaluates:
 * - Financial exposure relative to transaction value thresholds
 * - Compliance risk based on regulatory domain and jurisdiction
 * - Cascade potential based on downstream workflow dependencies
 * - Time sensitivity based on deadline proximity
 * 
 * @module exceptions/ExceptionClassifier
 */

import type {
  AgentException,
  ExceptionDomain,
  ExceptionSeverity,
  ResolutionLayer,
  ClassificationRule,
  ImpactAssessment,
} from './types';

/** Scoring weights applied during severity calculation */
interface SeverityWeights {
  financialImpact: number;
  complianceRisk: number;
  cascadePotential: number;
  timeSensitivity: number;
}

/** Default weights calibrated across production deployments */
const DEFAULT_WEIGHTS: SeverityWeights = {
  financialImpact: 0.30,
  complianceRisk: 0.35,
  cascadePotential: 0.20,
  timeSensitivity: 0.15,
};

/** Financial thresholds in USD that determine severity bands */
const FINANCIAL_THRESHOLDS = {
  low: 500,
  medium: 5_000,
  high: 25_000,
  critical: 100_000,
} as const;

/** Timeline thresholds in hours that indicate urgency */
const TIMELINE_THRESHOLDS = {
  low: 72,
  medium: 24,
  high: 8,
  critical: 2,
} as const;

/** Built-in classification rules for common exception patterns */
const DEFAULT_RULES: ClassificationRule[] = [
  {
    domain: 'document_processing',
    pattern: 'format_mismatch',
    severityDefault: 'low',
    layerAssignment: 'automatic',
    autoResolveEligible: true,
    maxAutoAttempts: 3,
    escalationTimeoutMinutes: 30,
  },
  {
    domain: 'document_processing',
    pattern: 'data_inconsistency',
    severityDefault: 'medium',
    layerAssignment: 'assisted',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 120,
  },
  {
    domain: 'compliance_monitoring',
    pattern: 'deadline_approaching',
    severityDefault: 'high',
    layerAssignment: 'assisted',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 60,
  },
  {
    domain: 'compliance_monitoring',
    pattern: 'violation_detected',
    severityDefault: 'critical',
    layerAssignment: 'emergency',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 15,
  },
  {
    domain: 'payment_reconciliation',
    pattern: 'amount_mismatch',
    severityDefault: 'medium',
    layerAssignment: 'automatic',
    autoResolveEligible: true,
    maxAutoAttempts: 2,
    escalationTimeoutMinutes: 60,
  },
  {
    domain: 'payment_reconciliation',
    pattern: 'missing_transaction',
    severityDefault: 'high',
    layerAssignment: 'assisted',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 90,
  },
  {
    domain: 'agent_health',
    pattern: 'response_degradation',
    severityDefault: 'medium',
    layerAssignment: 'automatic',
    autoResolveEligible: true,
    maxAutoAttempts: 5,
    escalationTimeoutMinutes: 45,
  },
  {
    domain: 'agent_health',
    pattern: 'complete_failure',
    severityDefault: 'critical',
    layerAssignment: 'emergency',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 5,
  },
  {
    domain: 'integration_failure',
    pattern: 'api_timeout',
    severityDefault: 'low',
    layerAssignment: 'automatic',
    autoResolveEligible: true,
    maxAutoAttempts: 5,
    escalationTimeoutMinutes: 30,
  },
  {
    domain: 'integration_failure',
    pattern: 'schema_mismatch',
    severityDefault: 'high',
    layerAssignment: 'assisted',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 120,
  },
  {
    domain: 'authority_boundary',
    pattern: 'scope_exceeded',
    severityDefault: 'high',
    layerAssignment: 'emergency',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 10,
  },
  {
    domain: 'workflow_deviation',
    pattern: 'unexpected_state',
    severityDefault: 'medium',
    layerAssignment: 'assisted',
    autoResolveEligible: false,
    maxAutoAttempts: 0,
    escalationTimeoutMinutes: 60,
  },
];

export class ExceptionClassifier {
  private rules: ClassificationRule[];
  private weights: SeverityWeights;
  private customOverrides: Map<string, Partial<ClassificationRule>>;

  constructor(
    customRules?: ClassificationRule[],
    weights?: Partial<SeverityWeights>
  ) {
    this.rules = customRules ?? DEFAULT_RULES;
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    this.customOverrides = new Map();
  }

  /**
   * Classifies an exception event and returns severity, layer assignment,
   * and the matched classification rule. This is the primary entry point
   * for all exception processing.
   */
  classify(
    domain: ExceptionDomain,
    pattern: string,
    impact: ImpactAssessment
  ): {
    severity: ExceptionSeverity;
    layer: ResolutionLayer;
    rule: ClassificationRule;
    score: number;
  } {
    const rule = this.findMatchingRule(domain, pattern);
    const score = this.calculateSeverityScore(impact);
    const severity = this.scoreToSeverity(score);
    const layer = this.determineLayer(severity, rule, impact);

    return { severity, layer, rule, score };
  }

  /**
   * Calculates a composite severity score from 0-100 based on
   * weighted impact dimensions.
   */
  private calculateSeverityScore(impact: ImpactAssessment): number {
    const financialScore = this.normalizeFinancial(impact.financialExposure);
    const complianceScore = this.severityToScore(impact.complianceRiskLevel);
    const cascadeScore = impact.cascadeRisk ? 85 : 20;
    const timeScore = this.normalizeTimeline(impact.timelineDaysAtRisk);

    return Math.min(100, Math.round(
      financialScore * this.weights.financialImpact +
      complianceScore * this.weights.complianceRisk +
      cascadeScore * this.weights.cascadePotential +
      timeScore * this.weights.timeSensitivity
    ));
  }

  /** Maps financial exposure to a 0-100 score using threshold bands */
  private normalizeFinancial(amount: number): number {
    if (amount >= FINANCIAL_THRESHOLDS.critical) return 100;
    if (amount >= FINANCIAL_THRESHOLDS.high) return 80;
    if (amount >= FINANCIAL_THRESHOLDS.medium) return 55;
    if (amount >= FINANCIAL_THRESHOLDS.low) return 30;
    return 10;
  }

  /** Maps days-at-risk to urgency score — fewer days = higher score */
  private normalizeTimeline(daysAtRisk: number): number {
    const hoursAtRisk = daysAtRisk * 24;
    if (hoursAtRisk <= TIMELINE_THRESHOLDS.critical) return 100;
    if (hoursAtRisk <= TIMELINE_THRESHOLDS.high) return 80;
    if (hoursAtRisk <= TIMELINE_THRESHOLDS.medium) return 55;
    if (hoursAtRisk <= TIMELINE_THRESHOLDS.low) return 30;
    return 10;
  }

  /** Converts severity enum to numeric score for weighted calculation */
  private severityToScore(severity: ExceptionSeverity): number {
    const scoreMap: Record<ExceptionSeverity, number> = {
      low: 20,
      medium: 50,
      high: 75,
      critical: 100,
    };
    return scoreMap[severity];
  }

  /** Converts composite score to severity classification */
  private scoreToSeverity(score: number): ExceptionSeverity {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 35) return 'medium';
    return 'low';
  }

  /**
   * Determines resolution layer based on severity, rule configuration,
   * and impact assessment. Emergency escalation overrides all other
   * assignments when compliance risk is critical or cascade risk is true.
   */
  private determineLayer(
    severity: ExceptionSeverity,
    rule: ClassificationRule,
    impact: ImpactAssessment
  ): ResolutionLayer {
    if (
      impact.complianceRiskLevel === 'critical' ||
      (impact.cascadeRisk && severity === 'critical')
    ) {
      return 'emergency';
    }

    if (severity === 'critical') return 'emergency';
    if (rule.autoResolveEligible && severity === 'low') return 'automatic';
    if (rule.layerAssignment === 'automatic' && severity !== 'high') return 'automatic';

    return rule.layerAssignment;
  }

  /** Finds the most specific matching rule for the domain/pattern combination */
  private findMatchingRule(
    domain: ExceptionDomain,
    pattern: string
  ): ClassificationRule {
    const overrideKey = `${domain}:${pattern}`;
    const override = this.customOverrides.get(overrideKey);

    const baseRule = this.rules.find(
      (r) => r.domain === domain && r.pattern === pattern
    );

    if (!baseRule) {
      return {
        domain,
        pattern,
        severityDefault: 'medium',
        layerAssignment: 'assisted',
        autoResolveEligible: false,
        maxAutoAttempts: 0,
        escalationTimeoutMinutes: 60,
      };
    }

    return override ? { ...baseRule, ...override } : baseRule;
  }

  /** Registers a custom override for a specific domain/pattern combination */
  addOverride(
    domain: ExceptionDomain,
    pattern: string,
    override: Partial<ClassificationRule>
  ): void {
    this.customOverrides.set(`${domain}:${pattern}`, override);
  }

  /** Returns all registered classification rules for inspection */
  getRules(): ClassificationRule[] {
    return [...this.rules];
  }

  /** Returns current weight configuration */
  getWeights(): SeverityWeights {
    return { ...this.weights };
  }
}
