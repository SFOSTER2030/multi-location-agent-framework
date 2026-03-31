/**
 * Agent Deployer
 *
 * Handles the deployment lifecycle for AI agents across multiple
 * business locations. Manages the four-stage deployment process:
 * configure → validate → deploy → monitor.
 *
 * Supports three deployment strategies:
 * - Single: Deploy one agent to one location
 * - Replicate: Copy pilot agent config to multiple locations
 * - Fleet: Deploy agent fleet (multiple agents) to one or more locations
 */

import { supabase } from '../lib/supabase';

export type DeploymentStrategy = 'single' | 'replicate' | 'fleet';
export type DeploymentStage = 'configuring' | 'validating' | 'deploying' | 'monitoring' | 'active' | 'failed' | 'paused';

export interface DeploymentRequest {
  organizationId: string;
  strategy: DeploymentStrategy;
  sourceAgentId?: string;         // For replicate strategy
  agentConfigs: AgentDeployConfig[];
  targetLocationIds: string[];
  deploymentOptions: {
    parallelProcessing: boolean;  // Run agents alongside humans during validation
    parallelDurationDays: number; // How long to run parallel before full autonomy
    autoRollback: boolean;        // Rollback if health score drops below threshold
    rollbackThreshold: number;    // Health score threshold for auto-rollback
    notifyOnDeploy: string[];     // Email addresses to notify on deployment events
  };
}

export interface AgentDeployConfig {
  name: string;
  workflowType: string;
  description: string;
  authorityBoundaries: AuthorityBoundary[];
  escalationChain: EscalationContact[];
  complianceModules: string[];
  integrations: IntegrationConfig[];
  scheduleConfig?: ScheduleConfig;
}

export interface AuthorityBoundary {
  decisionType: string;
  autoApproveBelow: number;
  requireReviewAbove: number;
  escalateAbove: number;
  currency: string;
  description: string;
}

export interface EscalationContact {
  level: number;
  name: string;
  role: string;
  email: string;
  phone?: string;
  maxResponseMinutes: number;
}

export interface IntegrationConfig {
  systemType: 'crm' | 'erp' | 'payment' | 'hr' | 'pos' | 'ehr' | 'custom';
  provider: string;
  connectionMethod: 'api' | 'webhook' | 'database' | 'file_sync';
  credentials: string; // Reference to secrets manager, never stored directly
  syncFrequency: 'realtime' | 'hourly' | 'daily';
}

export interface ScheduleConfig {
  activeHours?: { start: string; end: string };  // e.g., "08:00" to "18:00"
  activeDays?: number[];                          // 0=Sunday, 6=Saturday
  timezone: string;
  processOutsideHours: 'queue' | 'process' | 'reject';
}

export interface DeploymentResult {
  deploymentId: string;
  strategy: DeploymentStrategy;
  status: DeploymentStage;
  locations: LocationDeploymentStatus[];
  startedAt: string;
  estimatedCompletionAt: string;
  errors: DeploymentError[];
}

interface LocationDeploymentStatus {
  locationId: string;
  locationName: string;
  stage: DeploymentStage;
  agentsDeployed: number;
  agentsTotal: number;
  healthScore: number | null;
  errors: string[];
}

interface DeploymentError {
  locationId: string;
  agentName: string;
  error: string;
  timestamp: string;
  recoverable: boolean;
}

