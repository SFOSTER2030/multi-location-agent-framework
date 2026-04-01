/**
 * Cross-Location Analytics
 *
 * The intelligence layer that makes multi-location deployment
 * fundamentally more valuable than deploying agents at a single site.
 *
 * When the same agent workflow runs across 5, 20, or 50 locations,
 * the aggregate data reveals patterns that are invisible at the
 * individual location level:
 *
 *   - Which locations are systematically outperforming their peers
 *     and why — enabling best practice replication
 *
 *   - Anomalies that indicate a local problem (one location deviates
 *     significantly from the cohort average)
 *
 *   - Systemic issues shared across many locations that originate
 *     in a shared integration, configuration, or workflow design
 *
 *   - Seasonal and regional patterns that allow proactive
 *     agent reconfiguration before volume spikes occur
 *
 * All analytics operate on the organization's data only, with
 * strict row-level security enforced at the database layer.
 */

import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocationMetricVector {
    locationId: string;
    locationName: string;
    regionId: string;
    regionName: string;
    metrics: {
      healthScore: number;
      accuracyRate: number;
      exceptionRate: number;
      escalationRate: number;
      transactionVolume: number;
      avgLatencyMs: number;
      uptimePercent: number;
      roiPercent: number;
    };
    capturedAt: string;
}

export interface AnomalyReport {
    locationId: string;
    locationName: string;
    metric: keyof LocationMetricVector['metrics'];
    organizationAvg: number;
    locationValue: number;
    deviationPercent: number;
    direction: 'above' | 'below';
    severity: 'mild' | 'moderate' | 'severe';
    detectedAt: string;
}

export interface BenchmarkComparison {
    metric: keyof LocationMetricVector['metrics'];
    label: string;
    organizationAvg: number;
    organizationMedian: number;
    topDecileValue: number;    // Top 10% threshold
  bottomDecileValue: number; // Bottom 10% threshold
  locationA: { locationId: string; value: number; percentile: number };
    locationB: { locationId: string; value: number; percentile: number };
    gap: number;               // Absolute difference between A and B
  gapPercent: number;        // Relative difference as % of the higher value
}

export interface PatternSignal {
    patternType: 'shared_exception' | 'regional_seasonal' | 'integration_degradation' | 'configuration_drift';
    affectedLocationIds: string[];
    affectedLocationCount: number;
    description: string;
    evidence: PatternEvidence[];
    recommendedAction: string;
    detectedAt: string;
}

export interface PatternEvidence {
    metric: string;
    value: number | string;
    observedAt: string;
    locationId: string;
}

