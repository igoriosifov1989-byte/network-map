import { db } from "./db";
import { traces, spans, networkEvents } from "@shared/schema";
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
  SERVER: 'server',
  CLIENT: 'client',
  PRODUCER: 'producer',
  CONSUMER: 'consumer',
  INTERNAL: 'internal'
};

// Helper functions
function generateTraceId(): string {
  return Array.from({length: 32}, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function generateSpanId(): string {
  return Array.from({length: 16}, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function generateDuration(min: number = 1000000, max: number = 500000000): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

// Generate realistic OpenTelemetry trace: Gateway → API Bus → Business Services
export function generateRealisticTrace(): { trace: InsertTrace; spans: InsertSpan[]; networkEvents: InsertNetworkEvent[] } {
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
      attributes: {
        'http.method': method,
        'http.status_code': parseInt(overallStatus),
        'service.name': chainItem.service.name,
        'service.version': chainItem.service.version
      },
      events: [],
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
  
  // Calculate trace metadata
  const traceRootService = serviceChain[0].service;
  const totalDuration = spans.reduce((total, span) => total + span.duration, 0);
  const traceEndTime = new Date(Math.max(...spans.map(s => s.endTime.getTime())));
  const hasErrors = spans.some(s => s.status === 'error');
  
  const trace: InsertTrace = {
    traceId,
    serviceName: traceRootService.name,
    serviceVersion: traceRootService.version,
    tenant: traceRootService.tenant,
    system: traceRootService.name,
    startTime,
    endTime: traceEndTime,
    duration: totalDuration,
    spanCount: spans.length,
    status: hasErrors ? 'error' : 'ok',
    statusMessage: hasErrors ? 'Trace contains errors' : undefined,
    attributes: {
      'trace.span_count': spans.length,
      'trace.service_count': new Set(spans.map(s => s.serviceName)).size,
      'trace.root_service': traceRootService.name
    },
    resource: {
      'service.name': traceRootService.name,
      'service.version': traceRootService.version
    }
  };
  
  return { trace, spans, networkEvents };
}

// Store realistic trace data
export async function storeRealisticTrace(traceData: { trace: InsertTrace; spans: InsertSpan[]; networkEvents: InsertNetworkEvent[] }) {
  const { trace, spans: traceSpans, networkEvents: traceNetworkEvents } = traceData;
  
  try {
    await db.insert(traces).values(trace);
    
    if (traceSpans.length > 0) {
      await db.insert(spans).values(traceSpans);
    }
    
    if (traceNetworkEvents.length > 0) {
      await db.insert(networkEvents).values(traceNetworkEvents);
    }
    
    console.log(`📊 Stored realistic OpenTelemetry trace with ${traceSpans.length} spans and ${traceNetworkEvents.length} network events`);
  } catch (error) {
    console.error('Failed to store realistic trace data:', error);
  }
}

let generationInterval: NodeJS.Timeout | null = null;

// Start realistic generation
export function startRealisticGeneration(intervalMs: number = 3000) {
  if (generationInterval) {
    clearInterval(generationInterval);
  }
  
  generationInterval = setInterval(async () => {
    const traceData = generateRealisticTrace();
    await storeRealisticTrace(traceData);
  }, intervalMs);
  
  console.log(`🚀 Realistic OpenTelemetry generation started with ${intervalMs}ms interval`);
}

// Stop realistic generation
export function stopRealisticGeneration() {
  if (generationInterval) {
    clearInterval(generationInterval);
    generationInterval = null;
    console.log('🛑 Realistic OpenTelemetry generation stopped');
  }
}