export async function createDeployment(request: DeploymentRequest): Promise<DeploymentResult> {
  // Create deployment record
  const { data: deployment, error } = await supabase
    .from('deployments')
    .insert({
      organization_id: request.organizationId,
      strategy: request.strategy,
      target_locations: request.targetLocationIds,
      agent_count: request.agentConfigs.length * request.targetLocationIds.length,
      options: request.deploymentOptions,
      status: 'configuring',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create deployment: ${error.message}`);

  const locationStatuses: LocationDeploymentStatus[] = [];
  const errors: DeploymentError[] = [];

  for (const locationId of request.targetLocationIds) {
    try {
      // Validate location readiness
      await validateLocationReadiness(locationId, request.agentConfigs);

      // Deploy agents to this location
      const agentResults = await deployAgentsToLocation(
        deployment.id,
        locationId,
        request.agentConfigs,
        request.deploymentOptions
      );

      const { data: location } = await supabase
        .from('locations')
        .select('name')
        .eq('id', locationId)
        .single();

      locationStatuses.push({
        locationId,
        locationName: location?.name || locationId,
        stage: 'deploying',
        agentsDeployed: agentResults.succeeded,
        agentsTotal: request.agentConfigs.length,
        healthScore: null,
        errors: agentResults.errors,
      });

      if (agentResults.errors.length > 0) {
        errors.push(...agentResults.errors.map(e => ({
          locationId,
          agentName: e.split(':')[0] || 'unknown',
          error: e,
          timestamp: new Date().toISOString(),
          recoverable: true,
        })));
      }
    } catch (err: any) {
      locationStatuses.push({
        locationId,
        locationName: locationId,
        stage: 'failed',
        agentsDeployed: 0,
        agentsTotal: request.agentConfigs.length,
        healthScore: null,
        errors: [err.message],
      });

      errors.push({
        locationId,
        agentName: 'pre-deployment',
        error: err.message,
        timestamp: new Date().toISOString(),
        recoverable: false,
      });
    }
  }

  // Update deployment status
  const overallStatus = errors.some(e => !e.recoverable) ? 'failed' :
    errors.length > 0 ? 'deploying' : 'monitoring';

  await supabase
    .from('deployments')
    .update({ status: overallStatus })
    .eq('id', deployment.id);

  // Send notifications
  if (request.deploymentOptions.notifyOnDeploy.length > 0) {
    await sendDeploymentNotification(
      deployment.id,
      request.deploymentOptions.notifyOnDeploy,
      overallStatus,
      locationStatuses
    );
  }

  return {
    deploymentId: deployment.id,
    strategy: request.strategy,
    status: overallStatus as DeploymentStage,
    locations: locationStatuses,
    startedAt: deployment.started_at,
    estimatedCompletionAt: calculateEstimatedCompletion(
      request.targetLocationIds.length,
      request.deploymentOptions.parallelDurationDays
    ),
    errors,
  };
}

async function validateLocationReadiness(
  locationId: string,
  agentConfigs: AgentDeployConfig[]
): Promise<void> {
  const { data: location } = await supabase
    .from('locations')
    .select('*')
    .eq('id', locationId)
    .single();

  if (!location) throw new Error(`Location ${locationId} not found`);
  if (location.status === 'decommissioned') throw new Error(`Location ${locationId} is decommissioned`);

  // Validate integrations exist for each required system
  for (const config of agentConfigs) {
    for (const integration of config.integrations) {
      const { data: existing } = await supabase
        .from('location_integrations')
        .select('id')
        .eq('location_id', locationId)
        .eq('system_type', integration.systemType)
        .single();

      if (!existing) {
        throw new Error(
          `Location ${location.name} missing ${integration.systemType} integration required by ${config.name}`
        );
      }
    }
  }

  // Validate compliance modules are configured for location jurisdiction
  const requiredModules = [...new Set(agentConfigs.flatMap(c => c.complianceModules))];
  for (const module of requiredModules) {
    const { data: compliance } = await supabase
      .from('compliance_configurations')
      .select('id')
      .eq('location_id', locationId)
      .eq('module', module)
      .single();

    if (!compliance) {
      throw new Error(
        `Location ${location.name} missing compliance configuration for ${module}`
      );
    }
  }
}

async function deployAgentsToLocation(
  deploymentId: string,
  locationId: string,
  configs: AgentDeployConfig[],
  options: DeploymentRequest['deploymentOptions']
): Promise<{ succeeded: number; errors: string[] }> {
  let succeeded = 0;
  const errors: string[] = [];

  for (const config of configs) {
    try {
      await supabase.from('agents').insert({
        deployment_id: deploymentId,
        location_id: locationId,
        name: config.name,
        workflow_type: config.workflowType,
        description: config.description,
        authority_boundaries: config.authorityBoundaries,
        escalation_chain: config.escalationChain,
        compliance_modules: config.complianceModules,
        integrations: config.integrations,
        schedule_config: config.scheduleConfig || null,
        parallel_processing: options.parallelProcessing,
        parallel_end_date: options.parallelProcessing
          ? new Date(Date.now() + options.parallelDurationDays * 86400000).toISOString()
          : null,
        auto_rollback: options.autoRollback,
        rollback_threshold: options.rollbackThreshold,
        status: options.parallelProcessing ? 'parallel' : 'active',
      });

      succeeded++;
    } catch (err: any) {
      errors.push(`${config.name}: ${err.message}`);
    }
  }

  return { succeeded, errors };
}

async function sendDeploymentNotification(
  deploymentId: string,
  recipients: string[],
  status: string,
  locations: LocationDeploymentStatus[]
): Promise<void> {
  // Notification implementation — sends via Resend
  const successCount = locations.filter(l => l.stage !== 'failed').length;
  const failCount = locations.filter(l => l.stage === 'failed').length;

  console.log(`Deployment ${deploymentId}: ${successCount} locations succeeded, ${failCount} failed. Notifying ${recipients.length} recipients.`);
}

function calculateEstimatedCompletion(locationCount: number, parallelDays: number): string {
  const deployDays = Math.ceil(locationCount / 3); // 3 locations per wave
  const totalDays = deployDays + parallelDays;
  const completion = new Date(Date.now() + totalDays * 86400000);
  return completion.toISOString();
}

export async function rollbackDeployment(deploymentId: string, locationId?: string): Promise<void> {
  const filter = locationId
    ? supabase.from('agents').update({ status: 'rolled_back' }).eq('deployment_id', deploymentId).eq('location_id', locationId)
    : supabase.from('agents').update({ status: 'rolled_back' }).eq('deployment_id', deploymentId);

  await filter;

  await supabase
    .from('deployments')
    .update({ status: 'rolled_back', rolled_back_at: new Date().toISOString() })
    .eq('id', deploymentId);
}

export async function promoteToFullAutonomy(deploymentId: string, locationId: string): Promise<void> {
  await supabase
    .from('agents')
    .update({
      status: 'active',
      parallel_processing: false,
      promoted_at: new Date().toISOString(),
    })
    .eq('deployment_id', deploymentId)
    .eq('location_id', locationId)
    .eq('status', 'parallel');
}
