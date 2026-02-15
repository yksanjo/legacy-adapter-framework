// Legacy System Adapter Framework
// AI-powered schema translation layer with automatic adapter generation

import axios, { AxiosInstance } from 'axios';
import { parseStringPromise } from 'xml2js';
import {
  AdapterConfig,
  Logger,
  FieldTransform,
  CustomMapping,
  AdapterTransformResult,
  AdapterRequest,
  AdapterResponse,
  SchemaInferenceOptions,
  InferredSchema,
  InferredField,
  AdapterHealthCheck,
  AdapterMetrics
} from './types';

export class LegacySystemAdapter {
  private config: AdapterConfig;
  private httpClient: AxiosInstance;
  private logger: Logger;
  private retryPolicy: { maxRetries: number; initialDelayMs: number; maxDelayMs: number; backoffMultiplier: number };
  private metrics: AdapterMetrics;

  constructor(config: AdapterConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.retryPolicy = config.retryPolicy || {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2
    };

    this.metrics = {
      requestsTotal: 0,
      requestsSuccess: 0,
      requestsFailed: 0,
      avgResponseTime: 0,
      totalBytesProcessed: 0
    };

    this.httpClient = axios.create({
      timeout: config.timeout || 30000,
      headers: {
        'Accept': this.getAcceptHeader(config.sourceFormat)
      }
    });
  }

  /**
   * Execute a request through the adapter
   */
  async execute(request: AdapterRequest): Promise<AdapterResponse> {
    const startTime = Date.now();
    this.metrics.requestsTotal++;

    try {
      const result = await this.executeWithRetry(request);
      
      let transformedData: unknown;
      if (request.method === 'GET') {
        transformedData = await this.transform(result.data, this.config.targetFormat);
      } else {
        transformedData = result.data;
      }

      this.metrics.requestsSuccess++;
      const duration = Date.now() - startTime;
      const successCount = this.metrics.requestsSuccess;
      this.metrics.avgResponseTime = 
        (this.metrics.avgResponseTime * (successCount - 1) + duration) / successCount;

      this.logger.info(`Adapter executed successfully: ${this.config.name}`, { 
        duration, 
        statusCode: result.status 
      });

      return {
        success: true,
        data: transformedData as AdapterResponse['data'],
        statusCode: result.status,
        headers: result.headers as Record<string, string>,
        metadata: {
          duration,
          timestamp: new Date().toISOString(),
          adapter: this.config.name
        }
      };
    } catch (error) {
      this.metrics.requestsFailed++;
      const duration = Date.now() - startTime;
      const err = error as Error;

      this.logger.error(`Adapter execution failed: ${this.config.name}`, {
        error: err.message,
        duration
      });

      return {
        success: false,
        error: err.message,
        metadata: {
          duration,
          timestamp: new Date().toISOString(),
          adapter: this.config.name
        }
      };
    }
  }

