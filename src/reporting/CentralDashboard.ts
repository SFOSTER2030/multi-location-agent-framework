/**
 * Central Dashboard — Cross-Location Reporting Aggregation
 *
 * Aggregates metrics from all locations into a unified dashboard view.
 * Supports drill-down from organization → region → location → department → agent.
 *
 * Metrics aggregated:
 * - Transaction volumes (total, by workflow, by location)
 * - Agent health scores (average, min, max across fleet)
 * - Exception rates (total, by category, by location)
 * - Escalation rates and SLA compliance
 * - ROI metrics (per location, per workflow, aggregate)
 * - Compliance status across all jurisdictions
 */

import { supabase } from '../lib/supabase';

export interface DashboardView {
  organizationId: string;
  generatedAt: string;
  summary: OrganizationSummary;
  regions: RegionSummary[];
  topPerformers: LocationRanking[];
  bottomPerformers: LocationRanking[];
  alerts: DashboardAlert[];
  trends: TrendData;
}

interface OrganizationSummary {
  totalLocations: number;
  activeLocations: number;
  totalAgents: number;
  activeAgents: number;
  avgHealthScore: number;
  totalTransactionsToday: number;
  totalTransactionsWeek: number;
  totalTransactionsMonth: number;
  overallExceptionRate: number;
  overallEscalationRate: number;
  aggregateROI: {
    totalInvested: number;
    totalReturned: number;
    roiPercent: number;
  };
  complianceStatus: {
    compliantLocations: number;
    totalLocations: number;
    openViolations: number;
  };
}

interface RegionSummary {
  regionId: string;
  regionName: string;
  locationCount: number;
  avgHealthScore: number;
  totalTransactions: number;
  exceptionRate: number;
  escalationRate: number;
  topLocation: string;
  bottomLocation: string;
}

interface LocationRanking {
  locationId: string;
  locationName: string;
  regionName: string;
  healthScore: number;
  transactionVolume: number;
  exceptionRate: number;
  roiPercent: number;
}

interface DashboardAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  locationName: string;
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

interface TrendData {
  daily: TrendPoint[];
  weekly: TrendPoint[];
  monthly: TrendPoint[];
}

interface TrendPoint {
  date: string;
  transactions: number;
  healthScore: number;
  exceptionRate: number;
  escalationRate: number;
}

export async function generateDashboard(organizationId: string): Promise<DashboardView> {
  const [summary, regions, rankings, alerts, trends] = await Promise.all([
    getOrganizationSummary(organizationId),
    getRegionSummaries(organizationId),
    getLocationRankings(organizationId),
    getActiveAlerts(organizationId),
    getTrendData(organizationId),
  ]);

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    summary,
    regions,
    topPerformers: rankings.slice(0, 5),
    bottomPerformers: rankings.slice(-5).reverse(),
    alerts,
    trends,
  };
}

async function getOrganizationSummary(orgId: string): Promise<OrganizationSummary> {
  const { data: locations } = await supabase
    .from('locations')
    .select('id, status')
    .eq('organization_id', orgId);

  const { data: agents } = await supabase
    .from('agents')
    .select('id, status, location_id')
    .eq('organization_id', orgId);

  const { data: metrics } = await supabase
    .from('organization_metrics')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  const { data: compliance } = await supabase
    .from('compliance_violations')
    .select('id')
    .eq('organization_id', orgId)
    .is('resolved_at', null);

  const activeLocations = locations?.filter(l => l.status === 'active') || [];
  const activeAgents = agents?.filter(a => a.status === 'active' || a.status === 'parallel') || [];

  return {
    totalLocations: locations?.length || 0,
    activeLocations: activeLocations.length,
    totalAgents: agents?.length || 0,
    activeAgents: activeAgents.length,
    avgHealthScore: metrics?.avg_health_score || 0,
    totalTransactionsToday: metrics?.transactions_today || 0,
    totalTransactionsWeek: metrics?.transactions_week || 0,
    totalTransactionsMonth: metrics?.transactions_month || 0,
    overallExceptionRate: metrics?.exception_rate || 0,
    overallEscalationRate: metrics?.escalation_rate || 0,
    aggregateROI: {
      totalInvested: metrics?.total_invested || 0,
      totalReturned: metrics?.total_returned || 0,
      roiPercent: metrics?.total_invested > 0
        ? ((metrics.total_returned - metrics.total_invested) / metrics.total_invested) * 100
        : 0,
    },
    complianceStatus: {
      compliantLocations: activeLocations.length - (compliance?.length || 0),
      totalLocations: activeLocations.length,
      openViolations: compliance?.length || 0,
    },
  };
}

