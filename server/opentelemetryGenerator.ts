import { db } from "./db";
import { traces, spans, networkEvents } from "@shared/schema";
import { sql, gt, and, gte, lte, desc, asc } from "drizzle-orm";
import type { InsertTrace, InsertSpan, InsertNetworkEvent } from "@shared/schema";
import { nanoid } from "nanoid";

// Expanded tenant/system configuration with 50 services across 10 tenants
const TENANT_SYSTEMS = {
  'api-gateway': [
    { name: 'gateway-main', version: '1.2.3' },
    { name: 'gateway-auth', version: '1.2.1' },
    { name: 'gateway-proxy', version: '1.2.0' },
    { name: 'gateway-cache', version: '1.1.5' },
    { name: 'gateway-metrics', version: '1.3.0' }
  ],
  'user-management': [
    { name: 'user-service', version: '2.1.0' },
    { name: 'profile-service', version: '2.0.8' },
    { name: 'auth-service', version: '2.1.2' },
    { name: 'session-mgr', version: '2.0.5' },
    { name: 'identity-provider', version: '2.2.0' }
  ],
  'payment-system': [
    { name: 'payment-core', version: '1.5.2' },
    { name: 'payment-gateway', version: '1.5.0' },
    { name: 'billing-service', version: '1.4.9' },
    { name: 'fraud-detection', version: '1.6.1' },
    { name: 'tax-calculator', version: '1.3.7' }
  ],
  'inventory-system': [
    { name: 'inventory-core', version: '3.0.1' },
    { name: 'stock-tracker', version: '2.9.5' },
    { name: 'warehouse-mgmt', version: '3.0.0' },
    { name: 'supplier-api', version: '2.8.3' },
    { name: 'product-catalog', version: '3.1.2' }
  ],
  'notification-system': [
    { name: 'notification-core', version: '1.8.0' },
    { name: 'email-service', version: '1.7.5' },
    { name: 'sms-service', version: '1.8.1' },
    { name: 'push-service', version: '1.7.8' },
    { name: 'template-engine', version: '1.9.2' }
  ],
  'analytics-platform': [
    { name: 'data-collector', version: '2.5.0' },
    { name: 'metrics-processor', version: '2.4.8' },
    { name: 'report-generator', version: '2.6.1' },
    { name: 'dashboard-api', version: '2.5.5' },
    { name: 'ml-insights', version: '2.7.0' }
  ],
  'content-management': [
    { name: 'content-api', version: '1.8.5' },
    { name: 'media-storage', version: '1.9.0' },
    { name: 'cdn-manager', version: '1.7.8' },
    { name: 'content-search', version: '1.8.2' },
    { name: 'asset-optimizer', version: '1.6.9' }
  ],
  'order-processing': [
    { name: 'order-service', version: '3.2.1' },
    { name: 'fulfillment-api', version: '3.1.8' },
    { name: 'shipping-tracker', version: '3.2.5' },
    { name: 'return-handler', version: '3.0.9' },
    { name: 'order-analytics', version: '3.3.0' }
  ],
  'security-monitoring': [
    { name: 'threat-detector', version: '1.4.2' },
    { name: 'audit-logger', version: '1.5.1' },
    { name: 'compliance-checker', version: '1.3.8' },
    { name: 'access-monitor', version: '1.4.5' },
    { name: 'incident-responder', version: '1.5.3' }
  ],
  'infrastructure-ops': [
    { name: 'health-monitor', version: '2.1.0' },
    { name: 'backup-service', version: '2.0.7' },
    { name: 'deployment-mgr', version: '2.2.1' },
    { name: 'config-service', version: '2.1.5' },
    { name: 'log-aggregator', version: '2.3.0' }
  ]
};

// Flatten for easy access
const ALL_SERVICES = Object.entries(TENANT_SYSTEMS).flatMap(([tenant, systems]) => 
  systems.map(system => ({ ...system, tenant }))
);

