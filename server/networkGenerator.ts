import { db } from "./db";
import { networkEvents } from "@shared/schema";
import { sql, gt, and, gte, lte, desc, asc } from "drizzle-orm";
import type { InsertNetworkEvent } from "@shared/schema";

// Tenant/System configuration matching OpenTelemetry generator
const TENANT_SYSTEMS = {
  'api-gateway': [
    { name: 'gateway-main', service: 'api-gateway' },
    { name: 'gateway-auth', service: 'api-gateway' },
    { name: 'gateway-proxy', service: 'api-gateway' }
  ],
  'user-management': [
    { name: 'user-service', service: 'user-service' },
    { name: 'profile-service', service: 'user-service' },
    { name: 'auth-service', service: 'user-service' }
  ],
  'payment-system': [
    { name: 'payment-core', service: 'payment-service' },
    { name: 'payment-gateway', service: 'payment-service' },
    { name: 'billing-service', service: 'payment-service' }
  ],
  'inventory-system': [
    { name: 'inventory-core', service: 'inventory-service' },
    { name: 'stock-tracker', service: 'inventory-service' },
    { name: 'warehouse-mgmt', service: 'inventory-service' }
  ],
  'notification-system': [
    { name: 'notification-core', service: 'notification-service' },
    { name: 'email-service', service: 'notification-service' },
    { name: 'sms-service', service: 'notification-service' }
  ]
};

// Flatten for easy access
const ALL_SERVICES = Object.entries(TENANT_SYSTEMS).flatMap(([tenant, systems]) => 
  systems.map(system => ({ ...system, tenant }))
);

const LABELS = [
  'police-extend',
  'auth',
  'contact'
];

const HTTP_STATUSES = ['200', '201', '400', '401', '403', '404', '500', '502', '503'];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// Trace ID management - increments every 5 events
let currentTraceId = 1;
let eventsInCurrentTrace = 0;

// Generate realistic network events
export function generateNetworkEvent(): InsertNetworkEvent {
  // Increment trace ID every 5 events
  eventsInCurrentTrace++;
  if (eventsInCurrentTrace > 5) {
    currentTraceId++;
    eventsInCurrentTrace = 1;
  }
  
  const traceId = `trace-${currentTraceId.toString().padStart(6, '0')}`;
  
  const sourceService = ALL_SERVICES[Math.floor(Math.random() * ALL_SERVICES.length)];
  const targetService = ALL_SERVICES[Math.floor(Math.random() * ALL_SERVICES.length)];
  
  const sourceLabel = LABELS[Math.floor(Math.random() * LABELS.length)];
  const targetLabel = LABELS[Math.floor(Math.random() * LABELS.length)];
  
  const source = `${sourceService.name}_${sourceLabel}`;
  const target = `${targetService.name}_${targetLabel}`;
  
  // Weight status codes to be more realistic (more 200s than errors)
  const statusWeights = {
    '200': 0.7,
    '201': 0.1,
    '400': 0.05,
    '401': 0.03,
    '403': 0.02,
    '404': 0.03,
    '500': 0.02,
    '502': 0.03,
    '503': 0.02
  };
  
  const rand = Math.random();
  let cumulative = 0;
  let status = '200';
  
  for (const [code, weight] of Object.entries(statusWeights)) {
    cumulative += weight;
    if (rand <= cumulative) {
      status = code;
      break;
    }
  }
  
  return {
    source,
    target,
    sourceService: sourceService.service,
    targetService: targetService.service,
    sourceTenant: sourceService.tenant,
    targetTenant: targetService.tenant,
    sourceSystem: sourceService.name,
    targetSystem: targetService.name,
    sourceLabel,
    targetLabel,
    status,
    method: HTTP_METHODS[Math.floor(Math.random() * HTTP_METHODS.length)],
    responseTime: Math.floor(Math.random() * 1000) + 10, // 10-1010ms
    traceId,
    metadata: {
      userAgent: 'service-mesh/1.0',
      region: 'us-east-1'
    }
  };
}

// Store network event in database
export async function storeNetworkEvent(event: InsertNetworkEvent) {
  try {
    const result = await db.insert(networkEvents).values(event).returning();
    if (result.length > 0) {
      console.log(`Stored event ID ${result[0].id} at ${new Date(result[0].timestamp).toISOString()}`);
    }
  } catch (error) {
    console.error('Failed to store network event:', error);
  }
}

// Start generating events at regular intervals
export function startNetworkGenerator(intervalMs: number = 2000) {
  console.log(`Starting network event generator (interval: ${intervalMs}ms)`);
  
  const interval = setInterval(async () => {
    const event = generateNetworkEvent();
    await storeNetworkEvent(event);
    console.log(`Generated event: ${event.source} -> ${event.target} (${event.status})`);
  }, intervalMs);
  
  return () => {
    clearInterval(interval);
    console.log('Network event generator stopped');
  };
}

// Get recent events from database
export async function getRecentEvents(limitCount: number = 100) {
  try {
    const events = await db
      .select()
      .from(networkEvents)
      .orderBy(networkEvents.timestamp)
      .limit(limitCount);
    
    return events;
  } catch (error) {
    console.error('Failed to fetch recent events:', error);
    return [];
  }
}

// Get events since a specific timestamp
export async function getEventsSince(timestamp: Date) {
  try {
    const events = await db
      .select()
      .from(networkEvents)
      .where(gt(networkEvents.timestamp, timestamp))
      .orderBy(networkEvents.timestamp);
    
    return events;
  } catch (error) {
    console.error('Failed to fetch events since timestamp:', error);
    return [];
  }
}

// Get events within a specific time range
export async function getEventsInRange(from: Date, to: Date, limit: number = 1000) {
  try {
    const events = await db
      .select()
      .from(networkEvents)
      .where(
        and(
          gte(networkEvents.timestamp, from),
          lte(networkEvents.timestamp, to)
        )
      )
      .orderBy(desc(networkEvents.timestamp))
      .limit(limit);
    
    return events;
  } catch (error) {
    console.error('Failed to fetch events in range:', error);
    return [];
  }
}