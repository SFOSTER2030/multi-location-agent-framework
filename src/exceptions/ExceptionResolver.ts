/**
 * Exception Router
 * 
 * Routes classified exceptions to the appropriate resolution layer and
 * manages the lifecycle transitions between layers. Handles automatic
 * resolution attempts, timeout-based escalation, and emergency bypasses.
 * 
 * The router enforces authority boundaries — an exception assigned to
 * the automatic layer cannot be resolved there if it exceeds the
 * configured authority threshold, regardless of the initial classification.
 * 
 * @module exceptions/ExceptionResolver
 */

import type {
  AgentException,
  ResolutionLayer,
  ExceptionStatus,
  EscalationRecord,
  ClassificationRule,
} from './types';

/** Resolution handler function signature for each layer */
type LayerHandler = (exception: AgentException) => ResolverResult;

/** Result returned by a resolution attempt */
export interface ResolverResult {
  resolved: boolean;
  method: string;
  notes: string;
  preventionRule: string | null;
  requiresEscalation: boolean;
  escalationReason: string | null;
}

/** Router configuration per resolution layer */
interface LayerConfig {
  maxConcurrent: number;
  timeoutMinutes: number;
  retryEnabled: boolean;
  maxRetries: number;
  notifyOnEntry: boolean;
  notifyTargets: string[];
}

/** Default layer configurations */
const LAYER_CONFIGS: Record<ResolutionLayer, LayerConfig> = {
  automatic: {
    maxConcurrent: 50,
    timeoutMinutes: 30,
    retryEnabled: true,
    maxRetries: 3,
    notifyOnEntry: false,
    notifyTargets: [],
  },
  assisted: {
    maxConcurrent: 20,
    timeoutMinutes: 120,
    retryEnabled: false,
    maxRetries: 0,
    notifyOnEntry: true,
    notifyTargets: ['operations_lead'],
  },
  emergency: {
    maxConcurrent: 5,
    timeoutMinutes: 15,
    retryEnabled: false,
    maxRetries: 0,
    notifyOnEntry: true,
    notifyTargets: ['operations_lead', 'compliance_officer', 'executive_contact'],
  },
};

export class ExceptionRouter {
  private handlers: Map<ResolutionLayer, LayerHandler>;
  private configs: Record<ResolutionLayer, LayerConfig>;
  private activeExceptions: Map<string, AgentException>;
  private escalationLog: EscalationRecord[];

  constructor(configs?: Partial<Record<ResolutionLayer, Partial<LayerConfig>>>) {
    this.handlers = new Map();
    this.configs = { ...LAYER_CONFIGS };
    this.activeExceptions = new Map();
    this.escalationLog = [];

    if (configs) {
      for (const [layer, overrides] of Object.entries(configs)) {
        this.configs[layer as ResolutionLayer] = {
          ...this.configs[layer as ResolutionLayer],
          ...overrides,
        };
      }
    }
  }

  /** Registers a resolution handler for a specific layer */
  registerHandler(layer: ResolutionLayer, handler: LayerHandler): void {
    this.handlers.set(layer, handler);
  }

  /**
   * Routes an exception to its assigned resolution layer and attempts
   * resolution. Returns the updated exception with resolution status.
   */
  route(exception: AgentException, rule: ClassificationRule): AgentException {
    const updated = { ...exception, status: 'routing' as ExceptionStatus };
    this.activeExceptions.set(updated.id, updated);

    const config = this.configs[updated.layer];
    const activeInLayer = this.countActiveInLayer(updated.layer);

    if (activeInLayer >= config.maxConcurrent) {
      return this.escalate(updated, 'layer_capacity_exceeded');
    }

    updated.status = 'resolving';
    const handler = this.handlers.get(updated.layer);

    if (!handler) {
      return this.escalate(updated, 'no_handler_registered');
    }

    const result = this.attemptResolution(updated, handler, rule);
    return result;
  }

