/**
 * Location Manager
 *
 * Handles CRUD operations for business locations within
 * the multi-location agent deployment framework.
 *
 * Manages the hierarchical structure:
 * Organization > Region > Location > Department > Agent
 *
 * Enforces data isolation policies and jurisdiction
 * mapping per location.
 */

import { supabase } from '../lib/supabase';

export interface Location {
  id: string;
  organizationId: string;
  regionId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
  jurisdictions: string[];
  dataIsolationLevel: 'strict' | 'regional' | 'shared';
  status: 'active' | 'onboarding' | 'paused' | 'decommissioned';
  agentCount: number;
  workflowCount: number;
  deploymentDate: string | null;
  franchiseId: string | null;
  metadata: Record<string, any>;
}

export interface LocationHierarchy {
  organization: {
    id: string;
    name: string;
    totalLocations: number;
    totalAgents: number;
  };
  regions: {
    id: string;
    name: string;
    locations: Location[];
    aggregateMetrics: RegionMetrics;
  }[];
}

interface RegionMetrics {
  totalTransactions: number;
  avgHealthScore: number;
  totalExceptions: number;
  escalationRate: number;
}

export async function getLocationHierarchy(organizationId: string): Promise<LocationHierarchy> {
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', organizationId)
    .single();

  const { data: locations } = await supabase
    .from('locations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('region_id, name');

  if (!org || !locations) {
    throw new Error('Organization or locations not found');
  }

  // Group locations by region
  const regionMap = new Map<string, Location[]>();
  for (const loc of locations) {
    const regionId = loc.region_id || 'default';
    if (!regionMap.has(regionId)) {
      regionMap.set(regionId, []);
    }
    regionMap.get(regionId)!.push(mapLocationRow(loc));
  }

  // Build hierarchy with aggregated metrics
  const regions = await Promise.all(
    Array.from(regionMap.entries()).map(async ([regionId, regionLocations]) => {
      const { data: region } = await supabase
        .from('regions')
        .select('id, name')
        .eq('id', regionId)
        .single();

      const metrics = await getRegionMetrics(regionId);

      return {
        id: regionId,
        name: region?.name || 'Default Region',
        locations: regionLocations,
        aggregateMetrics: metrics,
      };
    })
  );

  return {
    organization: {
      id: org.id,
      name: org.name,
      totalLocations: locations.length,
      totalAgents: locations.reduce((sum, l) => sum + (l.agent_count || 0), 0),
    },
    regions,
  };
}

export async function deployAgentToLocation(
  locationId: string,
  agentConfig: {
    name: string;
    workflowType: string;
    authorityBoundaries: Record<string, number>;
    escalationChain: string[];
    complianceModules: string[];
  }
): Promise<{ agentId: string; status: string }> {
  // Get location to determine jurisdiction and isolation requirements
  const { data: location } = await supabase
    .from('locations')
    .select('*')
    .eq('id', locationId)
    .single();

  if (!location) throw new Error('Location not found');

  // Create agent with location-specific configuration
  const { data: agent, error } = await supabase
    .from('agents')
    .insert({
      location_id: locationId,
      organization_id: location.organization_id,
      name: agentConfig.name,
      workflow_type: agentConfig.workflowType,
      authority_boundaries: agentConfig.authorityBoundaries,
      escalation_chain: agentConfig.escalationChain,
      compliance_modules: agentConfig.complianceModules,
      jurisdictions: location.jurisdictions,
      data_isolation_level: location.data_isolation_level,
      status: 'deploying',
    })
    .select()
    .single();

  if (error) throw new Error(`Agent deployment failed: ${error.message}`);

  // Initialize agent monitoring
  await supabase.from('agent_metrics').insert({
    agent_id: agent.id,
    location_id: locationId,
    uptime_percent: 100,
    accuracy_rate: 1.0,
    baseline_latency_ms: 200,
    exception_rate: 0,
    escalation_rate: 0,
  });

  return { agentId: agent.id, status: 'deploying' };
}

export async function replicateAgentAcrossLocations(
  sourceAgentId: string,
  targetLocationIds: string[],
  overrides?: Record<string, Partial<Location>>
): Promise<{ deployed: string[]; failed: string[] }> {
  // Get source agent configuration
  const { data: sourceAgent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', sourceAgentId)
    .single();

  if (!sourceAgent) throw new Error('Source agent not found');

  const deployed: string[] = [];
  const failed: string[] = [];

  for (const locationId of targetLocationIds) {
    try {
      const locationOverrides = overrides?.[locationId] || {};

      const result = await deployAgentToLocation(locationId, {
        name: sourceAgent.name,
        workflowType: sourceAgent.workflow_type,
        authorityBoundaries: {
          ...sourceAgent.authority_boundaries,
          ...(locationOverrides.metadata?.authorityOverrides || {}),
        },
        escalationChain: sourceAgent.escalation_chain,
        complianceModules: sourceAgent.compliance_modules,
      });

      deployed.push(result.agentId);
    } catch (err) {
      console.error(`Failed to deploy to location ${locationId}:`, err);
      failed.push(locationId);
    }
  }

  return { deployed, failed };
}

async function getRegionMetrics(regionId: string): Promise<RegionMetrics> {
  const { data } = await supabase
    .from('location_metrics_aggregate')
    .select('*')
    .eq('region_id', regionId)
    .single();

  return {
    totalTransactions: data?.total_transactions || 0,
    avgHealthScore: data?.avg_health_score || 0,
    totalExceptions: data?.total_exceptions || 0,
    escalationRate: data?.escalation_rate || 0,
  };
}

function mapLocationRow(row: any): Location {
  return {
    id: row.id,
    organizationId: row.organization_id,
    regionId: row.region_id,
    name: row.name,
    address: row.address || '',
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    timezone: row.timezone || 'UTC',
    jurisdictions: row.jurisdictions || [],
    dataIsolationLevel: row.data_isolation_level || 'shared',
    status: row.status || 'active',
    agentCount: row.agent_count || 0,
    workflowCount: row.workflow_count || 0,
    deploymentDate: row.deployment_date,
    franchiseId: row.franchise_id,
    metadata: row.metadata || {},
  };
}
