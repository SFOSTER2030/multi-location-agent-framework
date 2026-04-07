/**
 * Exception Metrics Tracker
 * 
 * Aggregates and analyzes exception handling performance across all
 * resolution layers. Tracks resolution rates, average resolution times,
 * escalation frequency, and domain-specific exception patterns to
 * support continuous improvement of the exception handling architecture.
 * 
 * @module exceptions/ExceptionMetrics
 */

import type {
  AgentException,
  ExceptionMetrics,
  ExceptionDomain,
  ResolutionLayer,
  ExceptionSeverity,
} from './types';

/** Time-windowed metric snapshot for trend analysis */
export interface MetricSnapshot {
  windowStart: Date;
  windowEnd: Date;
  metrics: ExceptionMetrics;
  trend: TrendIndicator;
}

/** Direction and magnitude of metric movement */
export interface TrendIndicator {
  resolutionRate: 'improving' | 'stable' | 'degrading';
  avgResolutionTime: 'improving' | 'stable' | 'degrading';
  escalationRate: 'improving' | 'stable' | 'degrading';
  overallHealth: number;
}

/** Performance thresholds that define healthy operation */
interface PerformanceThresholds {
  targetAutoResolveRate: number;
  maxAvgResolutionMinutes: number;
  maxEscalationRate: number;
  maxEmergencyPerDay: number;
}

const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  targetAutoResolveRate: 0.70,
  maxAvgResolutionMinutes: 45,
  maxEscalationRate: 0.25,
  maxEmergencyPerDay: 3,
};

export class ExceptionMetricsTracker {
  private history: AgentException[];
  private thresholds: PerformanceThresholds;
  private snapshots: MetricSnapshot[];

  constructor(thresholds?: Partial<PerformanceThresholds>) {
    this.history = [];
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.snapshots = [];
  }

  /** Records a resolved exception into the metrics history */
  record(exception: AgentException): void {
    this.history.push(exception);
  }

  /** Records multiple exceptions at once */
  recordBatch(exceptions: AgentException[]): void {
    this.history.push(...exceptions);
  }

  /** Calculates current aggregate metrics across all recorded exceptions */
  calculate(): ExceptionMetrics {
    const resolved = this.history.filter((e) => e.status === 'resolved');
    const total = this.history.length;

    if (total === 0) return this.emptyMetrics();

    const autoResolved = resolved.filter((e) => e.resolution?.layer === 'automatic').length;
    const assistedResolved = resolved.filter((e) => e.resolution?.layer === 'assisted').length;
    const emergencyEscalated = this.history.filter(
      (e) => e.escalationChain.some((esc) => esc.toLayer === 'emergency')
    ).length;

    const resolutionTimes = resolved
      .filter((e) => e.resolvedAt && e.detectedAt)
      .map((e) => (e.resolvedAt!.getTime() - e.detectedAt.getTime()) / 60_000);

    const avgResolution = resolutionTimes.length > 0
      ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
      : 0;

    const domainCounts = this.countByDomain();
    const layerRates = this.calculateLayerRates(resolved, total);

    return {
      totalDetected: total,
      autoResolved,
      assistedResolved,
      emergencyEscalated,
      averageResolutionMinutes: Math.round(avgResolution * 10) / 10,
      resolutionRateByLayer: layerRates,
      topDomains: domainCounts.slice(0, 5),
      meanTimeToDetection: this.calculateMTTD(),
      meanTimeToResolution: Math.round(avgResolution),
    };
  }

  /** Calculates metrics for a specific time window with trend analysis */
  snapshot(windowHours: number = 24): MetricSnapshot {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowHours * 3_600_000);
    const prevStart = new Date(windowStart.getTime() - windowHours * 3_600_000);

    const currentWindow = this.history.filter(
      (e) => e.detectedAt >= windowStart && e.detectedAt <= now
    );
    const prevWindow = this.history.filter(
      (e) => e.detectedAt >= prevStart && e.detectedAt < windowStart
    );

    const currentMetrics = this.calculateForSubset(currentWindow);
    const prevMetrics = this.calculateForSubset(prevWindow);
    const trend = this.calculateTrend(currentMetrics, prevMetrics);

