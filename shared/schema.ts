import { pgTable, text, serial, integer, jsonb, timestamp, varchar, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const diagrams = pgTable("diagrams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  data: jsonb("data").notNull(), // Stores nodes and edges data
  layout: text("layout").notNull().default("force"),
  settings: jsonb("settings").notNull().default('{}'), // Styling and display settings
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// OpenTelemetry Traces table
export const traces = pgTable("traces", {
  id: serial("id").primaryKey(),
  traceId: varchar("trace_id", { length: 32 }).notNull().unique(), // 128-bit hex
  serviceName: varchar("service_name", { length: 255 }).notNull(),
  serviceVersion: varchar("service_version", { length: 50 }).default("unknown"),
  tenant: varchar("tenant", { length: 100 }).notNull(), // Group of services (api, gateway, payment-system, etc.)
  system: varchar("system", { length: 100 }).notNull(), // Individual service within tenant
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration"), // nanoseconds
  spanCount: integer("span_count").default(0),
  status: varchar("status", { length: 10 }).notNull().default("unset"), // unset, ok, error
  statusMessage: text("status_message"),
  attributes: jsonb("attributes").default({}),
  resource: jsonb("resource").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// OpenTelemetry Spans table
export const spans = pgTable("spans", {
  id: serial("id").primaryKey(),
  traceId: varchar("trace_id", { length: 32 }).notNull(), // 128-bit hex
  spanId: varchar("span_id", { length: 16 }).notNull().unique(), // 64-bit hex
  parentSpanId: varchar("parent_span_id", { length: 16 }),
  operationName: varchar("operation_name", { length: 255 }).notNull(),
  serviceName: varchar("service_name", { length: 255 }).notNull(),
  tenant: varchar("tenant", { length: 100 }).notNull(), // Group of services
  system: varchar("system", { length: 100 }).notNull(), // Individual service within tenant
  kind: varchar("kind", { length: 20 }).notNull().default("internal"), // client, server, internal, producer, consumer
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  duration: integer("duration"), // nanoseconds
  status: varchar("status", { length: 10 }).notNull().default("unset"), // unset, ok, error
  statusMessage: text("status_message"),
  attributes: jsonb("attributes").default({}),
  events: jsonb("events").default([]), // Array of timestamped events
  links: jsonb("links").default([]), // Array of linked spans
  resource: jsonb("resource").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Compatibility table for old network events format
export const networkEvents = pgTable("network_events", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 255 }).notNull(),
  target: varchar("target", { length: 255 }).notNull(),
  sourceService: varchar("source_service", { length: 255 }),
  targetService: varchar("target_service", { length: 255 }),
  sourceTenant: varchar("source_tenant", { length: 100 }).notNull(),
  targetTenant: varchar("target_tenant", { length: 100 }).notNull(),
  sourceSystem: varchar("source_system", { length: 100 }).notNull(),
  targetSystem: varchar("target_system", { length: 100 }).notNull(),
  sourceLabel: varchar("source_label", { length: 255 }),
  targetLabel: varchar("target_label", { length: 255 }),
  status: varchar("status", { length: 10 }),
  method: varchar("method", { length: 10 }),
  responseTime: integer("response_time"),
  traceId: varchar("trace_id", { length: 32 }), // Updated to match traces table
  spanId: varchar("span_id", { length: 16 }), // New field for span correlation
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  metadata: jsonb("metadata"),
});

// Insert schemas for all tables
export const insertDiagramSchema = createInsertSchema(diagrams).omit({
  id: true,
  createdAt: true,
});

export const insertTraceSchema = createInsertSchema(traces).omit({
  id: true,
  createdAt: true,
});

export const insertSpanSchema = createInsertSchema(spans).omit({
  id: true,
  createdAt: true,
});

export const insertNetworkEventSchema = createInsertSchema(networkEvents).omit({
  id: true,
  timestamp: true,
});

// Service metrics table for monitoring computational resources
export const serviceMetrics = pgTable("service_metrics", {
  id: serial("id").primaryKey(),
  serviceName: varchar("service_name", { length: 255 }).notNull(),
  deploymentType: varchar("deployment_type", { length: 20 }).notNull(), // 'kubernetes' | 'vm'
  cpuUsage: real("cpu_usage").notNull(), // percentage 0-100
  memoryUsage: real("memory_usage").notNull(), // percentage 0-100
  diskUsage: real("disk_usage").notNull(), // percentage 0-100
  networkIn: real("network_in").notNull(), // MB/s
  networkOut: real("network_out").notNull(), // MB/s
  podCount: integer("pod_count"), // for kubernetes
  activeConnections: integer("active_connections").notNull(),
  errorRate: real("error_rate").notNull(), // percentage 0-100
  responseTime: real("response_time").notNull(), // average ms
  healthStatus: varchar("health_status", { length: 20 }).notNull(), // 'healthy' | 'warning' | 'critical'
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});

export const insertServiceMetricsSchema = createInsertSchema(serviceMetrics).omit({
  id: true,
  createdAt: true,
});

// Type definitions
export type InsertDiagram = z.infer<typeof insertDiagramSchema>;
export type Diagram = typeof diagrams.$inferSelect;
export type InsertTrace = z.infer<typeof insertTraceSchema>;
export type Trace = typeof traces.$inferSelect;
export type InsertSpan = z.infer<typeof insertSpanSchema>;
export type Span = typeof spans.$inferSelect;
export type InsertNetworkEvent = z.infer<typeof insertNetworkEventSchema>;
export type NetworkEvent = typeof networkEvents.$inferSelect;
export type InsertServiceMetrics = z.infer<typeof insertServiceMetricsSchema>;
export type ServiceMetrics = typeof serviceMetrics.$inferSelect;

// Data structures for diagram elements
export const nodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  service: z.string().optional(),
  tenant: z.string().optional(),
  system: z.string().optional(),
  nodeType: z.enum(['service', 'endpoint']).optional(),
});

export const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  status: z.string().optional(),
  traceId: z.string().optional(),
});

export const diagramDataSchema = z.object({
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

export const diagramSettingsSchema = z.object({
  showLabels: z.boolean().default(true),
  showArrows: z.boolean().default(true),
  nodeColor: z.string().default("primary"),
  nodeSpacing: z.number().default(120),
  clusterSpacing: z.number().default(600),
  brightness: z.number().min(0.1).max(3.0).default(1.0),
});

export type Node = z.infer<typeof nodeSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type DiagramData = z.infer<typeof diagramDataSchema>;
export type DiagramSettings = z.infer<typeof diagramSettingsSchema>;