async function getRegionSummaries(orgId: string): Promise<RegionSummary[]> {
  const { data } = await supabase
    .from('region_metrics')
    .select('*')
    .eq('organization_id', orgId)
    .order('region_name');

  if (!data) return [];

  return data.map(r => ({
    regionId: r.region_id,
    regionName: r.region_name,
    locationCount: r.location_count,
    avgHealthScore: r.avg_health_score,
    totalTransactions: r.total_transactions,
    exceptionRate: r.exception_rate,
    escalationRate: r.escalation_rate,
    topLocation: r.top_location_name,
    bottomLocation: r.bottom_location_name,
  }));
}

async function getLocationRankings(orgId: string): Promise<LocationRanking[]> {
  const { data } = await supabase
    .from('location_metrics_current')
    .select('*')
    .eq('organization_id', orgId)
    .order('health_score', { ascending: false });

  if (!data) return [];

  return data.map(l => ({
    locationId: l.location_id,
    locationName: l.location_name,
    regionName: l.region_name,
    healthScore: l.health_score,
    transactionVolume: l.transaction_volume,
    exceptionRate: l.exception_rate,
    roiPercent: l.roi_percent,
  }));
}

async function getActiveAlerts(orgId: string): Promise<DashboardAlert[]> {
  const { data } = await supabase
    .from('dashboard_alerts')
    .select('*')
    .eq('organization_id', orgId)
    .eq('acknowledged', false)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(20);

  if (!data) return [];

  return data.map(a => ({
    id: a.id,
    severity: a.severity,
    locationName: a.location_name,
    message: a.message,
    timestamp: a.created_at,
    acknowledged: a.acknowledged,
  }));
}

async function getTrendData(orgId: string): Promise<TrendData> {
  const { data: daily } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('organization_id', orgId)
    .order('date', { ascending: false })
    .limit(30);

  const { data: weekly } = await supabase
    .from('weekly_metrics')
    .select('*')
    .eq('organization_id', orgId)
    .order('week_start', { ascending: false })
    .limit(12);

  const { data: monthly } = await supabase
    .from('monthly_metrics')
    .select('*')
    .eq('organization_id', orgId)
    .order('month_start', { ascending: false })
    .limit(12);

  const mapTrend = (row: any): TrendPoint => ({
    date: row.date || row.week_start || row.month_start,
    transactions: row.transactions || 0,
    healthScore: row.avg_health_score || 0,
    exceptionRate: row.exception_rate || 0,
    escalationRate: row.escalation_rate || 0,
  });

  return {
    daily: (daily || []).map(mapTrend).reverse(),
    weekly: (weekly || []).map(mapTrend).reverse(),
    monthly: (monthly || []).map(mapTrend).reverse(),
  };
}

export async function acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<void> {
  await supabase
    .from('dashboard_alerts')
    .update({ acknowledged: true, acknowledged_by: acknowledgedBy, acknowledged_at: new Date().toISOString() })
    .eq('id', alertId);
}

export async function exportReport(
  organizationId: string,
  format: 'json' | 'csv' | 'pdf'
): Promise<{ url: string; expiresAt: string }> {
  const dashboard = await generateDashboard(organizationId);

  const { data } = await supabase.storage
    .from('reports')
    .upload(
      `${organizationId}/dashboard-${new Date().toISOString().split('T')[0]}.${format}`,
      JSON.stringify(dashboard),
      { contentType: format === 'json' ? 'application/json' : 'text/plain' }
    );

  const { data: signedUrl } = await supabase.storage
    .from('reports')
    .createSignedUrl(data?.path || '', 86400); // 24-hour expiry

  return {
    url: signedUrl?.signedUrl || '',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}
