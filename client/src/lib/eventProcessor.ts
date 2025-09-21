import type { ParsedFileData, DiagramData, DiagramNode, DiagramEdge } from "@/types/diagram";

interface NetworkEvent {
  id: number;
  source: string;
  target: string;
  sourceService: string;
  targetService: string;
  sourceTenant: string;
  targetTenant: string;
  sourceSystem: string;
  targetSystem: string;
  sourceLabel: string;
  targetLabel: string;
  status: string;
  method: string;
  responseTime: number;
  timestamp: string;
  traceId?: string;
  metadata: any;
}

// Convert network events from database to diagram format
export function processNetworkEvents(events: NetworkEvent[]): ParsedFileData {
  const allNodes = new Map<string, DiagramNode>();
  const connectionCounts = new Map<string, number>();
  const statusCounts = new Map<string, Record<string, number>>();
  const traceIds = new Map<string, Set<string>>();
  const detectedServices = new Map<string, Set<string>>();
  
  // Process events to extract nodes and edges
  events.forEach(event => {
    const sourceId = event.source;
    const targetId = event.target;
    const connectionKey = `${sourceId}->${targetId}`;
    
    // Track connection counts
    connectionCounts.set(connectionKey, (connectionCounts.get(connectionKey) || 0) + 1);
    
    // Track status codes for this connection
    if (!statusCounts.has(connectionKey)) {
      statusCounts.set(connectionKey, {});
    }
    const statusCount = statusCounts.get(connectionKey)!;
    statusCount[event.status] = (statusCount[event.status] || 0) + 1;
    
    // Track trace IDs for this connection
    if (event.traceId) {
      if (!traceIds.has(connectionKey)) {
        traceIds.set(connectionKey, new Set());
      }
      traceIds.get(connectionKey)!.add(event.traceId);
    }
    
    // Track services and their endpoints
    if (!detectedServices.has(event.sourceService)) {
      detectedServices.set(event.sourceService, new Set());
    }
    detectedServices.get(event.sourceService)!.add(event.sourceLabel);
    
    if (!detectedServices.has(event.targetService)) {
      detectedServices.set(event.targetService, new Set());
    }
    detectedServices.get(event.targetService)!.add(event.targetLabel);
    
    // Create or update source node
    if (!allNodes.has(sourceId)) {
      allNodes.set(sourceId, {
        id: sourceId,
        label: event.sourceLabel,
        service: event.sourceService,
        tenant: event.sourceTenant,
        system: event.sourceSystem,
        nodeType: 'endpoint'
      });
    }
    
    // Create or update target node
    if (!allNodes.has(targetId)) {
      allNodes.set(targetId, {
        id: targetId,
        label: event.targetLabel,
        service: event.targetService,
        tenant: event.targetTenant,
        system: event.targetSystem,
        nodeType: 'endpoint'
      });
    }
  });
  
  // Create edges with connection strength and status information
  const edges: DiagramEdge[] = [];
  const processedConnections = new Set<string>();
  
  events.forEach(event => {
    const sourceId = event.source;
    const targetId = event.target;
    const forwardKey = `${sourceId}->${targetId}`;
    const reverseKey = `${targetId}->${sourceId}`;
    
    if (processedConnections.has(forwardKey)) return;
    
    const forwardCount = connectionCounts.get(forwardKey) || 0;
    const reverseCount = connectionCounts.get(reverseKey) || 0;
    
    // Determine traffic type
    const sourceService = event.sourceService;
    const targetService = event.targetService;
    let trafficType: 'inter-service' | 'intra-service' | 'external';
    
    if (!sourceService || !targetService) {
      trafficType = 'external';
    } else if (sourceService === targetService) {
      trafficType = 'intra-service';
    } else {
      trafficType = 'inter-service';
    }
    
    if (forwardCount > 0) {
      const connectionTraces = traceIds.get(forwardKey);
      edges.push({
        id: `${sourceId}-${targetId}`,
        source: sourceId,
        target: targetId,
        connectionCount: forwardCount,
        trafficType,
        statusCounts: statusCounts.get(forwardKey) || {},
        traceId: connectionTraces && connectionTraces.size > 0 ? Array.from(connectionTraces).join(',') : undefined
      });
      processedConnections.add(forwardKey);
    }
    
    // Add reverse edge only if it has connections and hasn't been processed
    if (reverseCount > 0 && !processedConnections.has(reverseKey)) {
      const reverseTraces = traceIds.get(reverseKey);
      edges.push({
        id: `${targetId}-${sourceId}`,
        source: targetId,
        target: sourceId,
        connectionCount: reverseCount,
        trafficType,
        statusCounts: statusCounts.get(reverseKey) || {},
        traceId: reverseTraces && reverseTraces.size > 0 ? Array.from(reverseTraces).join(',') : undefined
      });
      processedConnections.add(reverseKey);
    }
  });
  
  const aggregatedData: DiagramData = {
    nodes: Array.from(allNodes.values()),
    edges
  };
  
  const stats = {
    nodeCount: aggregatedData.nodes.length,
    edgeCount: aggregatedData.edges.length,
    componentCount: detectedServices.size
  };
  
  return {
    data: aggregatedData,
    stats
  };
}

// Merge real-time events with existing file data
export function mergeEventData(existingData: ParsedFileData | null, eventData: ParsedFileData): ParsedFileData {
  if (!existingData) return eventData;
  
  // Combine nodes from both sources
  const allNodes = new Map<string, DiagramNode>();
  
  // Add existing nodes
  existingData.data.nodes.forEach(node => {
    allNodes.set(node.id, node);
  });
  
  // Add/update with real-time nodes
  eventData.data.nodes.forEach(node => {
    allNodes.set(node.id, node);
  });
  
  // Combine edges, preferring real-time data for connections that exist in both
  const allEdges = new Map<string, DiagramEdge>();
  
  // Add existing edges
  existingData.data.edges.forEach(edge => {
    const key = `${edge.source}-${edge.target}`;
    allEdges.set(key, edge);
  });
  
  // Update with real-time edges (they override existing ones)
  eventData.data.edges.forEach(edge => {
    const key = `${edge.source}-${edge.target}`;
    allEdges.set(key, edge);
  });
  
  const mergedData: DiagramData = {
    nodes: Array.from(allNodes.values()),
    edges: Array.from(allEdges.values())
  };
  
  const stats = {
    nodeCount: mergedData.nodes.length,
    edgeCount: mergedData.edges.length,
    componentCount: new Set(mergedData.nodes.map(n => n.service).filter(Boolean)).size
  };
  
  return {
    data: mergedData,
    stats
  };
}