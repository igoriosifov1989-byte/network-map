import type { DiagramData, DiagramNode, DiagramEdge, ParsedFileData, DiagramStats } from '@/types/diagram';

// OpenTelemetry types matching server schema
interface OtelTrace {
  id: number;
  traceId: string;
  serviceName: string;
  serviceVersion: string;
  tenant: string;
  system: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  spanCount: number;
  status: string;
  statusMessage: string | null;
  attributes: Record<string, any>;
  resource: Record<string, any>;
  createdAt: string;
}

interface OtelSpan {
  id: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  tenant: string;
  system: string;
  kind: string; // client, server, internal, producer, consumer
  startTime: string;
  endTime: string | null;
  duration: number | null;
  status: string;
  statusMessage: string | null;
  attributes: Record<string, any>;
  events: any[];
  links: any[];
  resource: Record<string, any>;
  createdAt: string;
}

// Span kind mappings
const SPAN_KINDS: Record<string, string> = {
  'client': 'Client',
  'server': 'Server', 
  'internal': 'Internal',
  'producer': 'Producer',
  'consumer': 'Consumer'
} as const;

// Status color mappings
const STATUS_COLORS = {
  'ok': '#22c55e',      // green
  'error': '#ef4444',   // red
  'unset': '#6b7280'    // gray
} as const;

// Process OpenTelemetry traces and spans into diagram format
export function processOpenTelemetryData(traces: OtelTrace[], allSpans: OtelSpan[]): ParsedFileData {
  console.log(`🔍 OTEL PROCESSOR START: ${traces.length} traces, ${allSpans.length} spans`);
  console.log(`🔍 Sample trace:`, traces[0]?.traceId);
  console.log(`🔍 Sample spans:`, allSpans.slice(0, 3).map(s => `${s.serviceName}:${s.operationName} (parent: ${s.parentSpanId})`));
  
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const nodeMap = new Map<string, DiagramNode>();
  const edgeMap = new Map<string, DiagramEdge>();

  // Create service nodes from spans
  const serviceMap = new Map<string, { service: string; operations: Set<string>; version: string }>();
  
  allSpans.forEach(span => {
    const serviceKey = span.serviceName;
    if (!serviceMap.has(serviceKey)) {
      serviceMap.set(serviceKey, {
        service: span.serviceName,
        operations: new Set(),
        version: span.resource?.['service.version'] || 'unknown'
      });
    }
    serviceMap.get(serviceKey)!.operations.add(span.operationName);
  });

  // Create nodes for each service.operation combination
  allSpans.forEach(span => {
    const nodeId = `${span.serviceName}_${span.operationName}`;
    
    if (!nodeMap.has(nodeId)) {
      const node: DiagramNode = {
        id: nodeId,
        label: span.operationName,
        type: 'endpoint',
        x: 0,
        y: 0,
        service: span.serviceName,
        tenant: span.tenant,
        system: span.system,
        nodeType: 'endpoint',
        endpoints: new Set([span.operationName])
      };
      
      nodeMap.set(nodeId, node);
      nodes.push(node);
    }
  });

  // Create edges from span relationships and service calls
  traces.forEach(trace => {
    const traceSpans = allSpans.filter(span => span.traceId === trace.traceId);
    
    // Sort spans by start time to understand call order
    traceSpans.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Create edges based on parent-child relationships
    traceSpans.forEach(span => {
      if (span.parentSpanId) {
        const parentSpan = traceSpans.find(s => s.spanId === span.parentSpanId);
        if (parentSpan) {
          const sourceId = `${parentSpan.serviceName}_${parentSpan.operationName}`;
          const targetId = `${span.serviceName}_${span.operationName}`;
          
          // Only create edge if it's between different services
          console.log(`🔍 Edge check: ${parentSpan.serviceName} -> ${span.serviceName} (different: ${parentSpan.serviceName !== span.serviceName})`);
          if (parentSpan.serviceName !== span.serviceName) {
            const edgeId = `${sourceId}-${targetId}`;
            console.log(`🔍 Creating edge: ${edgeId}`);
            
            if (!edgeMap.has(edgeId)) {
              const edge: DiagramEdge = {
                id: edgeId,
                source: sourceId,
                target: targetId,
                label: `${SPAN_KINDS[span.kind] || span.kind} Call`,
                connectionCount: 0,
                trafficType: 'inter-service',
                latency: span.duration ? Math.round(span.duration / 1000000) : 0, // Convert to ms
                status: span.status,
                statusCounts: {},
                traceId: span.traceId
              };
              
              edgeMap.set(edgeId, edge);
              edges.push(edge);
            }
            
            // Update connection count and status
            const edge = edgeMap.get(edgeId)!;
            edge.connectionCount = (edge.connectionCount || 0) + 1;
            
            // Update traceId (combine if multiple traces use same edge)
            if (edge.traceId && edge.traceId !== span.traceId) {
              const existingTraces = edge.traceId.split(',').map(id => id.trim());
              if (!existingTraces.includes(span.traceId)) {
                edge.traceId = `${edge.traceId},${span.traceId}`;
              }
            } else if (!edge.traceId) {
              edge.traceId = span.traceId;
            }
            
            // Track status codes
            const statusKey = span.attributes?.['http.status_code'] || span.status;
            if (!edge.statusCounts) edge.statusCounts = {};
            edge.statusCounts[statusKey] = (edge.statusCounts[statusKey] || 0) + 1;
          }
        }
      }
    });
  });

  // Calculate statistics
  const stats: DiagramStats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    totalConnections: edges.reduce((sum, edge) => sum + (edge.connectionCount || 1), 0),
    connectedComponents: calculateConnectedComponents(nodes, edges),
    componentCount: calculateConnectedComponents(nodes, edges)
  };

  const data: DiagramData = { nodes, edges };
  
  console.log(`🔍 OTEL PROCESSOR RESULT: ${nodes.length} nodes, ${edges.length} edges`);
  console.log(`🔍 Sample edges:`, edges.slice(0, 3).map(e => `${e.source} -> ${e.target}`));

  return { data, stats };
}