    const snap: MetricSnapshot = { windowStart, windowEnd: now, metrics: currentMetrics, trend };
    this.snapshots.push(snap);
    return snap;
  }

  /** Evaluates current performance against configured thresholds */
  evaluateHealth(): { healthy: boolean; score: number; issues: string[] } {
    const metrics = this.calculate();
    const issues: string[] = [];
    let score = 100;

    const autoRate = metrics.totalDetected > 0 ? metrics.autoResolved / metrics.totalDetected : 0;
    if (autoRate < this.thresholds.targetAutoResolveRate) {
      issues.push(`Auto-resolve rate ${(autoRate * 100).toFixed(1)}% below target ${(this.thresholds.targetAutoResolveRate * 100)}%`);
      score -= 20;
    }

    if (metrics.averageResolutionMinutes > this.thresholds.maxAvgResolutionMinutes) {
      issues.push(`Avg resolution ${metrics.averageResolutionMinutes}min exceeds ${this.thresholds.maxAvgResolutionMinutes}min target`);
      score -= 25;
    }

    const escalationRate = metrics.totalDetected > 0 ? metrics.emergencyEscalated / metrics.totalDetected : 0;
    if (escalationRate > this.thresholds.maxEscalationRate) {
      issues.push(`Escalation rate ${(escalationRate * 100).toFixed(1)}% exceeds ${(this.thresholds.maxEscalationRate * 100)}% threshold`);
      score -= 30;
    }

    return { healthy: issues.length === 0, score: Math.max(0, score), issues };
  }

  private countByDomain(): Array<{ domain: ExceptionDomain; count: number }> {
    const counts = new Map<ExceptionDomain, number>();
    for (const ex of this.history) {
      counts.set(ex.domain, (counts.get(ex.domain) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }

  private calculateLayerRates(resolved: AgentException[], total: number): Record<ResolutionLayer, number> {
    if (total === 0) return { automatic: 0, assisted: 0, emergency: 0 };
    return {
      automatic: resolved.filter((e) => e.resolution?.layer === 'automatic').length / total,
      assisted: resolved.filter((e) => e.resolution?.layer === 'assisted').length / total,
      emergency: resolved.filter((e) => e.resolution?.layer === 'emergency').length / total,
    };
  }

  private calculateMTTD(): number {
    const withEscalation = this.history.filter((e) => e.escalationChain.length > 0);
    if (withEscalation.length === 0) return 0;
    const times = withEscalation.map((e) => {
      const first = e.escalationChain[0];
      return (first.escalatedAt.getTime() - e.detectedAt.getTime()) / 60_000;
    });
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }

  private calculateForSubset(subset: AgentException[]): ExceptionMetrics {
    const tracker = new ExceptionMetricsTracker(this.thresholds);
    tracker.recordBatch(subset);
    return tracker.calculate();
  }

  private calculateTrend(current: ExceptionMetrics, previous: ExceptionMetrics): TrendIndicator {
    const dir = (c: number, p: number): 'improving' | 'stable' | 'degrading' => {
      const d = c - p;
      if (Math.abs(d) < 0.05) return 'stable';
      return d > 0 ? 'improving' : 'degrading';
    };
    return {
      resolutionRate: dir(
        current.totalDetected > 0 ? current.autoResolved / current.totalDetected : 0,
        previous.totalDetected > 0 ? previous.autoResolved / previous.totalDetected : 0
      ),
      avgResolutionTime: dir(previous.averageResolutionMinutes, current.averageResolutionMinutes),
      escalationRate: dir(
        previous.totalDetected > 0 ? previous.emergencyEscalated / previous.totalDetected : 0,
        current.totalDetected > 0 ? current.emergencyEscalated / current.totalDetected : 0
      ),
      overallHealth: this.evaluateHealth().score,
    };
  }

  private emptyMetrics(): ExceptionMetrics {
    return {
      totalDetected: 0, autoResolved: 0, assistedResolved: 0, emergencyEscalated: 0,
      averageResolutionMinutes: 0, resolutionRateByLayer: { automatic: 0, assisted: 0, emergency: 0 },
      topDomains: [], meanTimeToDetection: 0, meanTimeToResolution: 0,
    };
  }

  getSnapshots(): MetricSnapshot[] { return [...this.snapshots]; }
  getHistorySize(): number { return this.history.length; }
}