  /**
   * Transform data between formats
   */
  async transform(
    data: unknown,
    targetFormat?: string
  ): Promise<AdapterTransformResult> {
    const sourceFormat = this.config.sourceFormat;
    const target = targetFormat || this.config.targetFormat;
    let transformedData: unknown = data;
    let fieldsMapped = 0;
    let fieldsTransformed = 0;

    if (sourceFormat === 'xml' && typeof data === 'string') {
      transformedData = await this.parseXML(data);
      fieldsMapped++;
    } else if (sourceFormat === 'csv' && typeof data === 'string') {
      transformedData = await this.parseCSV(data);
      fieldsMapped++;
    } else if (sourceFormat === 'soap') {
      transformedData = await this.parseSOAP(data);
      fieldsMapped++;
    }

    if (this.config.schemaMapping) {
      const mappingResult = this.applySchemaMapping(transformedData);
      transformedData = mappingResult.data;
      fieldsMapped = mappingResult.mapped;
      fieldsTransformed = mappingResult.transformed;
    }

    if (target === 'xml' && typeof transformedData === 'object') {
      transformedData = await this.toXML(transformedData);
    } else if (target === 'csv' && Array.isArray(transformedData)) {
      transformedData = await this.toCSV(transformedData);
    }

    return {
      data: transformedData,
      metadata: {
        sourceFormat,
        targetFormat: target,
        fieldsMapped,
        fieldsTransformed,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Infer schema from sample data
   */
  static inferSchema(options: SchemaInferenceOptions): InferredSchema {
    const sampleData = options.sampleData;
    const fields: InferredField[] = [];
    const suggestions: string[] = [];

    if (Array.isArray(sampleData) && sampleData.length > 0) {
      const sample = sampleData[0];
      
      if (typeof sample === 'object' && sample !== null) {
        for (const [key, value] of Object.entries(sample)) {
          const inferredType = LegacySystemAdapter.inferFieldType(value);
          fields.push({
            name: key,
            type: inferredType,
            nullable: sampleData.some(item => item[key] === null || item[key] === undefined),
            sampleValues: sampleData.slice(0, 5).map(item => item[key])
          });
        }
      }
    } else if (typeof sampleData === 'object' && sampleData !== null) {
      for (const [key, value] of Object.entries(sampleData)) {
        const inferredType = LegacySystemAdapter.inferFieldType(value);
        fields.push({
          name: key,
          type: inferredType,
          nullable: value === null || value === undefined,
          sampleValues: [value]
        });
      }
    }

    if (fields.length === 0) {
      suggestions.push('Unable to infer schema from empty or invalid data');
    }
    
    const dateFields = fields.filter(f => f.type === 'string' && 
      f.sampleValues.some(v => LegacySystemAdapter.looksLikeDate(v)));
    if (dateFields.length > 0) {
      suggestions.push(`Consider adding date transforms for: ${dateFields.map(f => f.name).join(', ')}`);
    }

    return {
      fields,
      confidence: Math.min(1, fields.length / 10),
      suggestions
    };
  }

  /**
   * Generate automatic adapter configuration based on API analysis
   */
  static async analyzeEndpoint(
    endpoint: string,
    logger: Logger
  ): Promise<Partial<AdapterConfig>> {
    logger.info(`Analyzing endpoint: ${endpoint}`);

    try {
      const response = await axios.get(endpoint, { 
        timeout: 10000,
        headers: { 'Accept': 'application/json, application/xml, text/csv' }
      });

      const contentType = response.headers['content-type'] || '';
      let sourceFormat: AdapterConfig['sourceFormat'] = 'json';

      if (contentType.includes('xml') || typeof response.data === 'string' && response.data.trim().startsWith('<')) {
        sourceFormat = 'xml';
      } else if (contentType.includes('csv') || typeof response.data === 'string' && response.data.includes(',')) {
        sourceFormat = 'csv';
      }

      const schema = LegacySystemAdapter.inferSchema({
        sampleData: response.data,
        confidence: 0.8
      });

      logger.info(`Endpoint analysis complete`, { 
        sourceFormat, 
        fields: schema.fields.length 
      });

      return {
        sourceFormat,
        targetFormat: 'json',
        schemaMapping: {
          sourceFields: {}
        }
      };
    } catch (error) {
      logger.error(`Endpoint analysis failed: ${endpoint}`, { 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Get adapter health status
   */
  async healthCheck(): Promise<AdapterHealthCheck> {
    const startTime = Date.now();
    
    try {
      if (this.config.endpoint) {
        await this.httpClient.head(this.config.endpoint);
      }
      
      return {
        healthy: true,
        latency: Date.now() - startTime,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      return {
        healthy: false,
        latency: Date.now() - startTime,
        lastChecked: new Date().toISOString(),
        errors: [(error as Error).message]
      };
    }
  }

  /**
   * Get adapter metrics
   */
  getMetrics(): AdapterMetrics {
    return { ...this.metrics };
  }

  // Private methods

  private async executeWithRetry(request: AdapterRequest): Promise<{
    data: unknown;
    status: number;
    headers: Record<string, string>;
  }> {
    let lastError: Error | null = null;
    let delay = this.retryPolicy.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        const response = await this.httpClient.request({
          method: request.method.toLowerCase(),
          url: request.endpoint || this.config.endpoint,
          headers: request.headers,
          data: request.body,
          params: request.queryParams
        });

        return {
          data: response.data,
          status: response.status,
          headers: response.headers as Record<string, string>
        };
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.retryPolicy.maxRetries) {
          this.logger.warn(`Retry attempt ${attempt + 1}`, { 
            error: lastError.message,
            delay 
          });
          await this.sleep(delay);
          delay = Math.min(delay * this.retryPolicy.backoffMultiplier, this.retryPolicy.maxDelayMs);
        }
      }
    }

    throw lastError;
  }

  private applySchemaMapping(data: unknown): {
    data: unknown;
    mapped: number;
    transformed: number;
  } {
    if (!this.config.schemaMapping) {
      return { data, mapped: 0, transformed: 0 };
    }

    let mapped = 0;
    let transformed = 0;
    let result = data;

    if (this.config.schemaMapping.sourceFields && typeof data === 'object') {
      const mapping: Record<string, string> = this.config.schemaMapping.sourceFields;
      result = this.mapFields(data as Record<string, unknown>, mapping);
      mapped = Object.keys(mapping).length;
    }

    if (this.config.schemaMapping.transforms) {
      result = this.applyTransforms(result, this.config.schemaMapping.transforms);
      transformed = this.config.schemaMapping.transforms.length;
    }

    return { data: result, mapped, transformed };
  }

  private mapFields(
    data: Record<string, unknown>,
    mapping: Record<string, string>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [sourceField, targetField] of Object.entries(mapping)) {
      if (sourceField in data) {
        result[targetField] = data[sourceField];
      }
    }

    return result;
  }

  private applyTransforms(
    data: unknown,
    transforms: FieldTransform[]
  ): unknown {
    if (!Array.isArray(data)) return data;

    return data.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return item;
      
      const record = item as Record<string, unknown>;
      const result = { ...record };

      for (const transform of transforms) {
        if (transform.sourceField in result) {
          result[transform.targetField] = this.applyTransformValue(
            result[transform.sourceField],
            transform.transformType
          );
        }
      }

      return result;
    });
  }

  private applyTransformValue(
    value: unknown,
    transformType: FieldTransform['transformType']
  ): unknown {
    switch (transformType) {
      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value;
      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value;
      case 'number':
        return Number(value);
      case 'boolean':
        return Boolean(value);
      case 'date':
        return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
      default:
        return value;
    }
  }

  private async parseXML(xml: string): Promise<unknown> {
    return parseStringPromise(xml, { explicitArray: false });
  }

  private async parseCSV(csv: string): Promise<Record<string, unknown>[]> {
    const delimiter = ',';
    const lines = csv.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) return [];

    const headers = lines[0].split(delimiter);
    const results: Record<string, unknown>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(delimiter);
      const row: Record<string, unknown> = {};
      
      headers.forEach((header, idx) => {
        row[header.trim()] = values[idx]?.trim();
      });
      
      results.push(row);
    }

    return results;
  }

