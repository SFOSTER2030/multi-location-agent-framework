/**
 * Cross-Location Anomaly Detector
 *
 * Identifies anomalous patterns across multiple business locations
 * by comparing agent performance, transaction patterns, and
 * operational metrics against peer averages and historical baselines.
 *
 * Anomaly types:
 * - Performance anomaly: Location significantly below peer average
 * - Volume anomaly: Sudden spike or drop in transaction volume
 * - Exception anomaly: Exception rate deviation from historical norm
 * - Pattern anomaly: Same exception occurring at multiple locations (systemic issue)
 */

import { supabase } from '../lib/supabase';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: 'info' | 'warning' | 'critical';
  locationId: string;
  locationName: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviation: number; // Standard deviations from mean
  detectedAt: string;
  description: string;
  suggestedAction: string;
  relatedLocations?: string[]; // For pattern anomalies
}

export type AnomalyType = 
  | 'performance_below_peer'
  | 'volume_spike'
  | 'volume_drop'
  | 'exception_rate_spike'
  | 'escalation_rate_spike'
  | 'latency_degradation'
  | 'systemic_exception' // Same exception at 3+ locations
  | 'gap_widening'; // Gap between best and worst location increasing

interface LocationMetrics {
  locationId: string;
  locationName: string;
  healthScore: number;
  transactionVolume: number;
  exceptionRate: number;
  escalationRate: number;
  avgLatencyMs: number;
  cycleTimeDays: number;
}

const DEVIATION_THRESHOLDS = {
  info: 1.5,      // 1.5 standard deviations
  warning: 2.0,   // 2.0 standard deviations
  critical: 3.0,  // 3.0 standard deviations
};

export async function detectAnomalies(organizationId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  // Get current metrics for all locations
  const { data: metricsData } = await supabase
    .from('location_metrics_current')
    .select('*')
    .eq('organization_id', organizationId);

  if (!metricsData || metricsData.length < 3) return anomalies; // Need 3+ locations for meaningful comparison

  const metrics: LocationMetrics[] = metricsData.map(mapMetrics);

  // Check each metric for anomalies
  anomalies.push(...checkMetricAnomalies(metrics, 'healthScore', 'Health Score', true));
  anomalies.push(...checkMetricAnomalies(metrics, 'transactionVolume', 'Transaction Volume', false));
  anomalies.push(...checkMetricAnomalies(metrics, 'exceptionRate', 'Exception Rate', false));
  anomalies.push(...checkMetricAnomalies(metrics, 'escalationRate', 'Escalation Rate', false));
  anomalies.push(...checkMetricAnomalies(metrics, 'avgLatencyMs', 'Average Latency', false));

  // Check for systemic exceptions (same exception at 3+ locations)
  anomalies.push(...await detectSystemicExceptions(organizationId));

  // Check for gap widening between best and worst locations
  anomalies.push(...detectGapWidening(metrics));

  return anomalies.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function checkMetricAnomalies(
  metrics: LocationMetrics[],
  field: keyof LocationMetrics,
  label: string,
  lowerIsBad: boolean
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const values = metrics.map(m => m[field] as number);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);

  if (stdDev === 0) return anomalies; // All locations identical

  for (const location of metrics) {
    const value = location[field] as number;
    const deviation = Math.abs(value - mean) / stdDev;

    if (deviation < DEVIATION_THRESHOLDS.info) continue;

    const isBad = lowerIsBad ? value < mean : value > mean;
    if (!isBad && field !== 'transactionVolume') continue; // Only flag negative anomalies (except volume which flags both)

    const severity = deviation >= DEVIATION_THRESHOLDS.critical ? 'critical' :
      deviation >= DEVIATION_THRESHOLDS.warning ? 'warning' : 'info';

    const type: AnomalyType = field === 'transactionVolume'
      ? (value > mean ? 'volume_spike' : 'volume_drop')
      : field === 'exceptionRate' ? 'exception_rate_spike'
      : field === 'escalationRate' ? 'escalation_rate_spike'
      : field === 'avgLatencyMs' ? 'latency_degradation'
      : 'performance_below_peer';

    anomalies.push({
      id: `${location.locationId}_${field}_${Date.now()}`,
      type,
      severity,
      locationId: location.locationId,
      locationName: location.locationName,
      metric: label,
      currentValue: value,
      expectedValue: mean,
      deviation: parseFloat(deviation.toFixed(2)),
      detectedAt: new Date().toISOString(),
      description: `${location.locationName}: ${label} is ${deviation.toFixed(1)} standard deviations ${value > mean ? 'above' : 'below'} the peer average`,
      suggestedAction: getSuggestedAction(type, deviation, location.locationName),
    });
  }

  return anomalies;
}

