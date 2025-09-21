import { db } from "./db";
import { serviceMetrics, type InsertServiceMetrics } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

// Service configurations for realistic metrics
const SERVICE_CONFIGS = [
  { name: "api-gateway", type: "kubernetes", baseLoad: 0.6 },
  { name: "user-service", type: "kubernetes", baseLoad: 0.4 },
  { name: "payment-service", type: "kubernetes", baseLoad: 0.7 },
  { name: "inventory-service", type: "vm", baseLoad: 0.5 },
  { name: "notification-service", type: "kubernetes", baseLoad: 0.3 },
  { name: "platform-service1", type: "vm", baseLoad: 0.6 },
  { name: "platform-service2", type: "kubernetes", baseLoad: 0.5 },
  { name: "platform-service3", type: "vm", baseLoad: 0.4 },
  { name: "gateway-service1", type: "kubernetes", baseLoad: 0.8 }
];

function generateServiceMetrics(serviceName: string, deploymentType: string, baseLoad: number): InsertServiceMetrics {
  // Add some realistic variation (±30%)
  const loadVariation = 0.7 + (Math.random() * 0.6);
  const currentLoad = Math.min(95, baseLoad * 100 * loadVariation);
  
  // CPU usage correlates with base load
  const cpuUsage = Math.min(95, currentLoad + (Math.random() * 10 - 5));
  
  // Memory usage is typically more stable
  const memoryUsage = Math.min(90, 30 + (currentLoad * 0.5) + (Math.random() * 20 - 10));
  
  // Disk usage grows slowly
  const diskUsage = Math.min(85, 20 + (Math.random() * 30));
  
  // Network activity correlates with load
  const networkIn = Math.max(0.1, currentLoad * 0.5 + (Math.random() * 20 - 10));
  const networkOut = Math.max(0.1, currentLoad * 0.3 + (Math.random() * 15 - 7.5));
  
  // Pod count for Kubernetes services
  const podCount = deploymentType === "kubernetes" ? Math.max(1, Math.floor(currentLoad / 30) + 1) : null;
  
  // Active connections
  const activeConnections = Math.floor(currentLoad * 5 + (Math.random() * 100));
  
  // Error rate (higher when overloaded)
  const errorRate = cpuUsage > 80 ? Math.random() * 5 + 2 : Math.random() * 2;
  
  // Response time (increases with load)
  const responseTime = Math.max(10, 50 + (cpuUsage * 5) + (Math.random() * 100 - 50));
  
  // Health status based on overall metrics
  let healthStatus: "healthy" | "warning" | "critical";
  if (cpuUsage > 85 || memoryUsage > 85 || errorRate > 5) {
    healthStatus = "critical";
  } else if (cpuUsage > 70 || memoryUsage > 70 || errorRate > 2) {
    healthStatus = "warning";
  } else {
    healthStatus = "healthy";
  }
  
  return {
    serviceName,
    deploymentType: deploymentType as "kubernetes" | "vm",
    cpuUsage: Math.round(cpuUsage * 100) / 100,
    memoryUsage: Math.round(memoryUsage * 100) / 100,
    diskUsage: Math.round(diskUsage * 100) / 100,
    networkIn: Math.round(networkIn * 100) / 100,
    networkOut: Math.round(networkOut * 100) / 100,
    podCount,
    activeConnections,
    errorRate: Math.round(errorRate * 100) / 100,
    responseTime: Math.round(responseTime),
    healthStatus,
    timestamp: new Date()
  };
}

export async function storeServiceMetrics(metrics: InsertServiceMetrics) {
  try {
    const result = await db.insert(serviceMetrics).values(metrics).returning();
    if (result.length > 0) {
      console.log(`📊 Stored metrics for service ${metrics.serviceName} - ${metrics.healthStatus}`);
    }
  } catch (error) {
    console.error('Failed to store service metrics:', error);
  }
}

export async function generateAndStoreMetricsForAllServices() {
  for (const service of SERVICE_CONFIGS) {
    const metrics = generateServiceMetrics(service.name, service.type, service.baseLoad);
    await storeServiceMetrics(metrics);
  }
}

let metricsInterval: NodeJS.Timeout | null = null;

export function startServiceMetricsGeneration(intervalMs: number = 30000) {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }
  
  // Generate initial metrics
  generateAndStoreMetricsForAllServices();
  
  metricsInterval = setInterval(() => {
    generateAndStoreMetricsForAllServices();
  }, intervalMs);
  
  console.log(`🚀 Service metrics generation started with ${intervalMs}ms interval`);
}

export function stopServiceMetricsGeneration() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    console.log('⏹️ Service metrics generation stopped');
  }
}

export async function getLatestServiceMetrics() {
  try {
    const latest = await db
      .select()
      .from(serviceMetrics)
      .orderBy(desc(serviceMetrics.timestamp))
      .limit(100);
    
    // Group by service name to get latest metrics per service
    const latestPerService = new Map();
    latest.forEach(metric => {
      if (!latestPerService.has(metric.serviceName)) {
        latestPerService.set(metric.serviceName, metric);
      }
    });
    
    return Array.from(latestPerService.values());
  } catch (error) {
    console.error('Error fetching service metrics:', error);
    return [];
  }
}

export async function getServiceMetricsHistory(serviceName: string, limit: number = 50) {
  try {
    return await db
      .select()
      .from(serviceMetrics)
      .where(eq(serviceMetrics.serviceName, serviceName))
      .orderBy(desc(serviceMetrics.timestamp))
      .limit(limit);
  } catch (error) {
    console.error('Error fetching service metrics history:', error);
    return [];
  }
}