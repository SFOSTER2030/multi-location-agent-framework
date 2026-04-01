/**
 * Agent Health Monitor
 *
 * Computes, tracks, and evaluates the operational health of AI agents
 * deployed across business locations. Health scoring drives auto-rollback
 * decisions, deployment promotion from parallel to full autonomy, and
 * the cross-location performance rankings in the central dashboard.
 *
 * Health score is a composite 0–100 metric derived from five weighted
 * dimensions that reflect how well an agent is performing its workflow:
 *
 *   Dimension              Weight   What it measures
 *   ─────────────────────────────────────────────────
 *   Accuracy               35%      Correct decisions as % of total processed
 *   Exception Rate         25%      Exceptions per 1,000 transactions (inverted)
 *   Processing Latency     15%      Average ms per item vs. workflow baseline
 *   Escalation Rate        15%      Items escalated vs. total (inverted)
 *   Uptime                 10%      Agent availability over rolling 24h window
 *
 * A health score below 70 triggers an alert.
 * A health score below 50 triggers auto-rollback if the deployment was
 * configured with autoRollback = true.
 */

import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentHealthSnapshot {
    agentId: string;
    locationId: string;
    capturedAt: string;
    dimensions: HealthDimensions;
    compositeScore: number;       // 0–100
  grade: HealthGrade;           // Human-readable tier
  trend: 'improving' | 'stable' | 'degrading';
    alerts: HealthAlert[];
    recommendation: HealthRecommendation;
}

export interface HealthDimensions {
    accuracy: DimensionScore;
    exceptionRate: DimensionScore;
    processingLatency: DimensionScore;
    escalationRate: DimensionScore;
    uptime: DimensionScore;
}

export interface DimensionScore {
    rawValue: number;       // The actual measured value
  normalizedScore: number; // 0–100 normalized for this dimension
  weight: number;          // Contribution weight (sum across dimensions = 1.0)
  weightedScore: number;   // normalizedScore * weight
  status: 'healthy' | 'warning' | 'critical';
}

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface HealthAlert {
    dimension: keyof HealthDimensions;
    severity: 'warning' | 'critical';
    message: string;
    threshold: number;
    actualValue: number;
}

export type HealthRecommendation =
    | 'promote_to_autonomy'     // Parallel agent ready for full autonomy
  | 'continue_monitoring'     // Normal operations, no action required
  | 'investigate'             // Score declining — review configuration
  | 'adjust_boundaries'       // Too many authority escalations — boundaries too tight
  | 'check_integrations'      // High latency suggests upstream system issues
  | 'rollback';               // Score below rollback threshold

// ---------------------------------------------------------------------------
// Scoring configuration
// ---------------------------------------------------------------------------

const DIMENSION_WEIGHTS = {
    accuracy:          0.35,
    exceptionRate:     0.25,
    processingLatency: 0.15,
    escalationRate:    0.15,
    uptime:            0.10,
} as const;

/** Warning/critical thresholds for each raw dimension value */
const DIMENSION_THRESHOLDS = {
    accuracy: {
          healthy:  0.97,   // >= 97% accuracy = healthy
          warning:  0.93,   // 93–96% = warning
          // < 93% = critical
    },
    exceptionRate: {
          // Exceptions per 1,000 transactions
      healthy:  5,      // <= 5/1k = healthy
          warning:  15,     // 6–15/1k = warning
          // > 15/1k = critical
    },
    processingLatency: {
          // % of baseline latency (1.0 = on target, 2.0 = 2x slower)
      healthy:  1.3,    // <= 130% of baseline = healthy
          warning:  2.0,    // 131–200% = warning
          // > 200% = critical
    },
    escalationRate: {
          // Escalations per 1,000 transactions
      healthy:  3,      // <= 3/1k = healthy
          warning:  10,     // 4–10/1k = warning
          // > 10/1k = critical
    },
    uptime: {
          healthy:  0.995,  // >= 99.5% = healthy
          warning:  0.98,   // 98–99.4% = warning
          // < 98% = critical
    },
};

const ROLLBACK_THRESHOLD  = 50;
const ALERT_THRESHOLD     = 70;
const PROMOTE_THRESHOLD   = 85; // Minimum score to promote from parallel to full autonomy

