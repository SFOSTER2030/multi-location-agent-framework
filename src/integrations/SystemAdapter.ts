/**
 * System Adapter — Abstract Integration Layer
 *
 * Provides a unified interface for agents to interact with
 * different business systems across locations. A single agent
 * can work with Salesforce at Location A and HubSpot at Location B
 * without any changes to the agent's logic.
 *
 * The adapter translates agent commands into system-specific
 * API calls and normalizes responses into a standard format.
 *
 * Supported system types:
 * - CRM (Salesforce, HubSpot, Zoho, Pipedrive)
 * - ERP (NetSuite, QuickBooks, SAP Business One, Xero)
 * - Payment (Stripe, Square, Adyen, stablecoin rails)
 * - HRIS (ADP, Gusto, BambooHR, Paychex)
 * - POS (Toast, Square POS, Clover, Lightspeed)
 * - EHR (via HL7/FHIR adapters)
 * - Practice Management (Clio, MyCase, Kareo)
 */

export type SystemType = 'crm' | 'erp' | 'payment' | 'hris' | 'pos' | 'ehr' | 'practice_mgmt' | 'custom';
export type Provider = string;

export interface SystemConnection {
  id: string;
  locationId: string;
  systemType: SystemType;
  provider: Provider;
  connectionMethod: 'api' | 'webhook' | 'database' | 'file_sync';
  baseUrl: string;
  credentialRef: string; // Reference to secrets manager
  status: 'active' | 'degraded' | 'disconnected';
  lastSyncAt: string;
  syncFrequency: 'realtime' | 'hourly' | 'daily';
  errorCount: number;
  metadata: Record<string, any>;
}

export interface AdapterCommand {
  action: 'read' | 'write' | 'update' | 'delete' | 'search' | 'list';
  entity: string;       // e.g., 'contact', 'invoice', 'transaction', 'patient'
  filters?: Record<string, any>;
  data?: Record<string, any>;
  pagination?: { page: number; limit: number };
}

export interface AdapterResponse {
  success: boolean;
  data: any;
  metadata: {
    provider: Provider;
    systemType: SystemType;
    responseTimeMs: number;
    rateLimitRemaining?: number;
  };
  error?: string;
}

// Entity field mapping per provider
// Maps our standard field names to provider-specific field names
const FIELD_MAPPINGS: Record<string, Record<string, Record<string, string>>> = {
  crm: {
    salesforce: {
      'contact.firstName': 'FirstName',
      'contact.lastName': 'LastName',
      'contact.email': 'Email',
      'contact.phone': 'Phone',
      'contact.company': 'Account.Name',
      'deal.name': 'Opportunity.Name',
      'deal.value': 'Opportunity.Amount',
      'deal.stage': 'Opportunity.StageName',
    },
    hubspot: {
      'contact.firstName': 'firstname',
      'contact.lastName': 'lastname',
      'contact.email': 'email',
      'contact.phone': 'phone',
      'contact.company': 'company',
      'deal.name': 'dealname',
      'deal.value': 'amount',
      'deal.stage': 'dealstage',
    },
    zoho: {
      'contact.firstName': 'First_Name',
      'contact.lastName': 'Last_Name',
      'contact.email': 'Email',
      'contact.phone': 'Phone',
      'contact.company': 'Company',
      'deal.name': 'Deal_Name',
      'deal.value': 'Amount',
      'deal.stage': 'Stage',
    },
  },
  erp: {
    netsuite: {
      'invoice.number': 'tranId',
      'invoice.amount': 'total',
      'invoice.date': 'tranDate',
      'invoice.customer': 'entity',
      'invoice.status': 'status',
      'vendor.name': 'companyName',
      'vendor.balance': 'balance',
    },
    quickbooks: {
      'invoice.number': 'DocNumber',
      'invoice.amount': 'TotalAmt',
      'invoice.date': 'TxnDate',
      'invoice.customer': 'CustomerRef',
      'invoice.status': 'Balance',
      'vendor.name': 'DisplayName',
      'vendor.balance': 'Balance',
    },
    xero: {
      'invoice.number': 'InvoiceNumber',
      'invoice.amount': 'Total',
      'invoice.date': 'Date',
      'invoice.customer': 'Contact.Name',
      'invoice.status': 'Status',
      'vendor.name': 'Name',
      'vendor.balance': 'Balances.AccountsPayable.Outstanding',
    },
  },
};

export class SystemAdapter {
  private connection: SystemConnection;

  constructor(connection: SystemConnection) {
    this.connection = connection;
  }