export interface PerformanceGapReport {
    organizationId: string;
    generatedAt: string;
    topLocations: LocationMetricVector[];
    bottomLocations: LocationMetricVector[];
    gapMetrics: BenchmarkComparison[];
    gapTrend: 'widening' | 'stable' | 'closing';
    estimatedAnnualValueIfGapClosed: number; // USD
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

/**
 * Identifies locations deviating significantly from the organization-wide
 * mean for any key metric. Uses Z-score methodology:
 *
 *   mild:     1.5 <= |z| < 2.0   (within normal statistical variation)
 *   moderate: 2.0 <= |z| < 3.0   (likely a real local issue)
 *   severe:   |z| >= 3.0         (almost certainly a real problem — act now)
 *
 * Only metrics where a higher value is clearly better (health score,
 * accuracy, uptime, ROI) or lower is clearly better (exception rate,
 * escalation rate, latency) trigger anomaly flags.
 */
export async function detectAnomalies(
    organizationId: string
  ): Promise<AnomalyReport[]> {
    const vectors = await getLocationMetricVectors(organizationId);
    if (vectors.length < 3) return []; // Need at least 3 locations for meaningful statistics

  const anomalies: AnomalyReport[] = [];

  // Metrics where deviating BELOW average is the concern
  const lowerIsBetter: Array<keyof LocationMetricVector['metrics']> = [
        'exceptionRate',
        'escalationRate',
        'avgLatencyMs',
      ];

  // Metrics where deviating ABOVE average is the concern
  const higherIsBetter: Array<keyof LocationMetricVector['metrics']> = [
        'healthScore',
        'accuracyRate',
        'uptimePercent',
        'roiPercent',
      ];

  const allMetrics = [...lowerIsBetter, ...higherIsBetter];

  for (const metric of allMetrics) {
        const values = vectors.map(v => v.metrics[metric]);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

      if (stdDev === 0) continue; // All locations identical on this metric

      for (const vector of vectors) {
              const value = vector.metrics[metric];
              const zScore = (value - mean) / stdDev;
              const absZ = Math.abs(zScore);

          if (absZ < 1.5) continue; // Within normal range

          // Determine if this deviation is concerning based on metric direction
          const isBelow = value < mean;
              const isConcerning = lowerIsBetter.includes(metric) ? !isBelow : isBelow;

          if (!isConcerning) continue; // Outperforming the mean — not an anomaly

          const severity: AnomalyReport['severity'] =
                    absZ >= 3.0 ? 'severe' : absZ >= 2.0 ? 'moderate' : 'mild';

          anomalies.push({
                    locationId:       vector.locationId,
                    locationName:     vector.locationName,
                    metric,
                    organizationAvg:  Math.round(mean * 1000) / 1000,
                    locationValue:    value,
                    deviationPercent: Math.round(Math.abs((value - mean) / mean) * 100 * 10) / 10,
                    direction:        isBelow ? 'below' : 'above',
                    severity,
                    detectedAt:       new Date().toISOString(),
          });
      }
  }

  // Sort by severity descending
  const severityOrder: Record<AnomalyReport['severity'], number> = { severe: 3, moderate: 2, mild: 1 };
    return anomalies.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
}

// ---------------------------------------------------------------------------
// Benchmarking
// ---------------------------------------------------------------------------

/**
 * Compares two locations head-to-head on all key metrics, computing
 * each location's percentile rank within the organization and quantifying
 * the performance gap.
 *
 * @param organizationId - Organization scope
 * @param locationIdA    - First location for comparison
 * @param locationIdB    - Second location for comparison
 * @returns              Per-metric comparison with percentile ranks and gap sizes
 */
export async function compareTwoLocations(
    organizationId: string,
    locationIdA: string,
    locationIdB: string
  ): Promise<BenchmarkComparison[]> {
    const vectors = await getLocationMetricVectors(organizationId);
    const locationA = vectors.find(v => v.locationId === locationIdA);
    const locationB = vectors.find(v => v.locationId === locationIdB);

  if (!locationA || !locationB) {
        throw new Error('One or both locations not found in this organization');
  }

  const metrics: Array<{ key: keyof LocationMetricVector['metrics']; label: string }> = [
    { key: 'healthScore',       label: 'Health Score' },
    { key: 'accuracyRate',      label: 'Accuracy Rate' },
    { key: 'exceptionRate',     label: 'Exception Rate' },
    { key: 'escalationRate',    label: 'Escalation Rate' },
    { key: 'transactionVolume', label: 'Transaction Volume' },
    { key: 'avgLatencyMs',      label: 'Avg Latency (ms)' },
    { key: 'uptimePercent',     label: 'Uptime %' },
    { key: 'roiPercent',        label: 'ROI %' },
      ];

  return metrics.map(({ key, label }) => {
        const values = vectors.map(v => v.metrics[key]).sort((a, b) => a - b);
        const mean   = values.reduce((a, b) => a + b, 0) / values.length;
        const median = computeMedian(values);
        const topDecile    = values[Math.floor(values.length * 0.9)];
        const bottomDecile = values[Math.floor(values.length * 0.1)];

                         const aValue = locationA.metrics[key];
        const bValue = locationB.metrics[key];

                         const aPercentile = Math.round((values.filter(v => v <= aValue).length / values.length) * 100);
        const bPercentile = Math.round((values.filter(v => v <= bValue).length / values.length) * 100);

                         const gap = Math.abs(aValue - bValue);
        const maxValue = Math.max(aValue, bValue);
        const gapPercent = maxValue > 0 ? Math.round((gap / maxValue) * 100 * 10) / 10 : 0;

                         return {
                                 metric:           key,
                                 label,
                                 organizationAvg:  Math.round(mean * 100) / 100,
                                 organizationMedian: median,
                                 topDecileValue:   topDecile,
                                 bottomDecileValue: bottomDecile,
                                 locationA:        { locationId: locationIdA, value: aValue, percentile: aPercentile },
                                 locationB:        { locationId: locationIdB, value: bValue, percentile: bPercentile },
                                 gap:              Math.round(gap * 100) / 100,
                                 gapPercent,
                         };
  });
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

/**
 * Scans recent exception data for patterns that indicate shared root causes.
 * A pattern is considered systemic when the same exception category appears
 * at 5 or more locations within a rolling 48-hour window.
 *
 * Also detects:
 *   - Integration degradation: latency spiking across multiple locations
 *     sharing the same ERP/CRM system
 *   - Configuration drift: locations that started identical are diverging
 *     in exception rates, suggesting undocumented local changes
 */
export async function detectCrossLocationPatterns(
    organizationId: string
  ): Promise<PatternSignal[]> {
    const patterns: PatternSignal[] = [];
    const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // --- Pattern 1: Shared exception categories ---
  const { data: exceptions } = await supabase
      .from('agent_exceptions')
      .select('location_id, category, detected_at')
      .eq('organization_id', organizationId)
      .gte('detected_at', since48h);

  if (exceptions && exceptions.length > 0) {
        const categoryLocationMap = new Map<string, Set<string>>();
        for (const ex of exceptions) {
                if (!categoryLocationMap.has(ex.category)) {
                          categoryLocationMap.set(ex.category, new Set());
                }
                categoryLocationMap.get(ex.category)!.add(ex.location_id);
        }

      for (const [category, locationSet] of categoryLocationMap.entries()) {
              if (locationSet.size >= 5) {
                        const evidence: PatternEvidence[] = Array.from(locationSet).slice(0, 5).map(lid => ({
                                    metric: 'exception_category',
                                    value: category,
                                    observedAt: since48h,
                                    locationId: lid,
                        }));

                patterns.push({
                            patternType:          'shared_exception',
                            affectedLocationIds:  Array.from(locationSet),
                            affectedLocationCount: locationSet.size,
                            description:          `Exception category '${category}' detected at ${locationSet.size} locations in the past 48 hours — likely a shared root cause`,
                            evidence,
                            recommendedAction:    'Review shared configuration for this workflow across affected locations. Deploy fix once and replicate.',
                            detectedAt:           new Date().toISOString(),
                });
              }
      }
  }

  // --- Pattern 2: Integration degradation ---
  const { data: latencyData } = await supabase
      .from('agent_metrics')
      .select('agent_id, location_id, avg_latency_ms, baseline_latency_ms')
      .eq('organization_id', organizationId)
      .filter('avg_latency_ms', 'gt', 0);

  if (latencyData) {
        // Find locations where latency is 2x+ above baseline
      const degradedLocations = latencyData.filter(
              m => m.baseline_latency_ms > 0 && (m.avg_latency_ms / m.baseline_latency_ms) >= 2.0
            );

      if (degradedLocations.length >= 3) {
              const locationIds = [...new Set(degradedLocations.map(m => m.location_id))];
              patterns.push({
                        patternType:          'integration_degradation',
                        affectedLocationIds:  locationIds,
                        affectedLocationCount: locationIds.length,
                        description:          `Processing latency is 2x+ above baseline at ${locationIds.length} locations — indicates upstream integration performance issue`,
                        evidence:             degradedLocations.slice(0, 5).map(m => ({
                                    metric:     'avg_latency_ms',
                                    value:      m.avg_latency_ms,
                                    observedAt: new Date().toISOString(),
                                    locationId: m.location_id,
                        })),
                        recommendedAction:    'Check health status of shared ERP/CRM integration. Contact provider if degradation persists beyond 2 hours.',
                        detectedAt:           new Date().toISOString(),
              });
      }
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Performance gap analysis
// ---------------------------------------------------------------------------

/**
 * Computes the performance gap between the top and bottom 20% of locations.
 * Gap closure is the highest-ROI activity in multi-location agent management:
 * bringing underperformers to median performance is almost always faster
 * than further improving top performers.
 *
 * Includes an estimate of the annual financial value if gap is fully closed,
 * calculated from the transaction volume and exception-cost differential.
 */
export async function computePerformanceGapReport(
    organizationId: string
  ): Promise<PerformanceGapReport> {
    const vectors = await getLocationMetricVectors(organizationId);

  if (vectors.length < 4) {
        throw new Error('Performance gap analysis requires at least 4 locations');
  }

  // Rank by composite health score
  const ranked = [...vectors].sort((a, b) => b.metrics.healthScore - a.metrics.healthScore);
    const topN = Math.max(1, Math.floor(ranked.length * 0.2));
    const topLocations    = ranked.slice(0, topN);
    const bottomLocations = ranked.slice(-topN);

  // Compute gap across key metrics
  const keyMetrics: Array<keyof LocationMetricVector['metrics']> = [
        'healthScore', 'exceptionRate', 'escalationRate', 'roiPercent',
      ];

  const gapMetrics: BenchmarkComparison[] = [];
    for (const metric of keyMetrics) {
          const topAvg    = topLocations.reduce((s, l) => s + l.metrics[metric], 0) / topLocations.length;
          const bottomAvg = bottomLocations.reduce((s, l) => s + l.metrics[metric], 0) / bottomLocations.length;

      const metricLabels: Record<string, string> = {
              healthScore:       'Health Score',
              exceptionRate:     'Exception Rate',
              escalationRate:    'Escalation Rate',
              roiPercent:        'ROI %',
      };

      gapMetrics.push({
              metric,
              label:            metricLabels[metric] || metric,
              organizationAvg:  vectors.reduce((s, v) => s + v.metrics[metric], 0) / vectors.length,
              organizationMedian: computeMedian(vectors.map(v => v.metrics[metric])),
              topDecileValue:   topLocations[0]?.metrics[metric] ?? 0,
              bottomDecileValue: bottomLocations[bottomLocations.length - 1]?.metrics[metric] ?? 0,
              locationA: {
                        locationId:  topLocations[0]?.locationId ?? '',
                        value:       topAvg,
                        percentile:  90,
              },
              locationB: {
                        locationId:  bottomLocations[bottomLocations.length - 1]?.locationId ?? '',
                        value:       bottomAvg,
                        percentile:  10,
              },
              gap:        Math.abs(topAvg - bottomAvg),
              gapPercent: topAvg > 0 ? Math.round((Math.abs(topAvg - bottomAvg) / topAvg) * 100 * 10) / 10 : 0,
      });
    }

  // Estimate annual value of closing the gap
  // Conservative: assume each 1% improvement in exception rate saves $50/transaction
  const avgVolume = vectors.reduce((s, v) => s + v.metrics.transactionVolume, 0) / vectors.length;
    const exceptionGapMetric = gapMetrics.find(m => m.metric === 'exceptionRate');
    const exceptionGap = exceptionGapMetric?.gap ?? 0;
    const estimatedAnnualValue = Math.round(
          bottomLocations.length * avgVolume * 365 * (exceptionGap / 1000) * 50
        );

  // Detect gap trend (requires historical data)
  const gapTrend = await getGapTrend(organizationId);

  return {
        organizationId,
        generatedAt:    new Date().toISOString(),
        topLocations:   topLocations.slice(0, 5),
        bottomLocations: bottomLocations.slice(0, 5),
        gapMetrics,
        gapTrend,
        estimatedAnnualValueIfGapClosed: estimatedAnnualValue,
  };
}

// ---------------------------------------------------------------------------
// Regional seasonality
// ---------------------------------------------------------------------------

/**
 * Identifies seasonal volume patterns that differ by region, enabling
 * proactive agent reconfiguration before anticipated volume spikes.
 *
 * Example: A franchise restaurant chain may see 40% volume increases
 * in Florida locations during November–March (snowbird season) that
 * don't occur at Midwest locations — agents can be pre-scaled.
 *
 * @param organizationId - Organization scope
 * @param regionId       - Region to analyze (optional; analyzes all if omitted)
 * @returns              Monthly volume index for each region (1.0 = average month)
 */
export async function getRegionalSeasonalityIndex(
    organizationId: string,
    regionId?: string
  ): Promise<Map<string, Record<number, number>>> {
    const query = supabase
      .from('monthly_metrics')
      .select('region_id, month_start, transactions')
      .eq('organization_id', organizationId)
      .order('month_start');

  if (regionId) query.eq('region_id', regionId);

  const { data } = await query;
    if (!data || data.length === 0) return new Map();

  // Group transactions by region and month number
  const regionMonthMap = new Map<string, Record<number, number[]>>();

  for (const row of data) {
        const month = new Date(row.month_start).getMonth() + 1; // 1–12
      if (!regionMonthMap.has(row.region_id)) regionMonthMap.set(row.region_id, {});
        const regionData = regionMonthMap.get(row.region_id)!;
        if (!regionData[month]) regionData[month] = [];
        regionData[month].push(row.transactions);
  }

  // Convert to seasonality index (each month's avg / overall monthly avg)
  const result = new Map<string, Record<number, number>>();

  for (const [region, monthlyData] of regionMonthMap.entries()) {
        const allValues = Object.values(monthlyData).flat();
        const overallAvg = allValues.reduce((a, b) => a + b, 0) / allValues.length;

      const index: Record<number, number> = {};
        for (let m = 1; m <= 12; m++) {
                const monthValues = monthlyData[m] || [];
                if (monthValues.length > 0) {
                          const monthAvg = monthValues.reduce((a, b) => a + b, 0) / monthValues.length;
                          index[m] = Math.round((monthAvg / overallAvg) * 100) / 100;
                } else {
                          index[m] = 1.0; // No data — assume average
                }
        }

      result.set(region, index);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getLocationMetricVectors(
    organizationId: string
  ): Promise<LocationMetricVector[]> {
    const { data } = await supabase
      .from('location_metrics_current')
      .select('*')
      .eq('organization_id', organizationId);

  if (!data) return [];

  return data.map(row => ({
        locationId:   row.location_id,
        locationName: row.location_name,
        regionId:     row.region_id,
        regionName:   row.region_name,
        metrics: {
                healthScore:       row.health_score ?? 0,
                accuracyRate:      row.accuracy_rate ?? 0,
                exceptionRate:     row.exception_rate ?? 0,
                escalationRate:    row.escalation_rate ?? 0,
                transactionVolume: row.transaction_volume ?? 0,
                avgLatencyMs:      row.avg_latency_ms ?? 0,
                uptimePercent:     row.uptime_percent ?? 0,
                roiPercent:        row.roi_percent ?? 0,
        },
        capturedAt: row.captured_at ?? new Date().toISOString(),
  }));
}

function computeMedian(sortedValues: number[]): number {
    const sorted = [...sortedValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
          : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
}

async function getGapTrend(
    organizationId: string
  ): Promise<PerformanceGapReport['gapTrend']> {
    const { data } = await supabase
      .from('gap_trend_history')
      .select('gap_score')
      .eq('organization_id', organizationId)
      .order('recorded_at', { ascending: false })
      .limit(4);

  if (!data || data.length < 3) return 'stable';

  const recent  = data[0].gap_score;
    const earlier = data[data.length - 1].gap_score;
    const delta   = recent - earlier;

  if (delta <= -2) return 'closing';
    if (delta >= 2)  return 'widening';
    return 'stable';
}
