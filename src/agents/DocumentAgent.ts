/**
 * DocumentAgent.ts
 * Pulse AI — Document Processing Agent
 *
 * Autonomous agent for OCR processing, structured data extraction, and
 * document classification across all supported document types. Deployed
 * within the multi-location agent framework to handle document workflows
 * at each location independently while reporting to the centralized hub.
 *
 * @module agents/DocumentAgent
 * @category AI agent deployment, agentic infrastructure
 */

export enum DocumentType {
    INVOICE = 'invoice',
    CONTRACT = 'contract',
    COMPLIANCE_FORM = 'compliance_form',
    FINANCIAL_STATEMENT = 'financial_statement',
    LOAN_APPLICATION = 'loan_application',
    INTAKE_FORM = 'intake_form',
    PERMIT = 'permit',
    INSURANCE_CERTIFICATE = 'insurance_certificate',
    MEDICAL_RECORD = 'medical_record',
    HR_DOCUMENT = 'hr_document',
    COURT_FILING = 'court_filing',
    TRUST_DOCUMENT = 'trust_document',
}

export enum ExtractionStatus {
    QUEUED = 'queued',
    PROCESSING = 'processing',
    EXTRACTED = 'extracted',
    NEEDS_REVIEW = 'needs_review',
    FAILED = 'failed',
    REJECTED = 'rejected',
}

export enum ConfidenceLevel {
    HIGH = 'high',       // >= 0.92
    MEDIUM = 'medium',   // 0.75 - 0.91
    LOW = 'low',         // 0.50 - 0.74
    UNACCEPTABLE = 'unacceptable', // < 0.50
}

export interface DocumentJob {
    jobId: string;
    locationId: string;
    documentType: DocumentType;
    sourceUrl: string;
    mimeType: string;
    fileSizeBytes: number;
    submittedAt: Date;
    priority: number;
    metadata: Record<string, string>;
}

export interface ExtractionResult {
    jobId: string;
    documentType: DocumentType;
    status: ExtractionStatus;
    confidence: number;
    confidenceLevel: ConfidenceLevel;
    extractedFields: Record<string, ExtractionField>;
    classificationTags: string[];
    processingMs: number;
    requiresHumanReview: boolean;
    reviewReason?: string;
    extractedAt: Date;
}

export interface ExtractionField {
    fieldName: string;
    value: string | number | boolean | null;
    confidence: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
    dataType: 'string' | 'number' | 'date' | 'currency' | 'boolean' | 'array';
}

/** Confidence thresholds per document type — higher-stakes docs require higher confidence */
export const CONFIDENCE_THRESHOLDS: Record<DocumentType, number> = {
    [DocumentType.LOAN_APPLICATION]: 0.95,
    [DocumentType.COMPLIANCE_FORM]: 0.93,
    [DocumentType.COURT_FILING]: 0.92,
    [DocumentType.TRUST_DOCUMENT]: 0.92,
    [DocumentType.MEDICAL_RECORD]: 0.90,
    [DocumentType.FINANCIAL_STATEMENT]: 0.90,
    [DocumentType.CONTRACT]: 0.88,
    [DocumentType.INVOICE]: 0.85,
    [DocumentType.INSURANCE_CERTIFICATE]: 0.85,
    [DocumentType.PERMIT]: 0.85,
    [DocumentType.HR_DOCUMENT]: 0.83,
    [DocumentType.INTAKE_FORM]: 0.80,
};

/** Fields expected per document type — used for completeness validation */
export const REQUIRED_FIELDS: Record<DocumentType, string[]> = {
    [DocumentType.INVOICE]: ['vendor_name', 'invoice_number', 'invoice_date', 'total_amount', 'line_items'],
    [DocumentType.CONTRACT]: ['parties', 'effective_date', 'term_months', 'governing_law'],
    [DocumentType.COMPLIANCE_FORM]: ['entity_name', 'regulation_code', 'compliance_date', 'signatory'],
    [DocumentType.FINANCIAL_STATEMENT]: ['entity_name', 'period_end', 'total_revenue', 'net_income'],
    [DocumentType.LOAN_APPLICATION]: ['applicant_name', 'loan_amount', 'property_address', 'income_amount'],
    [DocumentType.INTAKE_FORM]: ['client_name', 'contact_info', 'service_requested', 'date'],
    [DocumentType.PERMIT]: ['permit_number', 'issuing_authority', 'issue_date', 'expiration_date'],
    [DocumentType.INSURANCE_CERTIFICATE]: ['insured_name', 'policy_number', 'coverage_type', 'expiration_date'],
    [DocumentType.MEDICAL_RECORD]: ['patient_id', 'provider', 'date_of_service', 'diagnosis_codes'],
    [DocumentType.HR_DOCUMENT]: ['employee_id', 'document_date', 'document_category'],
    [DocumentType.COURT_FILING]: ['case_number', 'court_name', 'filing_date', 'parties'],
    [DocumentType.TRUST_DOCUMENT]: ['trust_name', 'trustee', 'beneficiaries', 'execution_date'],
};

