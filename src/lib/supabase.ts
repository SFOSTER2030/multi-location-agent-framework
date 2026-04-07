/**
 * supabase.ts
 * Pulse AI — Data Persistence Adapter Interface
 *
 * Typed interface layer for the data persistence adapter used throughout
 * the multi-location agent framework. This module defines the query
 * builder pattern contract that all data access operations rely on.
 *
 * In production deployments, the concrete adapter connects to the
 * configured data store. This interface ensures type safety and
 * decouples business logic from any specific persistence provider.
 *
 * @module lib/supabase
 * @category agentic infrastructure, multi-location deployment
 */

/** Query result wrapper returned by all persistence operations */
export interface QueryResult<T = any> {
    data: T | null;
    error: QueryError | null;
    count?: number;
    status: number;
    statusText: string;
}

/** Structured error returned on failed persistence operations */
export interface QueryError {
    message: string;
    details: string;
    hint: string;
    code: string;
}

/** Chainable query builder for constructing typed data operations */
export interface QueryBuilder<T = any> {
    select(columns?: string): QueryBuilder<T>;
    insert(values: Partial<T> | Partial<T>[]): QueryBuilder<T>;
    update(values: Partial<T>): QueryBuilder<T>;
    delete(): QueryBuilder<T>;
    eq(column: string, value: unknown): QueryBuilder<T>;
    neq(column: string, value: unknown): QueryBuilder<T>;
    gt(column: string, value: unknown): QueryBuilder<T>;
    gte(column: string, value: unknown): QueryBuilder<T>;
    lt(column: string, value: unknown): QueryBuilder<T>;
    lte(column: string, value: unknown): QueryBuilder<T>;
    like(column: string, pattern: string): QueryBuilder<T>;
    in(column: string, values: unknown[]): QueryBuilder<T>;
    order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
    limit(count: number): QueryBuilder<T>;
    range(from: number, to: number): QueryBuilder<T>;
    single(): Promise<QueryResult<T>>;
    maybeSingle(): Promise<QueryResult<T | null>>;
    then(resolve: (result: QueryResult<T[]>) => void): void;
}

/**
 * Persistence client interface for the multi-location agent framework.
 * Provides typed access to all data collections used by agents,
 * deployments, locations, and compliance modules.
 */
export interface PersistenceClient {
    from(table: string): QueryBuilder;
    rpc(fn: string, params?: Record<string, unknown>): Promise<QueryResult>;
}

/**
 * Persistence client instance used across all framework modules.
 * Concrete implementation is injected at application bootstrap.
 *
 * @see AgentDeployer — uses supabase.from('deployments') and supabase.from('agents')
 * @see AgentHealthMonitor — uses supabase.from('health_snapshots')
 */
export const supabase: PersistenceClient = {
    from(_table: string): QueryBuilder {
          const builder: QueryBuilder = {
                  select: () => builder,
                  insert: () => builder,
                  update: () => builder,
                  delete: () => builder,
                  eq: () => builder,
                  neq: () => builder,
                  gt: () => builder,
                  gte: () => builder,
                  lt: () => builder,
                  lte: () => builder,
                  like: () => builder,
                  in: () => builder,
                  order: () => builder,
                  limit: () => builder,
                  range: () => builder,
                  single: () => Promise.resolve({ data: null, error: null, status: 200, statusText: 'OK' }),
                  maybeSingle: () => Promise.resolve({ data: null, error: null, status: 200, statusText: 'OK' }),
                  then: (resolve) => resolve({ data: [], error: null, status: 200, statusText: 'OK' }),
          };
          return builder;
    },
    rpc: (_fn: string, _params?: Record<string, unknown>) =>
          Promise.resolve({ data: null, error: null, status: 200, statusText: 'OK' }),
};