// ---------------------------------------------------------------------------
// Core scoring functions
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw dimension value to a 0–100 score. Each dimension
 * uses a different normalization curve based on whether higher or lower
 * raw values are desirable.
 */
function normalizeDimension(
    dimension: keyof HealthDimensions,
    rawValue: number
  ): number {
    switch (dimension) {
      case 'accuracy':
              // Linear: 100% accuracy = 100, 90% = 0
        return Math.max(0, Math.min(100, ((rawValue - 0.90) / 0.10) * 100));

      case 'exceptionRate':
              // Inverted: 0 exceptions = 100, 20+ exceptions = 0
        return Math.max(0, Math.min(100, ((20 - rawValue) / 20) * 100));

      case 'processingLatency':
              // Inverted: 1.0x baseline = 100, 3.0x baseline = 0
        return Math.max(0, Math.min(100, ((3.0 - rawValue) / 2.0) * 100));

      case 'escalationRate':
              // Inverted: 0 escalations = 100, 15+ escalations = 0
        return Math.max(0, Math.min(100, ((15 - rawValue) / 15) * 100));

      case 'uptime':
              // Linear: 100% uptime = 100, 95% = 0
        return Math.max(0, Math.min(100, ((rawValue - 0.95) / 0.05) * 100));

      default:
              return 0;
    }
}

/**
 * Determines the status label for a dimension based on calibrated thresholds.
 */
function getDimensionStatus(
    dimension: keyof HealthDimensions,
    rawValue: number
  ): DimensionScore['status'] {
    const thresholds = DIMENSION_THRESHOLDS[dimension];

  switch (dimension) {
    case 'accuracy':
    case 'uptime':
            // Higher is better
        if (rawValue >= thresholds.healthy) return 'healthy';
            if (rawValue >= thresholds.warning) return 'warning';
            return 'critical';

    case 'exceptionRate':
    case 'escalationRate':
    case 'processingLatency':
            // Lower is better
        if (rawValue <= thresholds.healthy) return 'healthy';
            if (rawValue <= thresholds.warning) return 'warning';
            return 'critical';
  }
}

/**
 * Builds a complete DimensionScore for a single health dimension.
 */
function scoreDimension(
    dimension: keyof HealthDimensions,
    rawValue: number
  ): DimensionScore {
    const weight = DIMENSION_WEIGHTS[dimension];
    const normalizedScore = normalizeDimension(dimension, rawValue);
    return {
          rawValue,
          normalizedScore,
          weight,
          weightedScore: normalizedScore * weight,
          status: getDimensionStatus(dimension, rawValue),
    };
}

/**
 * Computes the composite health score from all five weighted dimensions.
 * Returns a value in the range 0–100.
 */
function computeCompositeScore(dimensions: HealthDimensions): number {
    return Math.round(
          dimensions.accuracy.weightedScore +
          dimensions.exceptionRate.weightedScore +
          dimensions.processingLatency.weightedScore +
          dimensions.escalationRate.weightedScore +
          dimensions.uptime.weightedScore
        );
}

/**
 * Maps a composite score to a letter grade.
 *
 *   A  90–100  Exemplary — exceeding all benchmarks
 *   B  75–89   Good — minor room for improvement
 *   C  60–74   Acceptable — review recommended
 *   D  50–59   Below threshold — intervention required
 *   F  0–49    Critical — rollback candidate
 */
function scoreToGrade(score: number): HealthGrade {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 50) return 'D';
    return 'F';
}

// ---------------------------------------------------------------------------
// Alert generation
// ---------------------------------------------------------------------------

/**
 * Generates human-readable alerts for any dimension in warning or critical status.
 * Alerts are surfaced in the central dashboard and trigger notifications
 * to the location's escalation chain when severity is 'critical'.
 */