/**
 * Evaluates extraction quality and determines if human review is required.
 * Documents below confidence thresholds or missing required fields are flagged.
 *
 * @param result - Raw extraction result from OCR pipeline
 * @param docType - Expected document type
 * @returns Updated ExtractionResult with review determination
 */
export function evaluateExtractionQuality(
    result: ExtractionResult,
    docType: DocumentType
  ): ExtractionResult {
    const threshold = CONFIDENCE_THRESHOLDS[docType] ?? 0.85;
    const requiredFields = REQUIRED_FIELDS[docType] ?? [];

  const confidenceLevel: ConfidenceLevel =
        result.confidence >= 0.92 ? ConfidenceLevel.HIGH :
        result.confidence >= 0.75 ? ConfidenceLevel.MEDIUM :
        result.confidence >= 0.50 ? ConfidenceLevel.LOW :
        ConfidenceLevel.UNACCEPTABLE;

  const missingFields = requiredFields.filter(
        f => !(f in result.extractedFields) || result.extractedFields[f].value === null
      );

  const requiresHumanReview =
        result.confidence < threshold ||
        missingFields.length > 0 ||
        confidenceLevel === ConfidenceLevel.UNACCEPTABLE;

  let reviewReason: string | undefined;
    if (requiresHumanReview) {
          const reasons: string[] = [];
          if (result.confidence < threshold) reasons.push(`confidence ${(result.confidence * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(0)}%`);
          if (missingFields.length > 0) reasons.push(`missing required fields: ${missingFields.join(', ')}`);
          reviewReason = reasons.join('; ');
    }

  return {
        ...result,
        confidenceLevel,
        requiresHumanReview,
        reviewReason,
        status: requiresHumanReview ? ExtractionStatus.NEEDS_REVIEW : ExtractionStatus.EXTRACTED,
  };
}

/**
 * Classifies a document from its extracted content and metadata.
 * Returns DocumentType and confidence score for the classification.
 *
 * @param extractedText - Raw text content extracted from document
 * @param filename - Original filename for pattern matching
 * @returns Classified DocumentType and confidence
 */
export function classifyDocument(
    extractedText: string,
    filename: string
  ): { documentType: DocumentType; confidence: number } {
    const text = extractedText.toLowerCase();
    const file = filename.toLowerCase();

  if (text.includes('invoice number') || text.includes('bill to') || file.includes('inv-')) {
        return { documentType: DocumentType.INVOICE, confidence: 0.91 };
  }
    if (text.includes('hereby agrees') || text.includes('governing law') || file.includes('contract')) {
          return { documentType: DocumentType.CONTRACT, confidence: 0.87 };
    }
    if (text.includes('loan amount') || text.includes('mortgage') || text.includes('1003')) {
          return { documentType: DocumentType.LOAN_APPLICATION, confidence: 0.93 };
    }
    if (text.includes('diagnosis') || text.includes('icd-10') || text.includes('patient')) {
          return { documentType: DocumentType.MEDICAL_RECORD, confidence: 0.89 };
    }
    if (text.includes('permit number') || text.includes('building permit') || text.includes('zoning')) {
          return { documentType: DocumentType.PERMIT, confidence: 0.88 };
    }
    if (text.includes('trust') && (text.includes('trustee') || text.includes('beneficiary'))) {
          return { documentType: DocumentType.TRUST_DOCUMENT, confidence: 0.85 };
    }

  return { documentType: DocumentType.INTAKE_FORM, confidence: 0.60 };
}
