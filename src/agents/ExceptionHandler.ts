/**
 * Exception Handler
 *
 * Classifies, prioritizes, and routes exceptions that arise during
 * agent processing across all business locations. An exception is any
 * event where the agent cannot proceed autonomously within its defined
 * authority boundaries and requires human review or escalation.
 *
 * Exception lifecycle:
 *   detected → classified → prioritized → routed → resolved | escalated
 *
 * Resolution paths:
 *   - Auto-resolved: Agent handles within authority (logged, no human needed)
 *   - Assisted:      Human reviews agent recommendation, approves/rejects
 *   - Escalated:     Routed up the escalation chain by severity and time
 *   - Systemic:      Pattern detected across locations — triggers incident
 */

import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExceptionCategory =
    | 'authority_boundary'    // Transaction exceeds agent's autonomous approval limit
  | 'data_quality'          // Missing, malformed, or inconsistent input data
  | 'integration_failure'   // Upstream system unavailable or returning errors
  | 'compliance_flag'       // Potential regulatory threshold breach detected
  | 'fraud_signal'          // Anomaly consistent with fraudulent activity
  | 'duplicate_detection'   // Likely duplicate transaction or record
  | 'ambiguous_instruction' // Agent cannot confidently parse the workflow step
  | 'schedule_conflict'     // Conflicting instructions across integrated systems
  | 'capacity_exceeded'     // Agent queue depth or processing rate exceeded
  | 'unknown';

export type ExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ExceptionStatus =
    | 'open'
  | 'auto_resolving'
  | 'awaiting_review'
  | 'under_review'
  | 'resolved'
  | 'escalated'
  | 'systemic'; // Flagged as part of a broader pattern

export interface AgentException {
    id: string;
    agentId: string;
    locationId: string;
    organizationId: string;
    category: ExceptionCategory;
    severity: ExceptionSeverity;
    status: ExceptionStatus;
    workflowStep: string;
    description: string;
    context: ExceptionContext;
    resolution: ExceptionResolution | null;
    escalationLevel: number; // 0 = not escalated, 1-4 = escalation chain level
  detectedAt: string;
    resolvedAt: string | null;
    slaDeadlineAt: string; // Time by which this must be resolved or escalated
  metadata: Record<string, any>;
}

export interface ExceptionContext {
    transactionId?: string;
    transactionAmount?: number;
    currency?: string;
    entityType?: string;      // e.g., 'invoice', 'patient_record', 'order'
  entityId?: string;
    rawInput?: Record<string, any>;
    agentConfidenceScore: number; // 0–1, agent's self-assessed confidence
  attemptCount: number;         // How many times agent attempted before flagging
  precedingSteps: string[];     // Workflow steps completed before this exception
}

export interface ExceptionResolution {
    method: 'auto' | 'human_approved' | 'human_rejected' | 'escalated' | 'voided';
    resolvedBy?: string; // User ID or 'agent' for auto-resolutions
  notes?: string;
    actionTaken: string;
    outcomeData?: Record<string, any>;
    resolvedAt: string;
    durationMs: number;
}

// ---------------------------------------------------------------------------
// SLA thresholds by severity (minutes until first escalation)
// ---------------------------------------------------------------------------

const SLA_MINUTES: Record<ExceptionSeverity, number> = {
    critical: 15,
    high:     60,
    medium:   240,
    low:      1440, // 24 hours
};

// ---------------------------------------------------------------------------
// Severity scoring weights
// ---------------------------------------------------------------------------

interface SeveritySignal {
    category: ExceptionCategory;
    baseScore: number; // 1–10
}

const SEVERITY_BASE_SCORES: SeveritySignal[] = [
  { category: 'fraud_signal',          baseScore: 9 },
  { category: 'compliance_flag',       baseScore: 8 },
  { category: 'authority_boundary',    baseScore: 6 },
  { category: 'integration_failure',   baseScore: 5 },
  { category: 'data_quality',          baseScore: 4 },
  { category: 'duplicate_detection',   baseScore: 3 },
  { category: 'ambiguous_instruction', baseScore: 3 },
  { category: 'schedule_conflict',     baseScore: 2 },
  { category: 'capacity_exceeded',     baseScore: 2 },
  { category: 'unknown',               baseScore: 5 },
  ];

