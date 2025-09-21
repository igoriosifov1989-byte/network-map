import * as d3 from "d3";
import type { DiagramNode, DiagramEdge, LayoutType } from "@/types/diagram";

export function applyForceLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number,
  spacing: number = 100
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const simulation = d3.forceSimulation(nodes as any)
    .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(spacing))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(30));

  // Run simulation
  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  return { nodes, edges };
}

export function applyHierarchicalLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  // Create a simple hierarchical layout
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const levels: string[][] = [];
  const visited = new Set<string>();
  const inDegree = new Map<string, number>();

  // Calculate in-degrees
  nodes.forEach(node => inDegree.set(node.id, 0));
  edges.forEach(edge => {
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
  });

  // Find root nodes (no incoming edges)
  let currentLevel = nodes.filter(node => inDegree.get(node.id) === 0).map(node => node.id);
  if (currentLevel.length === 0) {
    currentLevel = [nodes[0]?.id].filter(Boolean);
  }

  while (currentLevel.length > 0 && visited.size < nodes.length) {
    levels.push([...currentLevel]);
    currentLevel.forEach(nodeId => visited.add(nodeId));

    const nextLevel = new Set<string>();
    currentLevel.forEach(nodeId => {
      edges.forEach(edge => {
        const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
        
        if (sourceId === nodeId && !visited.has(targetId)) {
          nextLevel.add(targetId);
        }
      });
    });

    currentLevel = Array.from(nextLevel);
  }

  // Position nodes
  const levelHeight = height / Math.max(levels.length, 1);
  levels.forEach((level, levelIndex) => {
    const nodeWidth = width / Math.max(level.length, 1);
    level.forEach((nodeId, nodeIndex) => {
      const node = nodeMap.get(nodeId);
      if (node) {
        node.x = (nodeIndex + 0.5) * nodeWidth;
        node.y = (levelIndex + 0.5) * levelHeight;
      }
    });
  });

  return { nodes, edges };
}

export function applyCircularLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.3;

  nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.length;
    node.x = centerX + radius * Math.cos(angle);
    node.y = centerY + radius * Math.sin(angle);
  });

  return { nodes, edges };
}

export function applyGridLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const rows = Math.ceil(nodes.length / cols);
  const cellWidth = width / cols;
  const cellHeight = height / rows;

  nodes.forEach((node, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    node.x = (col + 0.5) * cellWidth;
    node.y = (row + 0.5) * cellHeight;
  });

  return { nodes, edges };
}

export function applyServiceGroupedLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number,
  spacing: number = 100
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  // Group nodes by service
  const serviceGroups = new Map<string, DiagramNode[]>();
  const standaloneNodes: DiagramNode[] = [];
  
  nodes.forEach(node => {
    if (node.nodeType === 'endpoint' && node.service) {
      if (!serviceGroups.has(node.service)) {
        serviceGroups.set(node.service, []);
      }
      serviceGroups.get(node.service)!.push(node);
    } else {
      standaloneNodes.push(node);
    }
  });
  
  const margin = 80;
  const serviceRadius = 100;
  const servicesPerRow = Math.ceil(Math.sqrt(serviceGroups.size + standaloneNodes.length));
  const serviceSpacing = spacing * 2.5;
  
  // Layout services in a grid pattern
  let serviceIndex = 0;
  serviceGroups.forEach((endpoints, serviceName) => {
    const row = Math.floor(serviceIndex / servicesPerRow);
    const col = serviceIndex % servicesPerRow;
    
    const serviceCenterX = margin + col * serviceSpacing + serviceSpacing / 2;
    const serviceCenterY = margin + row * serviceSpacing + serviceSpacing / 2;
    
    // Position endpoints in a circle around service center
    endpoints.forEach((endpoint, idx) => {
      const angle = (idx / endpoints.length) * 2 * Math.PI;
      const radius = Math.min(serviceRadius, 30 + endpoints.length * 8);
      endpoint.x = serviceCenterX + Math.cos(angle) * radius;
      endpoint.y = serviceCenterY + Math.sin(angle) * radius;
    });
    
    serviceIndex++;
  });
  
  // Position standalone nodes
  standaloneNodes.forEach((node, idx) => {
    const row = Math.floor((serviceIndex + idx) / servicesPerRow);
    const col = (serviceIndex + idx) % servicesPerRow;
    
    node.x = margin + col * serviceSpacing + serviceSpacing / 2;
    node.y = margin + row * serviceSpacing + serviceSpacing / 2;
  });

  return { nodes, edges };
}

export function applyNetworkTopologyLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number,
  spacing: number = 100
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  // Calculate connection counts for each node
  const connectionCounts = new Map<string, number>();
  edges.forEach(edge => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    connectionCounts.set(sourceId, (connectionCounts.get(sourceId) || 0) + 1);
    connectionCounts.set(targetId, (connectionCounts.get(targetId) || 0) + 1);
  });
  
  // Sort nodes by connection count (hubs first)
  const sortedNodes = [...nodes].sort((a, b) => 
    (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0)
  );
  
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 3;
  
  // Place nodes in concentric circles based on connectivity
  sortedNodes.forEach((node, idx) => {
    if (idx === 0) {
      // Central hub (most connected)
      node.x = centerX;
      node.y = centerY;
    } else {
      const ring = Math.ceil(idx / 8); // 8 nodes per ring
      const ringRadius = Math.min(maxRadius, ring * 60);
      const nodesInRing = Math.min(8, sortedNodes.length - ((ring - 1) * 8));
      const angleStep = (2 * Math.PI) / nodesInRing;
      const angle = ((idx - 1) % 8) * angleStep;
      
      node.x = centerX + Math.cos(angle) * ringRadius;
      node.y = centerY + Math.sin(angle) * ringRadius;
    }
  });

  return { nodes, edges };
}

export function applyLayout(
  layoutType: LayoutType,
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  width: number,
  height: number,
  spacing: number = 100
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  switch (layoutType) {
    case "force":
      return applyForceLayout(nodes, edges, width, height, spacing);
    case "hierarchical":
      return applyHierarchicalLayout(nodes, edges, width, height);
    case "circular":
      return applyCircularLayout(nodes, edges, width, height);
    case "grid":
      return applyGridLayout(nodes, edges, width, height);
    case "service-grouped":
      return applyServiceGroupedLayout(nodes, edges, width, height, spacing);
    case "network-topology":
      return applyNetworkTopologyLayout(nodes, edges, width, height, spacing);
    default:
      return { nodes, edges };
  }
}

export function exportAsSVG(svgElement: SVGSVGElement, filename: string = "diagram.svg") {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  
  URL.revokeObjectURL(url);
}

export function exportAsPNG(svgElement: SVGSVGElement, filename: string = "diagram.png") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const svgData = new XMLSerializer().serializeToString(svgElement);
  const img = new Image();
  
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }
    });
  };
  
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  img.src = URL.createObjectURL(svgBlob);
}