const OPERATIONS = {
  'api-gateway': ['route_request', 'authenticate', 'rate_limit', 'proxy_request', 'cache_lookup', 'metrics_collect'],
  'user-management': ['get_user', 'create_user', 'update_profile', 'validate_session', 'verify_identity', 'manage_session'],
  'payment-system': ['process_payment', 'validate_card', 'charge_customer', 'refund_payment', 'detect_fraud', 'calculate_tax'],
  'inventory-system': ['check_stock', 'reserve_item', 'update_inventory', 'get_product', 'sync_suppliers', 'catalog_search'],
  'notification-system': ['send_email', 'send_sms', 'push_notification', 'format_message', 'push_mobile', 'render_template'],
  'analytics-platform': ['collect_events', 'process_metrics', 'generate_report', 'serve_dashboard', 'run_analysis', 'aggregate_data'],
  'content-management': ['fetch_content', 'store_media', 'purge_cache', 'search_content', 'optimize_assets', 'manage_cdn'],
  'order-processing': ['create_order', 'fulfill_order', 'track_shipment', 'process_return', 'analyze_orders', 'manage_fulfillment'],
  'security-monitoring': ['detect_threats', 'log_audit', 'check_compliance', 'monitor_access', 'handle_incident', 'scan_vulnerabilities'],
  'infrastructure-ops': ['check_health', 'create_backup', 'deploy_service', 'update_config', 'aggregate_logs', 'monitor_resources']
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const HTTP_STATUSES = ['200', '201', '400', '401', '403', '404', '500', '502', '503'];

const SPAN_KINDS = {
  UNSPECIFIED: 0,
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5
};

// Generate realistic OpenTelemetry trace ID (128-bit hex)
function generateTraceId(): string {
  return nanoid(32).toLowerCase().replace(/[^a-f0-9]/g, '0').slice(0, 32);
}

// Generate realistic OpenTelemetry span ID (64-bit hex)
function generateSpanId(): string {
  return nanoid(16).toLowerCase().replace(/[^a-f0-9]/g, '0').slice(0, 16);
}

// Generate realistic duration in nanoseconds
function generateDuration(min: number = 1000000, max: number = 500000000): number {
  return Math.floor(Math.random() * (max - min) + min);
}

// Generate OpenTelemetry attributes
function generateAttributes(service: string, operation: string, method?: string, status?: string): Record<string, any> {
  const attrs: Record<string, any> = {
    'service.name': service,
    'operation.name': operation,
    'span.kind': 'server'
  };

  if (method) {
    attrs['http.method'] = method;
    attrs['http.route'] = `/${operation}`;
  }

  if (status) {
    attrs['http.status_code'] = parseInt(status);
    attrs['http.response.status_code'] = parseInt(status);
  }

  return attrs;
}

// Generate OpenTelemetry events
function generateEvents(): Array<any> {
  const events = [];
  
  if (Math.random() < 0.3) { // 30% chance of having events
    events.push({
      name: 'request.start',
      timestamp: new Date(Date.now() - Math.random() * 1000).toISOString(),
      attributes: { 'event.type': 'request' }
    });
  }

  if (Math.random() < 0.2) { // 20% chance of error event
    events.push({
      name: 'error.occurred',
      timestamp: new Date(Date.now() - Math.random() * 500).toISOString(),
      attributes: { 
        'error.type': 'HttpError',
        'error.message': 'Request timeout'
      }
    });
  }

  return events;
}

// Generate a realistic OpenTelemetry trace: Gateway → API Bus → Business Services
export function generateOpenTelemetryTrace(): { trace: InsertTrace; spans: InsertSpan[]; networkEvents: InsertNetworkEvent[] } {
  const traceId = generateTraceId();
  const startTime = new Date(Date.now() - Math.random() * 10000);
  
  const spans: InsertSpan[] = [];
  const networkEvents: InsertNetworkEvent[] = [];
  
  // Create realistic service chain: Gateway → API Bus → Target Services
  const serviceChain: Array<{ service: typeof ALL_SERVICES[0]; operation: string }> = [];
  
  // 1. Always start with gateway (entry point)
  const gatewayServices = ALL_SERVICES.filter(s => s.tenant === 'api-gateway');
  const gateway = gatewayServices[Math.floor(Math.random() * gatewayServices.length)];
  serviceChain.push({ 
    service: gateway, 
    operation: OPERATIONS['api-gateway'][Math.floor(Math.random() * OPERATIONS['api-gateway'].length)]
  });
  
  // 2. Add API bus/proxy (80% chance)
  if (Math.random() > 0.2) {
    const proxyService = ALL_SERVICES.find(s => s.name === 'gateway-proxy') || gateway;
    if (proxyService.name !== gateway.name) {
      serviceChain.push({ 
        service: proxyService, 
        operation: 'proxy_request' 
      });
    }
  }
  
  // 3. Add 1-3 business services from different tenants (realistic flow)
  const businessTenants = ['user-management', 'payment-system', 'inventory-system', 'notification-system', 'analytics-platform', 'content-management', 'order-processing', 'security-monitoring', 'infrastructure-ops'];
  const selectedTenants = businessTenants.sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 3) + 1);
  
  selectedTenants.forEach(tenant => {
    const tenantServices = ALL_SERVICES.filter(s => s.tenant === tenant);
    const service = tenantServices[Math.floor(Math.random() * tenantServices.length)];
    const operation = OPERATIONS[tenant][Math.floor(Math.random() * OPERATIONS[tenant].length)];
    serviceChain.push({ service, operation });
  });
  
  // Generate spans for the realistic service chain
  let currentTime = startTime.getTime();
  let parentSpanId: string | null = null;
  const method = HTTP_METHODS[Math.floor(Math.random() * HTTP_METHODS.length)];
  const overallStatus = HTTP_STATUSES[Math.floor(Math.random() * HTTP_STATUSES.length)];
  
  serviceChain.forEach((chainItem, index) => {
    const spanId = generateSpanId();
    const spanDuration = generateDuration(10000000, 100000000); // 10ms to 100ms
    const spanEndTime = new Date(currentTime + spanDuration / 1000000);
    
    const span: InsertSpan = {
      traceId,
      spanId,
      parentSpanId,
      operationName: chainItem.operation,
      serviceName: chainItem.service.name,
      tenant: chainItem.service.tenant,
      system: chainItem.service.name,
      kind: index === 0 ? SPAN_KINDS.SERVER : SPAN_KINDS.CLIENT,
      startTime: new Date(currentTime),
      endTime: spanEndTime,
      duration: spanDuration,
      status: parseInt(overallStatus) >= 400 ? 'error' : 'ok',
      statusMessage: parseInt(overallStatus) >= 400 ? `HTTP ${overallStatus}` : undefined,
      attributes: generateAttributes(chainItem.service.name, chainItem.operation, method, overallStatus),
      events: generateEvents(),
      links: [],
      resource: {
        'service.name': chainItem.service.name,
        'service.version': chainItem.service.version,
        'service.instance.id': nanoid(8)
      }
    };
    
    spans.push(span);
    
    // Create network event for service-to-service communication
    if (index > 0) {
      const prevService = serviceChain[index - 1].service;
      const networkEvent: InsertNetworkEvent = {
        source: prevService.name,
        target: chainItem.service.name,
        sourceService: prevService.name,
        targetService: chainItem.service.name,
        sourceTenant: prevService.tenant,
        targetTenant: chainItem.service.tenant,
        sourceSystem: prevService.name,
        targetSystem: chainItem.service.name,
        sourceLabel: `${prevService.name}:${Math.floor(Math.random() * 9000) + 1000}`,
        targetLabel: `${chainItem.service.name}:${Math.floor(Math.random() * 9000) + 1000}`,
        status: overallStatus,
        method,
        responseTime: Math.floor(spanDuration / 1000000),
        timestamp: new Date(currentTime),
        traceId,
        metadata: {
          span_id: spanId,
          parent_span_id: parentSpanId,
          operation: chainItem.operation
        }
      };
      
      networkEvents.push(networkEvent);
    }
    
    parentSpanId = spanId;
    currentTime += spanDuration / 1000000 + Math.random() * 5; // Small gap between spans
  });
  
  // Calculate trace metadata (using unique variable names)
  const traceRootService = serviceChain[0].service;
  const calculatedDuration = spans.reduce((total, span) => total + span.duration, 0);
  const calculatedEndTime = new Date(Math.max(...spans.map(s => s.endTime.getTime())));
  const hasErrors = spans.some(s => s.status === 'error');
  
  for (let i = 0; i < childSpanCount; i++) {
    const childService = ALL_SERVICES[Math.floor(Math.random() * ALL_SERVICES.length)];
    const childOperation = OPERATIONS[childService.tenant][Math.floor(Math.random() * OPERATIONS[childService.tenant].length)];
    const childSpanId = generateSpanId();
    const childDuration = generateDuration(1000000, 50000000);
    const childStatus = HTTP_STATUSES[Math.floor(Math.random() * HTTP_STATUSES.length)];
    
    const childStartTime = new Date(currentTime + Math.random() * 1000);
    const childEndTime = new Date(childStartTime.getTime() + childDuration / 1000000);
    
    const childSpan: InsertSpan = {
      traceId,
      spanId: childSpanId,
      parentSpanId: rootSpanId,
      operationName: childOperation,
      serviceName: childService.name,
      tenant: childService.tenant,
      system: childService.name,
      kind: Math.random() < 0.5 ? SPAN_KINDS.CLIENT : SPAN_KINDS.SERVER,
      startTime: childStartTime,
      endTime: childEndTime,
      duration: childDuration,
      status: parseInt(childStatus) >= 400 ? 'error' : 'ok',
      statusMessage: parseInt(childStatus) >= 400 ? `HTTP ${childStatus}` : undefined,
      attributes: generateAttributes(childService.name, childOperation, method, childStatus),
      events: generateEvents(),
      links: [],
      resource: {
        'service.name': childService.name,
        'service.version': childService.version,
        'service.instance.id': nanoid(8)
      }
    };
    
    spans.push(childSpan);
    
    // Create network event for service-to-service communication
    if (childService.name !== rootService.name) {
      const networkEvent: InsertNetworkEvent = {
        source: `${rootService.name}_${rootOperation}`,
        target: `${childService.name}_${childOperation}`,
        sourceService: rootService.name,
        targetService: childService.name,
        sourceTenant: rootService.tenant,
        targetTenant: childService.tenant,
        sourceSystem: rootService.name,
        targetSystem: childService.name,
        sourceLabel: rootOperation,
        targetLabel: childOperation,
        status: childStatus,
        method: method,
        responseTime: Math.floor(childDuration / 1000000),
        traceId: traceId,
        spanId: childSpanId,
        metadata: {
          parentSpanId: rootSpanId,
          spanKind: childSpan.kind,
          attributes: childSpan.attributes
        }
      };
      
      networkEvents.push(networkEvent);
    }
    
    currentTime = childEndTime.getTime();
  }
  
  // Calculate total trace duration
  const totalDuration = Math.max(...spans.map(s => s.duration || 0));
  const traceEndTime = new Date(startTime.getTime() + totalDuration / 1000000);
  
  const trace: InsertTrace = {
    traceId,
    serviceName: rootService.name,
    serviceVersion: rootService.version,
    tenant: rootService.tenant,
    system: rootService.name,
    startTime,
    endTime: calculatedEndTime,
    duration: calculatedDuration,
    spanCount: spans.length,
    status: spans.some(s => s.status === 'error') ? 'error' : 'ok',
    statusMessage: spans.some(s => s.status === 'error') ? 'Trace contains errors' : undefined,
    attributes: {
      'trace.span_count': spans.length,
      'trace.service_count': new Set(spans.map(s => s.serviceName)).size,
      'trace.root_service': rootService.name
    },
    resource: {
      'service.name': rootService.name,
      'service.version': rootService.version
    }
  };
  
  return { trace, spans, networkEvents };
}