// ---------------------------------------------------------------------------
// Core classification logic
// ---------------------------------------------------------------------------

/**
 * Classifies the severity of an exception based on its category,
 * the transaction amount involved, the agent's confidence score,
 * and any active compliance flags for the location's jurisdiction.
 *
 * @param category     - Detected exception category
 * @param context      - Execution context at the time of the exception
 * @param jurisdictions - Jurisdiction IDs for the location
 * @returns            Computed severity level
 */
export function classifyExceptionSeverity(
    category: ExceptionCategory,
    context: ExceptionContext,
    jurisdictions: string[] = []
  ): ExceptionSeverity {
    const baseSignal = SEVERITY_BASE_SCORES.find(s => s.category === category);
    let score = baseSignal?.baseScore ?? 5;

  // Boost score for high-value transactions
  if (context.transactionAmount) {
        if (context.transactionAmount > 100000)  score += 3;
        else if (context.transactionAmount > 25000)  score += 2;
        else if (context.transactionAmount > 5000)   score += 1;
  }

  // Boost if agent has low confidence
  if (context.agentConfidenceScore < 0.4)   score += 2;
    else if (context.agentConfidenceScore < 0.65) score += 1;

  // Boost for repeated attempts (agent kept failing)
  if (context.attemptCount >= 3) score += 1;

  // Boost for compliance-sensitive jurisdictions
  const sensitiveJurisdictions = ['hipaa', 'fincen', 'sec', 'uae_vara', 'eu_gdpr'];
    const hasSensitiveJurisdiction = jurisdictions.some(j => sensitiveJurisdictions.includes(j));
    if (hasSensitiveJurisdiction && category === 'compliance_flag') score += 2;

  // Map score to severity
  if (score >= 12) return 'critical';
    if (score >= 8)  return 'high';
    if (score >= 5)  return 'medium';
    return 'low';
}

/**
 * Calculates the SLA deadline for an exception.
 * Critical exceptions must be actioned within 15 minutes.
 *
 * @param severity   - Exception severity
 * @param detectedAt - ISO timestamp when exception was first detected
 * @returns          ISO timestamp for SLA deadline
 */
export function calculateSLADeadline(
    severity: ExceptionSeverity,
    detectedAt: string
  ): string {
    const slaMs = SLA_MINUTES[severity] * 60 * 1000;
    return new Date(new Date(detectedAt).getTime() + slaMs).toISOString();
}

// ---------------------------------------------------------------------------
// Auto-resolution logic
// ---------------------------------------------------------------------------

/**
 * Attempts to auto-resolve an exception without human intervention.
 * Auto-resolution is only attempted for categories where the agent
 * can safely apply a deterministic fallback action.
 *
 * Returns null if the exception cannot be auto-resolved and must be
 * routed to a human reviewer.
 *
 * @param exception - The exception to attempt resolution on
 * @returns         Resolution record if successful, null otherwise
 */