  async execute(command: AdapterCommand): Promise<AdapterResponse> {
    const startTime = Date.now();

    try {
      // Translate standard field names to provider-specific
      const translatedCommand = this.translateCommand(command);

      // Execute against the provider
      const result = await this.executeProviderCommand(translatedCommand);

      // Normalize the response back to standard field names
      const normalizedData = this.normalizeResponse(command.entity, result);

      return {
        success: true,
        data: normalizedData,
        metadata: {
          provider: this.connection.provider,
          systemType: this.connection.systemType,
          responseTimeMs: Date.now() - startTime,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        data: null,
        metadata: {
          provider: this.connection.provider,
          systemType: this.connection.systemType,
          responseTimeMs: Date.now() - startTime,
        },
        error: err.message,
      };
    }
  }

  private translateCommand(command: AdapterCommand): AdapterCommand {
    const mapping = FIELD_MAPPINGS[this.connection.systemType]?.[this.connection.provider];
    if (!mapping) return command; // No mapping available, pass through

    const translated = { ...command };

    if (command.filters) {
      translated.filters = {};
      for (const [key, value] of Object.entries(command.filters)) {
        const mappedKey = mapping[`${command.entity}.${key}`] || key;
        translated.filters[mappedKey] = value;
      }
    }

    if (command.data) {
      translated.data = {};
      for (const [key, value] of Object.entries(command.data)) {
        const mappedKey = mapping[`${command.entity}.${key}`] || key;
        translated.data[mappedKey] = value;
      }
    }

    return translated;
  }

  private async executeProviderCommand(command: AdapterCommand): Promise<any> {
    // Provider-specific execution
    // In production, this dispatches to provider-specific API clients
    // Here we define the interface contract

    switch (this.connection.connectionMethod) {
      case 'api':
        return this.executeAPICommand(command);
      case 'webhook':
        return this.executeWebhookCommand(command);
      case 'database':
        return this.executeDatabaseCommand(command);
      case 'file_sync':
        return this.executeFileSyncCommand(command);
      default:
        throw new Error(`Unsupported connection method: ${this.connection.connectionMethod}`);
    }
  }

  private async executeAPICommand(command: AdapterCommand): Promise<any> {
    // HTTP API execution against provider
    const url = `${this.connection.baseUrl}/${command.entity}`;
    const method = {
      read: 'GET',
      write: 'POST',
      update: 'PATCH',
      delete: 'DELETE',
      search: 'POST',
      list: 'GET',
    }[command.action];

    // Credential retrieval from secrets manager would happen here
    // const credentials = await getSecret(this.connection.credentialRef);

    console.log(`[${this.connection.provider}] ${method} ${url}`);
    // Actual HTTP execution omitted — requires provider-specific client
    return {};
  }

  private async executeWebhookCommand(command: AdapterCommand): Promise<any> {
    // Webhook-based execution for real-time integrations
    console.log(`[${this.connection.provider}] Webhook dispatch: ${command.action} ${command.entity}`);
    return {};
  }

  private async executeDatabaseCommand(command: AdapterCommand): Promise<any> {
    // Direct database connection (used for on-premise systems)
    console.log(`[${this.connection.provider}] DB query: ${command.action} ${command.entity}`);
    return {};
  }

  private async executeFileSyncCommand(command: AdapterCommand): Promise<any> {
    // File-based sync (CSV/XML exchange for legacy systems)
    console.log(`[${this.connection.provider}] File sync: ${command.action} ${command.entity}`);
    return {};
  }

  private normalizeResponse(entity: string, providerData: any): any {
    const mapping = FIELD_MAPPINGS[this.connection.systemType]?.[this.connection.provider];
    if (!mapping || !providerData) return providerData;

    // Reverse the mapping: provider fields → standard fields
    const reverseMapping: Record<string, string> = {};
    for (const [standard, provider] of Object.entries(mapping)) {
      if (standard.startsWith(`${entity}.`)) {
        const standardField = standard.replace(`${entity}.`, '');
        reverseMapping[provider] = standardField;
      }
    }

    if (Array.isArray(providerData)) {
      return providerData.map(item => this.normalizeObject(item, reverseMapping));
    }

    return this.normalizeObject(providerData, reverseMapping);
  }

  private normalizeObject(obj: Record<string, any>, mapping: Record<string, string>): Record<string, any> {
    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const standardKey = mapping[key] || key;
      normalized[standardKey] = value;
    }
    return normalized;
  }

  getConnectionStatus(): SystemConnection['status'] {
    return this.connection.status;
  }

  getProvider(): string {
    return this.connection.provider;
  }
}

export async function getAdapterForLocation(
  locationId: string,
  systemType: SystemType
): Promise<SystemAdapter | null> {
  const { data } = await (await import('../lib/supabase')).supabase
    .from('location_integrations')
    .select('*')
    .eq('location_id', locationId)
    .eq('system_type', systemType)
    .eq('status', 'active')
    .single();

  if (!data) return null;
  return new SystemAdapter(data as SystemConnection);
}

export async function getAllAdaptersForLocation(
  locationId: string
): Promise<Map<SystemType, SystemAdapter>> {
  const { data } = await (await import('../lib/supabase')).supabase
    .from('location_integrations')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'active');

  const adapters = new Map<SystemType, SystemAdapter>();
  if (data) {
    for (const connection of data) {
      adapters.set(connection.system_type as SystemType, new SystemAdapter(connection as SystemConnection));
    }
  }

  return adapters;
}