function generateAlerts(dimensions: HealthDimensions): HealthAlert[] {
    const alerts: HealthAlert[] = [];

  const checks: Array<{
        key: keyof HealthDimensions;
        label: string;
        unit: string;
        formatter: (v: number) => string;
  }> = [
    { key: 'accuracy',          label: 'Accuracy',           unit: '%',   formatter: v => `${(v * 100).toFixed(1)}%` },
    { key: 'exceptionRate',     label: 'Exception rate',     unit: '/1k', formatter: v => `${v.toFixed(1)}/1k` },
    { key: 'processingLatency', label: 'Processing latency', unit: 'x',   formatter: v => `${v.toFixed(2)}x baseline` },
    { key: 'escalationRate',    label: 'Escalation rate',    unit: '/1k', formatter: v => `${v.toFixed(1)}/1k` },
    { key: 'uptime',            label: 'Uptime',             unit: '%',   formatter: v => `${(v * 100).toFixed(2)}%` },
      ];

  for (const check of checks) {
        const dim = dimensions[check.key];
        if (dim.status === 'warning' || dim.status === 'critical') {
                const thresholds = DIMENSION_THRESHOLDS[check.key];
                alerts.push({
                          dimension: check.key,
                          severity: dim.status === 'critical' ? 'critical' : 'warning',
                          message: `${check.label} is ${check.formatter(dim.rawValue)} — ${dim.status === 'critical' ? 'critical' : 'below target'}`,
                          threshold: thresholds.healthy,
                          actualValue: dim.rawValue,
                });
        }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Recommendation engine
// ---------------------------------------------------------------------------

/**
 * Produces a single actionable recommendation based on the composite score,
 * trend direction, and which specific dimensions are underperforming.
 */
function generateRecommendation(
    score: number,
    trend: AgentHealthSnapshot['trend'],
    dimensions: HealthDimensions,
    isParallelMode: boolean
  ): HealthRecommendation {
    if (score < ROLLBACK_THRESHOLD) return 'rollback';

  if (
        isParallelMode &&
        score >= PROMOTE_THRESHOLD &&
        trend !== 'degrading'
      ) return 'promote_to_autonomy';

  if (dimensions.processingLatency.status === 'critical') return 'check_integrations';
    if (dimensions.escalationRate.status === 'critical')    return 'adjust_boundaries';
    if (score < ALERT_THRESHOLD || trend === 'degrading')   return 'investigate';

  return 'continue_monitoring';
}

// ---------------------------------------------------------------------------
// Trend calculation
// ---------------------------------------------------------------------------

/**
 * Compares the current composite score against the agent's previous
 * two snapshots to determine if performance is improving, stable, or degrading.
 *
 * Thresholds:
 *   Improving:  Current score >= prior average + 3 points
 *   Degrading:  Current score <= prior average - 3 points
 *   Stable:     Within ±3 points of prior average
 */
async function cavlculateTrend(
    agentId: string,
    currentScore: number
  ): Promise<AgentHealthSnapshot['trend']> {
    const { data } = await supabase
      .from('agent_health_snapshots')
      .select('composite_score')
      .eq('agent_id', agentId)
      .order('captured_at', { ascending: false })
      .limit(2);

  if (!data || data.length < 2) return 'stable';

  const priorAvg = data.reduce((sum, r) => sum + r.composite_score, 0) / data.length;
    const delta = currentScore - priorAvg;

  if (delta >= 3)  return 'improving';
    if (delta <= -3) return 'degrading';
    return 'stable';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Computes a full health snapshot for an agent by pulling its current
 * performance metrics from the database and scoring all five dimensions.
 *
 * @param agentId    - The agent to evaluate
 * @param locationId - The agent's assigned location
 * @returns          Complete health snapshot with score, grade, trend, and recommendations
 */
export async function computeHealthSnapshot(
    agentId: string,
    locationId: string
  ): Promise<AgentHealthSnapshot> {
    const { data: metrics } = await supabase
      .from('agent_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .single();

  if (!metrics) throw new Error(`No metrics found for agent ${agentId}`);

  const { data: agent } = await supabase
      .from('agents')
      .select('status')
      .eq('id', agentId)
      .single();

  const isParallelMode = agent?.status === 'parallel';

  // Build dimensions from raw metric values
  const dimensions: HealthDimensions = {
        accuracy:          scoreDimension('accuracy',          metrics.accuracy_rate ?? 1.0),
        exceptionRate:     scoreDimension('exceptionRate',     (metrics.exception_rate ?? 0) * 1000),
        processingLatency: scoreDimension('processingLatency', (metrics.avg_latency_ms ?? 200) / (metrics.baseline_latency_ms ?? 200)),
        escalationRate:    scoreDimension('escalationRate',    (metrics.escalation_rate ?? 0) * 1000),
        uptime:            scoreDimension('uptime',            (metrics.uptime_percent ?? 100) / 100),
  };

  const compositeScore = computeCompositeScore(dimensions);
    const trend = await calculateTrend(agentId, compositeScore);
    const alerts = generateAlerts(dimensions);
    const recommendation = generateRecommendation(compositeScore, trend, dimensions, isParallelMode);

  const snapshot: AgentHealthSnapshot = {
        agentId,
        locationId,
        capturedAt:    new Date().toISOString(),
        dimensions,
        compositeScore,
        grade:         scoreToGrade(compositeScore),
        trend,
        alerts,
        recommendation,
  };

  // Persist snapshot
  await supabase.from('agent_health_snapshots').insert({
        agent_id:        agentId,
        location_id:     locationId,
        captured_at:     snapshot.capturedAt,
        dimensions:      snapshot.dimensions,
        composite_score: snapshot.compositeScore,
        grade:           snapshot.grade,
        trend:           snapshot.trend,
        alerts:          snapshot.alerts,
        recommendation:  snapshot.recommendation,
  });

  // Trigger rollback if configured and below threshold
  if (recommendation === 'rollback') {
        await triggerAutoRollbackIfConfigured(agentId);
  }

  return snapshot;
}

/**
 * Runs health checks across all active agents for a given organization.
 * Called on a scheduled basis (every 15 minutes in production).
 * Returns a summary of agents that require attention.
 */
export async function runFleetHealthCheck(
    organizationId: string
  ): Promise<{ checked: number; alerts: number; rollbacks: number; promotions: number }> {
    const { data: agents } = await supabase
      .from('agents')
      .select('id, location_id, status')
      .eq('organization_id', organizationId)
      .in('status', ['active', 'parallel']);

  if (!agents || agents.length === 0) {
        return { checked: 0, alerts: 0, rollbacks: 0, promotions: 0 };
  }

  let alerts = 0;
    let rollbacks = 0;
    let promotions = 0;

  for (const agent of agents) {
        const snapshot = await computeHealthSnapshot(agent.id, agent.location_id);

      if (snapshot.alerts.length > 0) alerts++;
        if (snapshot.recommendation === 'rollback') rollbacks++;
        if (snapshot.recommendation === 'promote_to_autonomy') promotions++;
  }

  return { checked: agents.length, alerts, rollbacks, promotions };
}

/**
 * Returns the most recent health snapshot for an agent, or null if
 * no snapshot has been taken within the past 30 minutes.
 */
export async function getLatestSnapshot(
    agentId: string
  ): Promise<AgentHealthSnapshot | null> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data } = await supabase
      .from('agent_health_snapshots')
      .select('*')
      .eq('agent_id', agentId)
      .gte('captured_at', cutoff)
      .order('captured_at', { ascending: false })
      .limit(1)
      .single();

  if (!data) return null;

  return {
        agentId:       data.agent_id,
        locationId:    data.location_id,
        capturedAt:    data.captured_at,
        dimensions:    data.dimensions,
        compositeScore: data.composite_score,
        grade:         data.grade,
        trend:         data.trend,
        alerts:        data.alerts,
        recommendation: data.recommendation,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function triggerAutoRollbackIfConfigured(agentId: string): Promise<void> {
    const { data: agent } = await supabase
      .from('agents')
      .select('auto_rollback, deployment_id, location_id')
      .eq('id', agentId)
      .single();

  if (!agent?.auto_rollback) return;

  await supabase
      .from('agents')
      .update({
              status:         'rolled_back',
              rolled_back_at: new Date().toISOString(),
              rollback_reason: 'health_score_below_threshold',
      })
      .eq('id', agentId);

  // Log rollback event for audit trail
  await supabase.from('agent_events').insert({
        agent_id:    agentId,
        location_id: agent.location_id,
        event_type:  'auto_rollback',
        details:     { reason: 'health_score_below_threshold', threshold: ROLLBACK_THRESHOLD },
        occurred_at: new Date().toISOString(),
  });
}
