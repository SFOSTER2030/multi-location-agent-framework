/**
 * Franchise Rule Enforcement Engine
 *
 * Manages the two-tier configuration model for franchise deployments:
 * - Non-negotiable rules (franchisor-controlled, cannot be modified by franchisees)
 * - Configurable elements (franchisee-controlled within defined boundaries)
 *
 * Monitors compliance across all franchise locations and flags
 * deviations from franchisor standards automatically.
 */

import { supabase } from '../lib/supabase';

export interface FranchiseRule {
  id: string;
  franchiseId: string;
  category: RuleCategory;
  name: string;
  description: string;
  ruleType: 'non_negotiable' | 'configurable';
  enforcement: 'strict' | 'warning' | 'advisory';
  defaultValue: any;
  allowedRange?: { min: any; max: any };
  allowedValues?: any[];
  complianceCheck: string; // Expression or function name for validation
  violationSeverity: 'critical' | 'major' | 'minor';
  lastUpdated: string;
}

export type RuleCategory =
  | 'brand_standards'
  | 'food_safety'
  | 'financial_reporting'
  | 'customer_service'
  | 'data_privacy'
  | 'operational_hours'
  | 'pricing'
  | 'staffing'
  | 'marketing'
  | 'vendor_management';

export interface ComplianceViolation {
  id: string;
  locationId: string;
  locationName: string;
  ruleId: string;
  ruleName: string;
  category: RuleCategory;
  severity: 'critical' | 'major' | 'minor';
  currentValue: any;
  expectedValue: any;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  notes: string;
}

export interface FranchiseComplianceReport {
  franchiseId: string;
  reportDate: string;
  totalLocations: number;
  compliantLocations: number;
  complianceRate: number;
  violations: ComplianceViolation[];
  byCategory: Record<RuleCategory, { total: number; compliant: number }>;
  trending: 'improving' | 'stable' | 'declining';
}

export async function getFranchiseRules(franchiseId: string): Promise<FranchiseRule[]> {
  const { data, error } = await supabase
    .from('franchise_rules')
    .select('*')
    .eq('franchise_id', franchiseId)
    .order('category, name');

  if (error) throw new Error(`Failed to fetch franchise rules: ${error.message}`);
  return data || [];
}

export async function validateLocationCompliance(
  locationId: string,
  franchiseId: string
): Promise<ComplianceViolation[]> {
  const rules = await getFranchiseRules(franchiseId);
  const violations: ComplianceViolation[] = [];

  const { data: location } = await supabase
    .from('locations')
    .select('*')
    .eq('id', locationId)
    .single();

  if (!location) throw new Error('Location not found');

  const { data: locationConfig } = await supabase
    .from('location_configurations')
    .select('*')
    .eq('location_id', locationId)
    .single();

  for (const rule of rules) {
    if (rule.ruleType !== 'non_negotiable' && rule.enforcement === 'advisory') continue;

    const currentValue = getConfigValue(locationConfig, rule);
    const isCompliant = checkCompliance(rule, currentValue);

    if (!isCompliant) {
      violations.push({
        id: `${locationId}_${rule.id}_${Date.now()}`,
        locationId,
        locationName: location.name,
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        severity: rule.violationSeverity,
        currentValue,
        expectedValue: rule.defaultValue,
        detectedAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
        notes: `Location ${location.name} is not compliant with ${rule.name}`,
      });
    }
  }

  // Store violations
  if (violations.length > 0) {
    await supabase.from('compliance_violations').insert(violations);
  }

  return violations;
}

export async function runFranchiseComplianceAudit(
  franchiseId: string
): Promise<FranchiseComplianceReport> {
  const { data: locations } = await supabase
    .from('locations')
    .select('id, name')
    .eq('franchise_id', franchiseId)
    .eq('status', 'active');

  if (!locations) throw new Error('No locations found for franchise');

  const allViolations: ComplianceViolation[] = [];
  const compliantLocationIds = new Set<string>();

  for (const location of locations) {
    const violations = await validateLocationCompliance(location.id, franchiseId);
    allViolations.push(...violations);

    const hasCritical = violations.some(v => v.severity === 'critical');
    if (!hasCritical) compliantLocationIds.add(location.id);
  }

  // Aggregate by category
  const byCategory: Record<string, { total: number; compliant: number }> = {};
  const rules = await getFranchiseRules(franchiseId);
  const categories = [...new Set(rules.map(r => r.category))];

  for (const cat of categories) {
    const catViolations = allViolations.filter(v => v.category === cat);
    const locationsWithViolations = new Set(catViolations.map(v => v.locationId));
    byCategory[cat] = {
      total: locations.length,
      compliant: locations.length - locationsWithViolations.size,
    };
  }

  // Determine trend
  const { data: previousReport } = await supabase
    .from('compliance_reports')
    .select('compliance_rate')
    .eq('franchise_id', franchiseId)
    .order('report_date', { ascending: false })
    .limit(1)
    .single();

  const currentRate = compliantLocationIds.size / locations.length;
  const previousRate = previousReport?.compliance_rate || currentRate;
  const trending = currentRate > previousRate ? 'improving' :
    currentRate < previousRate ? 'declining' : 'stable';

  const report: FranchiseComplianceReport = {
    franchiseId,
    reportDate: new Date().toISOString(),
    totalLocations: locations.length,
    compliantLocations: compliantLocationIds.size,
    complianceRate: currentRate,
    violations: allViolations,
    byCategory: byCategory as any,
    trending,
  };

  // Store report
  await supabase.from('compliance_reports').insert({
    franchise_id: franchiseId,
    report_date: report.reportDate,
    total_locations: report.totalLocations,
    compliant_locations: report.compliantLocations,
    compliance_rate: report.complianceRate,
    violation_count: allViolations.length,
    trending: report.trending,
  });

  return report;
}

function getConfigValue(config: any, rule: FranchiseRule): any {
  if (!config) return null;
  const path = rule.complianceCheck.split('.');
  let value = config;
  for (const key of path) {
    value = value?.[key];
  }
  return value;
}

function checkCompliance(rule: FranchiseRule, currentValue: any): boolean {
  if (currentValue === null || currentValue === undefined) {
    return rule.enforcement === 'advisory';
  }

  if (rule.allowedValues) {
    return rule.allowedValues.includes(currentValue);
  }

  if (rule.allowedRange) {
    return currentValue >= rule.allowedRange.min && currentValue <= rule.allowedRange.max;
  }

  return currentValue === rule.defaultValue;
}