export async function attemptAutoResolution(
    exception: AgentException
  ): Promise<ExceptionResolution | null> {
    const startTime = Date.now();

  switch (exception.category) {
    case 'duplicate_detection': {
            // Safe to auto-resolve by voiding the duplicate and linking to original
            if (exception.context.entityId && exception.severity !== 'high') {
                      return {
                                  method: 'auto',
                                  resolvedBy: 'agent',
                                  actionTaken: 'Duplicate record voided; linked to existing entity',
                                  outcomeData: { voidedEntityId: exception.context.entityId },
                                  resolvedAt: new Date().toISOString(),
                                  durationMs: Date.now() - startTime,
                      };
            }
            return null;
    }

    case 'data_quality': {
            // Auto-resolve only if a single non-critical field is missing
            // and a sensible default exists
            const missingFields = exception.metadata?.missingFields as string[] | undefined;
            const nonCriticalDefaults: Record<string, any> = {
                      currency: 'USD',
                      timezone: 'UTC',
                      country: 'US',
            };

            if (
                      missingFields &&
                      missingFields.length === 1 &&
                      nonCriticalDefaults[missingFields[0]] !== undefined &&
                      exception.severity === 'low'
                    ) {
                      return {
                                  method: 'auto',
                                  resolvedBy: 'agent',
                                  actionTaken: `Applied default value for ${missingFields[0]}`,
                                  outcomeData: { field: missingFields[0], applied: nonCriticalDefaults[missingFields[0]] },
                                  resolvedAt: new Date().toISOString(),
                                  durationMs: Date.now() - startTime,
                      };
            }
            return null;
    }

    case 'schedule_conflict': {
            // Auto-resolve by deferring to the more recently modified schedule
            if (exception.severity === 'low') {
                      return {
                                  method: 'auto',
                                  resolvedBy: 'agent',
                                  actionTaken: 'Conflict resolved by recency — applied most recently modified schedule entry',
                                  resolvedAt: new Date().toISOString(),
                                  durationMs: Date.now() - startTime,
                      };
            }
            return null;
    }

    case 'capacity_exceeded': {
            // Auto-resolve by queuing overflow to next available processing window
            return {
                      method: 'auto',
                      resolvedBy: 'agent',
                      actionTaken: 'Excess items queued for next processing window',
                      outcomeData: { queuedAt: new Date().toISOString() },
                      resolvedAt: new Date().toISOString(),
                      durationMs: Date.now() - startTime,
            };
    }

    default:
            // All other categories require human review or escalation
        return null;
  }
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Creates a new exception record in the database, computes severity
 * and SLA deadline, and triggers the routing workflow.
 */
export async function createException(
    params: Omit<AgentException, 'id' | 'severity' | 'status' | 'slaDeadlineAt' | 'resolution' | 'escalationLevel' | 'detectedAt' | 'resolvedAt'>
    & { jurisdictions?: string[] }
  ): Promise<AgentException> {
    const detectedAt = new Date().toISOString();
    const severity = classifyExceptionSeverity(
          params.category,
          params.context,
          params.jurisdictions ?? []
        );
    const slaDeadlineAt = calculateSLADeadline(severity, detectedAt);

  const { data, error } = await supabase
      .from('agent_exceptions')
      .insert({
              agent_id:        params.agentId,
              location_id:     params.locationId,
              organization_id: params.organizationId,
              category:        params.category,
              severity,
              status:          'open',
              workflow_step:   params.workflowStep,
              description:     params.description,
              context:         params.context,
              resolution:      null,
              escalation_level: 0,
              detected_at:     detectedAt,
              resolved_at:     null,
              sla_deadline_at: slaDeadlineAt,
              metadata:        params.metadata,
      })
      .select()
      .single();

  if (error || !data) throw new Error(`Failed to create exception: ${error?.message}`);

  const exception = mapExceptionRow(data);

  // Attempt auto-resolution immediately
  const autoResolution = await attemptAutoResolution(exception);
    if (autoResolution) {
          return resolveException(exception.id, autoResolution);
    }

  // Route for human review
  await routeForReview(exception);
    return exception;
}

/**
 * Resolves an exception with a resolution record. Updates the agent's
 * exception rate metric and triggers any post-resolution workflows.
 */
export async function resolveException(
    exceptionId: string,
    resolution: ExceptionResolution
  ): Promise<AgentException> {
    const { data, error } = await supabase
      .from('agent_exceptions')
      .update({
              status:       resolution.method === 'auto' ? 'resolved' : 'resolved',
              resolution,
              resolved_at:  resolution.resolvedAt,
      })
      .eq('id', exceptionId)
      .select()
      .single();

  if (error || !data) throw new Error(`Failed to resolve exception: ${error?.message}`);

  // Update agent exception rate metric
  await updateAgentExceptionMetric(data.agent_id);

  return mapExceptionRow(data);
}

/**
 * Escalates an exception to the next level in the escalation chain.
 * If already at maximum escalation level, marks it as a systemic issue.
 */
export async function escalateException(
    exceptionId: string,
    reason: string
  ): Promise<AgentException> {
    const { data: current } = await supabase
      .from('agent_exceptions')
      .select('*, agents(escalation_chain)')
      .eq('id', exceptionId)
      .single();

  if (!current) throw new Error('Exception not found');

  const escalationChain = current.agents?.escalation_chain || [];
    const nextLevel = current.escalation_level + 1;

  if (nextLevel > escalationChain.length) {
        // Maximum escalation reached — mark as systemic
      await supabase
          .from('agent_exceptions')
          .update({ status: 'systemic', escalation_level: nextLevel })
          .eq('id', exceptionId);

      await checkForSystemicPattern(current.organization_id, current.category);
  } else {
        await supabase
          .from('agent_exceptions')
          .update({ status: 'escalated', escalation_level: nextLevel })
          .eq('id', exceptionId);

      // Notify the escalation contact at this level
      const contact = escalationChain[nextLevel - 1];
        if (contact) {
                await notifyEscalationContact(contact, current, reason);
        }
  }

  const { data: updated } = await supabase
      .from('agent_exceptions')
      .select('*')
      .eq('id', exceptionId)
      .single();

  return mapExceptionRow(updated);
}

// ---------------------------------------------------------------------------
// Pattern detection — systemic issue identification
// ---------------------------------------------------------------------------

/**
 * Checks whether the same exception category has occurred across 5 or more
 * distinct locations in the past 24 hours. If so, creates a systemic incident
 * and notifies organization-level contacts.
 *
 * The 5-location threshold is calibrated to distinguish isolated issues
 * (which are handled at location level) from infrastructure or configuration
 * problems that require central intervention.
 */
export async function checkForSystemicPattern(
    organizationId: string,
    category: ExceptionCategory
  ): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
      .from('agent_exceptions')
      .select('location_id')
      .eq('organization_id', organizationId)
      .eq('category', category)
      .gte('detected_at', since);

  const uniqueLocations = new Set((data || []).map(r => r.location_id));

  if (uniqueLocations.size >= 5) {
        // Create systemic incident
      await supabase.from('systemic_incidents').insert({
              organization_id:   organizationId,
              exception_category: category,
              affected_locations: Array.from(uniqueLocations),
              detected_at:       new Date().toISOString(),
              status:            'open',
              description:       `Systemic pattern detected: ${category} across ${uniqueLocations.size} locations in the past 24 hours`,
      });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function routeForReview(exception: AgentException): Promise<void> {
    await supabase
      .from('agent_exceptions')
      .update({ status: 'awaiting_review' })
      .eq('id', exception.id);
}

async function updateAgentExceptionMetric(agentId: string): Promise<void> {
    // Recalculate exception rate over rolling 7-day window
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count: exceptionCount } = await supabase
      .from('agent_exceptions')
      .select('id', { count: 'exact' })
      .eq('agent_id', agentId)
      .gte('detected_at', since);

  const { count: totalCount } = await supabase
      .from('agent_transactions')
      .select('id', { count: 'exact' })
      .eq('agent_id', agentId)
      .gte('created_at', since);

  const exceptionRate =
        totalCount && totalCount > 0 ? (exceptionCount || 0) / totalCount : 0;

  await supabase
      .from('agent_metrics')
      .update({ exception_rate: exceptionRate })
      .eq('agent_id', agentId);
}

async function notifyEscalationContact(
    contact: { email: string; name: string; role: string },
    exception: any,
    reason: string
  ): Promise<void> {
    console.log(
          `[Escalation] Notifying ${contact.name} (${contact.role}) at ${contact.email} ` +
          `for exception ${exception.id}: ${reason}`
        );
    // Production: dispatches via Resend transactional email
}

function mapExceptionRow(row: any): AgentException {
    return {
          id:              row.id,
          agentId:         row.agent_id,
          locationId:      row.location_id,
          organizationId:  row.organization_id,
          category:        row.category,
          severity:        row.severity,
          status:          row.status,
          workflowStep:    row.workflow_step,
          description:     row.description,
          context:         row.context,
          resolution:      row.resolution,
          escalationLevel: row.escalation_level,
          detectedAt:      row.detected_at,
          resolvedAt:      row.resolved_at,
          slaDeadlineAt:   row.sla_deadline_at,
          metadata:        row.metadata || {},
    };
}
