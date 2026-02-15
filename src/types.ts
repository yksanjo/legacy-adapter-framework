// Types for Legacy Adapter Framework

export interface AdapterConfig {
  name: string;
  sourceFormat: 'json' | 'xml' | 'csv' | 'soap' | 'grpc' | 'rest' | 'graphql';
  targetFormat: 'json' | 'xml' | 'csv' | 'protobuf';
  schemaMapping?: SchemaMapping;
  endpoint?: string;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

export interface SchemaMapping {
  sourceFields: Record<string, string>;
  transforms?: FieldTransform[];
  customMappings?: CustomMapping[];
}

export interface FieldTransform {
  sourceField: string;
  targetField: string;
  transformType: 'date' | 'number' | 'boolean' | 'uppercase' | 'lowercase' | 'custom';
  transformFn?: string;
}

export interface CustomMapping {
  sourcePath: string;
  targetPath: string;
  condition?: string;
  defaultValue?: unknown;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface AdapterTransformResult {
  data: unknown;
  metadata: TransformMetadata;
}

export interface TransformMetadata {
  sourceFormat: string;
  targetFormat: string;
  fieldsMapped: number;
  fieldsTransformed: number;
  timestamp: string;
}

export interface AdapterRequest {
  endpoint?: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
  queryParams?: Record<string, string>;
}

export interface AdapterResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  metadata?: ResponseMetadata;
}

export interface ResponseMetadata {
  duration: number;
  timestamp: string;
  adapter: string;
}

export interface SchemaInferenceOptions {
  sampleData: unknown;
  confidence?: number;
  fieldTypes?: Record<string, string>;
}

export interface InferredSchema {
  fields: InferredField[];
  confidence: number;
  suggestions: string[];
}

export interface InferredField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  nullable: boolean;
  sampleValues: unknown[];
}

export interface AdapterHealthCheck {
  healthy: boolean;
  latency?: number;
  lastChecked: string;
  errors?: string[];
}

export interface AdapterMetrics {
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  avgResponseTime: number;
  totalBytesProcessed: number;
}

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
}