// Merge OpenTelemetry data with existing file data
export function mergeOpenTelemetryData(
  existingData: ParsedFileData | null,
  otelData: ParsedFileData
): ParsedFileData {
  if (!existingData) {
    return otelData;
  }

  const nodeMap = new Map<string, DiagramNode>();
  const edgeMap = new Map<string, DiagramEdge>();

  // Add existing nodes
  existingData.data.nodes.forEach(node => {
    nodeMap.set(node.id, { ...node });
  });

  // Add existing edges
  existingData.data.edges.forEach(edge => {
    edgeMap.set(edge.id, { ...edge });
  });

  // Merge new nodes
  otelData.data.nodes.forEach(node => {
    if (nodeMap.has(node.id)) {
      // Update existing node
      const existing = nodeMap.get(node.id)!;
      if (node.endpoints) {
        existing.endpoints = [...new Set([...(existing.endpoints || []), ...node.endpoints])];
      }
    } else {
      nodeMap.set(node.id, { ...node });
    }
  });

  // Merge new edges
  otelData.data.edges.forEach(edge => {
    if (edgeMap.has(edge.id)) {
      // Merge connection counts and status codes
      const existing = edgeMap.get(edge.id)!;
      existing.connectionCount = (existing.connectionCount || 0) + (edge.connectionCount || 1);
      
      if (edge.statusCounts) {
        if (!existing.statusCounts) existing.statusCounts = {};
        Object.entries(edge.statusCounts).forEach(([status, count]) => {
          existing.statusCounts![status] = (existing.statusCounts![status] || 0) + count;
        });
      }
      
      // Update latency (average)
      if (edge.latency && existing.latency) {
        existing.latency = Math.round((existing.latency + edge.latency) / 2);
      } else if (edge.latency) {
        existing.latency = edge.latency;
      }
    } else {
      edgeMap.set(edge.id, { ...edge });
    }
  });

  const mergedNodes = Array.from(nodeMap.values());
  const mergedEdges = Array.from(edgeMap.values());

  const stats: DiagramStats = {
    nodeCount: mergedNodes.length,
    edgeCount: mergedEdges.length,
    totalConnections: mergedEdges.reduce((sum, edge) => sum + (edge.connectionCount || 1), 0),
    connectedComponents: calculateConnectedComponents(mergedNodes, mergedEdges),
    componentCount: calculateConnectedComponents(mergedNodes, mergedEdges)
  };

  return {
    data: { nodes: mergedNodes, edges: mergedEdges },
    stats
  };
}

// Calculate connected components for graph analysis
function calculateConnectedComponents(nodes: DiagramNode[], edges: DiagramEdge[]): number {
  const nodeSet = new Set(nodes.map(n => n.id));
  const adjacencyList = new Map<string, Set<string>>();
  
  // Initialize adjacency list
  nodes.forEach(node => {
    adjacencyList.set(node.id, new Set());
  });
  
  // Build adjacency list
  edges.forEach(edge => {
    const source = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
    
    if (nodeSet.has(source) && nodeSet.has(target)) {
      adjacencyList.get(source)?.add(target);
      adjacencyList.get(target)?.add(source);
    }
  });
  
  const visited = new Set<string>();
  let components = 0;
  
  function dfs(nodeId: string) {
    visited.add(nodeId);
    adjacencyList.get(nodeId)?.forEach(neighbor => {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      }
    });
  }
  
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      dfs(node.id);
      components++;
    }
  });
  
  return components;
}

// Convert traces for trace list display
export function convertTracesForDisplay(traces: OtelTrace[]): Array<{
  traceId: string;
  serviceName: string;
  duration: number;
  spanCount: number;
  status: string;
  timestamp: string;
}> {
  return traces.map(trace => ({
    traceId: trace.traceId,
    serviceName: trace.serviceName,
    duration: trace.duration || 0,
    spanCount: trace.spanCount,
    status: trace.status,
    timestamp: trace.startTime
  }));
}

// Get span hierarchy for a trace
export function getSpanHierarchy(spans: OtelSpan[]): Array<OtelSpan & { level: number; children: string[] }> {
  const spanMap = new Map(spans.map(span => [span.spanId, span]));
  const hierarchy: Array<OtelSpan & { level: number; children: string[] }> = [];
  
  // Find root spans (no parent)
  const rootSpans = spans.filter(span => !span.parentSpanId);
  
  function buildHierarchy(span: OtelSpan, level: number = 0): void {
    const children = spans.filter(s => s.parentSpanId === span.spanId).map(s => s.spanId);
    
    hierarchy.push({
      ...span,
      level,
      children
    });
    
    // Process children
    children.forEach(childId => {
      const childSpan = spanMap.get(childId);
      if (childSpan) {
        buildHierarchy(childSpan, level + 1);
      }
    });
  }
  
  rootSpans.forEach(rootSpan => buildHierarchy(rootSpan));
  
  return hierarchy;
}