// Store OpenTelemetry trace data
export async function storeOpenTelemetryTrace(traceData: { trace: InsertTrace; spans: InsertSpan[]; networkEvents: InsertNetworkEvent[] }) {
  const { trace, spans: traceSpans, networkEvents: traceNetworkEvents } = traceData;
  
  try {
    // Store trace
    await db.insert(traces).values(trace);
    
    // Store spans
    if (traceSpans.length > 0) {
      await db.insert(spans).values(traceSpans);
    }
    
    // Store network events
    if (traceNetworkEvents.length > 0) {
      await db.insert(networkEvents).values(traceNetworkEvents);
    }
    
    console.log(`📊 Stored OpenTelemetry trace with ${traceSpans.length} spans and ${traceNetworkEvents.length} network events`);
  } catch (error) {
    console.error('❌ Error storing OpenTelemetry trace:', error);
    throw error;
  }
}

let generationInterval: NodeJS.Timeout | null = null;

// Start generating OpenTelemetry traces
export function startOpenTelemetryGeneration(intervalMs: number = 5000) {
  if (generationInterval) {
    clearInterval(generationInterval);
  }
  
  console.log(`🚀 OpenTelemetry generation started with ${intervalMs}ms interval`);
  
  generationInterval = setInterval(async () => {
    try {
      const traceData = generateOpenTelemetryTrace();
      await storeOpenTelemetryTrace(traceData);
    } catch (error) {
      console.error('❌ Error generating OpenTelemetry trace:', error);
    }
  }, intervalMs);
  
  // Generate first trace immediately
  setTimeout(async () => {
    try {
      const traceData = generateOpenTelemetryTrace();
      await storeOpenTelemetryTrace(traceData);
    } catch (error) {
      console.error('❌ Error generating initial OpenTelemetry trace:', error);
    }
  }, 100);
}

// Stop generating OpenTelemetry traces
export function stopOpenTelemetryGeneration() {
  if (generationInterval) {
    clearInterval(generationInterval);
    generationInterval = null;
    console.log('🔴 OpenTelemetry generation stopped');
  }
}

// Get recent traces
export async function getRecentTraces(limit: number = 20) {
  try {
    return await db
      .select()
      .from(traces)
      .orderBy(desc(traces.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('❌ Error fetching recent traces:', error);
    return [];
  }
}

// Get spans for a specific trace
export async function getSpansForTrace(traceId: string) {
  try {
    return await db
      .select()
      .from(spans)
      .where(sql`${spans.traceId} = ${traceId}`)
      .orderBy(asc(spans.startTime));
  } catch (error) {
    console.error(`❌ Error fetching spans for trace ${traceId}:`, error);
    return [];
  }
}

// Get traces in time range
export async function getTracesInRange(from: Date, to: Date, limit: number = 100) {
  try {
    return await db
      .select()
      .from(traces)
      .where(and(
        gte(traces.startTime, from),
        lte(traces.startTime, to)
      ))
      .orderBy(desc(traces.startTime))
      .limit(limit);
  } catch (error) {
    console.error('❌ Error fetching traces in range:', error);
    return [];
  }
}