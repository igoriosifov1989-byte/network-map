export interface DiagramNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  z?: number;
  service?: string;
  tenant?: string;
  system?: string;
  radius?: number;
  color?: string;
  count?: number;
  isService?: boolean;
  metadata?: any;
  traceId?: string;
  nodeType?: string;
  endpoints?: Set<any>;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  weight?: number;
  color?: string;
  status?: string;
  method?: string;
  responseTime?: number;
  count?: number;
  isDirectional?: boolean;
  metadata?: any;
  traceId?: string;
  connectionCount?: number;
  statusCounts?: Record<string, number>;
  latency?: number;
  trafficType?: string;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramStats {
  nodeCount: number;
  edgeCount: number;
  totalConnections: number;
  connectedComponents: number;
  services?: string[];
  endpoints?: string[];
  componentCount?: number;
}

export interface DiagramSettings {
  nodeSpacing: number;
  clusterSpacing: number;
  clusterSpacingY: number;
  showLabels: boolean;
  showArrows: boolean;
  nodeColor: string;
  edgeColor: string;
  backgroundColor: string;
  showLegend: boolean;
  brightness?: number;
}

export interface ParsedFileData {
  data: DiagramData;
  stats: DiagramStats;
  filename?: string;
}

export type LayoutType = 
  | "force" 
  | "hierarchical" 
  | "circular" 
  | "grid" 
  | "service-grouped" 
  | "3d-network";

export interface TraceInfo {
  traceId: string;
  serviceName: string;
  operationName: string;
  startTime: string;
  duration: number;
  status: string;
  spanCount: number;
}