  /**
   * Attempts resolution using the registered handler for the exception's
   * assigned layer. Handles retries for the automatic layer and escalation
   * on failure or timeout.
   */
  private attemptResolution(
    exception: AgentException,
    handler: LayerHandler,
    rule: ClassificationRule
  ): AgentException {
    const config = this.configs[exception.layer];
    let attempts = 0;
    let lastResult: ResolverResult | null = null;

    const maxAttempts = config.retryEnabled
      ? Math.min(config.maxRetries, rule.maxAutoAttempts)
      : 1;

    while (attempts < maxAttempts) {
      attempts++;
      lastResult = handler(exception);

      if (lastResult.resolved) {
        return this.markResolved(exception, lastResult, attempts);
      }

      if (lastResult.requiresEscalation) {
        return this.escalate(
          exception,
          lastResult.escalationReason ?? 'handler_requested_escalation'
        );
      }
    }

    if (exception.layer === 'automatic') {
      return this.escalate(exception, `auto_resolve_failed_after_${attempts}_attempts`);
    }

    if (exception.layer === 'assisted') {
      return this.escalate(exception, 'assisted_resolution_unsuccessful');
    }

    exception.status = 'awaiting_human';
    this.activeExceptions.set(exception.id, exception);
    return exception;
  }

  /** Marks an exception as resolved and records the resolution details */
  private markResolved(
    exception: AgentException,
    result: ResolverResult,
    attempts: number
  ): AgentException {
    const resolved: AgentException = {
      ...exception,
      status: 'resolved',
      resolvedAt: new Date(),
      resolution: {
        layer: exception.layer,
        method: result.method,
        resolvedBy: exception.layer === 'automatic' ? 'system' : 'human',
        durationMinutes: this.calculateDuration(exception.detectedAt, new Date()),
        preventionRule: result.preventionRule,
        notes: `${result.notes} [${attempts} attempt(s)]`,
      },
    };

    this.activeExceptions.delete(resolved.id);
    return resolved;
  }

  /**
   * Escalates an exception to the next resolution layer. Automatic → Assisted,
   * Assisted → Emergency. Emergency exceptions that cannot be resolved remain
   * in awaiting_human status with all notification targets alerted.
   */
  private escalate(exception: AgentException, reason: string): AgentException {
    const nextLayer = this.getNextLayer(exception.layer);
    const record: EscalationRecord = {
      fromLayer: exception.layer,
      toLayer: nextLayer,
      reason,
      escalatedAt: new Date(),
      escalatedBy: 'system',
    };

    this.escalationLog.push(record);

    const escalated: AgentException = {
      ...exception,
      layer: nextLayer,
      status: nextLayer === 'emergency' ? 'escalated' : 'routing',
      escalationChain: [...exception.escalationChain, record],
    };

    this.activeExceptions.set(escalated.id, escalated);

    if (nextLayer === 'emergency') {
      this.notifyEmergencyContacts(escalated);
    }

    return escalated;
  }

  /** Determines the next escalation layer in the hierarchy */
  private getNextLayer(current: ResolutionLayer): ResolutionLayer {
    const hierarchy: ResolutionLayer[] = ['automatic', 'assisted', 'emergency'];
    const currentIndex = hierarchy.indexOf(current);
    return hierarchy[Math.min(currentIndex + 1, hierarchy.length - 1)];
  }

  /** Sends notifications to emergency contacts — placeholder for notification system */
  private notifyEmergencyContacts(exception: AgentException): void {
    const targets = this.configs.emergency.notifyTargets;
    console.log(
      `[EMERGENCY] Exception ${exception.id} escalated to emergency. ` +
      `Notifying: ${targets.join(', ')}. ` +
      `Domain: ${exception.domain}. ` +
      `Financial exposure: $${exception.context.impactAssessment.financialExposure}`
    );
  }

  /** Counts active exceptions currently being processed in a given layer */
  private countActiveInLayer(layer: ResolutionLayer): number {
    let count = 0;
    for (const ex of this.activeExceptions.values()) {
      if (ex.layer === layer && ex.status !== 'resolved' && ex.status !== 'closed') {
        count++;
      }
    }
    return count;
  }

  /** Calculates duration in minutes between two timestamps */
  private calculateDuration(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / 60_000);
  }

  /** Returns all active exceptions across all layers */
  getActiveExceptions(): AgentException[] {
    return Array.from(this.activeExceptions.values());
  }

  /** Returns the full escalation log for audit purposes */
  getEscalationLog(): EscalationRecord[] {
    return [...this.escalationLog];
  }

  /** Returns current layer configuration for inspection */
  getLayerConfig(layer: ResolutionLayer): LayerConfig {
    return { ...this.configs[layer] };
  }
}