async function detectSystemicExceptions(organizationId: string): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];

  // Find exception types occurring at 3+ locations in the last 7 days
  const { data: systemicExceptions } = await supabase
    .rpc('get_systemic_exceptions', {
      org_id: organizationId,
      min_locations: 3,
      days_back: 7,
    });

  if (!systemicExceptions) return anomalies;

  for (const exc of systemicExceptions) {
    anomalies.push({
      id: `systemic_${exc.exception_type}_${Date.now()}`,
      type: 'systemic_exception',
      severity: 'warning',
      locationId: 'organization',
      locationName: 'Cross-Location',
      metric: 'Systemic Exception',
      currentValue: exc.location_count,
      expectedValue: 0,
      deviation: 0,
      detectedAt: new Date().toISOString(),
      description: `"${exc.exception_type}" occurring at ${exc.location_count} locations — likely a systemic issue rather than local problem`,
      suggestedAction: `Investigate root cause centrally. Fix once and deploy update to all ${exc.location_count} affected locations simultaneously.`,
      relatedLocations: exc.location_ids,
    });
  }

  return anomalies;
}

function detectGapWidening(metrics: LocationMetrics[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const scores = metrics.map(m => m.healthScore);
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const gap = best - worst;

  if (gap > 25) {
    const worstLocation = metrics.find(m => m.healthScore === worst)!;
    const bestLocation = metrics.find(m => m.healthScore === best)!;

    anomalies.push({
      id: `gap_${Date.now()}`,
      type: 'gap_widening',
      severity: gap > 40 ? 'critical' : 'warning',
      locationId: worstLocation.locationId,
      locationName: worstLocation.locationName,
      metric: 'Performance Gap',
      currentValue: gap,
      expectedValue: 10, // Target: <10 point gap
      deviation: 0,
      detectedAt: new Date().toISOString(),
      description: `Performance gap between best (${bestLocation.locationName}: ${best}) and worst (${worstLocation.locationName}: ${worst}) is ${gap} points`,
      suggestedAction: `Investigate ${worstLocation.locationName} for operational issues. Consider redeploying pilot configuration from ${bestLocation.locationName}.`,
    });
  }

  return anomalies;
}

function getSuggestedAction(type: AnomalyType, deviation: number, locationName: string): string {
  switch (type) {
    case 'performance_below_peer':
      return `Review agent configuration at ${locationName}. Compare against top-performing peer location. Check for integration issues or process changes.`;
    case 'volume_spike':
      return `Verify volume spike at ${locationName} is expected (seasonal, campaign, etc.). If unexpected, check for duplicate processing or system error.`;
    case 'volume_drop':
      return `Investigate volume drop at ${locationName}. Check for system outage, integration failure, or process change.`;
    case 'exception_rate_spike':
      return `Review exception patterns at ${locationName}. Rising exception rate may indicate process change, data quality issue, or new scenario type.`;
    case 'escalation_rate_spike':
      return `Review authority boundaries at ${locationName}. High escalation rate may indicate boundaries are too restrictive or agent needs additional training.`;
    case 'latency_degradation':
      return `Check system performance at ${locationName}. Latency increase may indicate infrastructure issue, integration bottleneck, or increased processing complexity.`;
    default:
      return `Review operations at ${locationName} and compare against peer locations.`;
  }
}

function mapMetrics(row: any): LocationMetrics {
  return {
    locationId: row.location_id,
    locationName: row.location_name,
    healthScore: row.health_score || 0,
    transactionVolume: row.transaction_volume || 0,
    exceptionRate: row.exception_rate || 0,
    escalationRate: row.escalation_rate || 0,
    avgLatencyMs: row.avg_latency_ms || 0,
    cycleTimeDays: row.cycle_time_days || 0,
  };
}