  private async parseSOAP(data: unknown): Promise<unknown> {
    if (typeof data === 'string') {
      return this.parseXML(data);
    }
    return data;
  }

  private async toXML(obj: unknown): Promise<string> {
    const xml2js = await import('xml2js');
    const builder = new xml2js.Builder();
    return builder.buildObject(obj);
  }

  private async toCSV(data: unknown[]): Promise<string> {
    if (!Array.isArray(data) || data.length === 0) return '';
    
    const firstItem = data[0] as Record<string, unknown>;
    const headers = Object.keys(firstItem);
    const rows = data.map(item => 
      headers.map(h => JSON.stringify((item as Record<string, unknown>)[h] ?? '')).join(',')
    );
    
    return [headers.join(','), ...rows].join('\n');
  }

  private getAcceptHeader(format: string): string {
    switch (format) {
      case 'xml':
      case 'soap':
        return 'application/xml, text/xml';
      case 'csv':
        return 'text/csv';
      default:
        return 'application/json';
    }
  }

  private static inferFieldType(value: unknown): InferredField['type'] {
    if (value === null || value === undefined) return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') {
      if (LegacySystemAdapter.looksLikeDate(value)) return 'date';
    }
    return 'string';
  }

  private static looksLikeDate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}/,
      /^\d{2}\/\d{2}\/\d{4}/
    ];
    return datePatterns.some(pattern => pattern.test(value));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
