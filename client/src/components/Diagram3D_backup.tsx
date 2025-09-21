import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { Computer } from "lucide-react";
import ServiceMetricsPopup from "./ServiceMetricsPopup";
import type { DiagramData, DiagramSettings } from "@/types/diagram";
import type { ServiceMetrics } from "@shared/schema";

// Import refactored modules
import { 
  aggregateInterTenantConnections, 
  createMagistralPath, 
  calculateMagistralOffset, 
  getMagistralColor,
  calculateMagistralThickness,
  createDirectionalArrow 
} from "./diagram3d/magistral";
import { 
  calculateObstavoidingPath, 
  calculateDetourPath, 
  calculatePathLength,
  getLineIntersection2D,
  getHighwayPriority 
} from "./diagram3d/pathfinding";
import { 
  updateSceneIncrementally, 
  createOrientationCube,
  getCachedMaterial 
} from "./diagram3d/scene-utils";
import type { MagistralConnection, CameraState, Obstacle } from "./diagram3d/types";

// Все утилитарные функции перенесены в модули для лучшей организации кода
function detectHighwayIntersections(
  path1: THREE.Vector3[],
  path2: THREE.Vector3[],
  tenantPair1: string,
  tenantPair2: string
): { hasIntersection: boolean; intersectionPoint?: THREE.Vector3; elevationOffset?: number } {
  // Check if paths intersect in 2D (XZ plane)
  for (let i = 0; i < path1.length - 1; i++) {
    for (let j = 0; j < path2.length - 1; j++) {
      const segment1Start = path1[i];
      const segment1End = path1[i + 1];
      const segment2Start = path2[j];
      const segment2End = path2[j + 1];
      
      // Line intersection in 2D (ignore Y coordinate)
      const intersection = getLineIntersection2D(
        { x: segment1Start.x, z: segment1Start.z },
        { x: segment1End.x, z: segment1End.z },
        { x: segment2Start.x, z: segment2Start.z },
        { x: segment2End.x, z: segment2End.z }
      );
      
      if (intersection) {
        // Determine which highway gets elevated (priority system)
        const pair1Priority = getHighwayPriority(tenantPair1);
        const pair2Priority = getHighwayPriority(tenantPair2);
        
        // Higher priority goes over (bridge), lower priority stays at ground level or goes under
        const elevationOffset = pair1Priority > pair2Priority ? 50 : -25;
        
        return {
          hasIntersection: true,
          intersectionPoint: new THREE.Vector3(intersection.x, 0, intersection.z),
          elevationOffset
        };
      }
    }
  }
  
  return { hasIntersection: false };
}

function getLineIntersection2D(
  line1Start: { x: number; z: number },
  line1End: { x: number; z: number },
  line2Start: { x: number; z: number },
  line2End: { x: number; z: number }
): { x: number; z: number } | null {
  const x1 = line1Start.x, z1 = line1Start.z;
  const x2 = line1End.x, z2 = line1End.z;
  const x3 = line2Start.x, z3 = line2Start.z;
  const x4 = line2End.x, z4 = line2End.z;
  
  const denom = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
  if (Math.abs(denom) < 0.001) return null; // Parallel lines
  
  const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / denom;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: x1 + t * (x2 - x1),
      z: z1 + t * (z2 - z1)
    };
  }
  
  return null;
}

function getHighwayPriority(tenantPair: string): number {
  // Priority system for highway overpasses/underpasses
  // 1. api-gateway connections get highest priority (federal highways)
  if (tenantPair.includes('api-gateway')) return 100;
  
  // 2. Major tenant connections get medium priority (state highways)
  const majorTenants = ['user-management', 'payment-system', 'security-monitoring'];
  if (majorTenants.some(tenant => tenantPair.includes(tenant))) return 50;
  
  // 3. Other connections get basic priority (local highways)
  return 10;
}

function calculateObstavoidingPath(
  startPos: THREE.Vector3,
  endPos: THREE.Vector3,
  obstacles: { position: THREE.Vector3; radius: number }[],
  cylinderRadius: number = 25
): THREE.Vector3[] {
  const path: THREE.Vector3[] = [];
  
  // Check if direct path is clear
  const directPath = [startPos, endPos];
  let pathBlocked = false;
  
  for (const obstacle of obstacles) {
    // Skip if obstacle is at start or end position (same cylinder)
    const distToStart = obstacle.position.distanceTo(startPos);
    const distToEnd = obstacle.position.distanceTo(endPos);
    if (distToStart < obstacle.radius * 0.8 || distToEnd < obstacle.radius * 0.8) {
      continue;
    }
    
    // Check if line intersects with obstacle cylinder
    const lineDir = new THREE.Vector3().subVectors(endPos, startPos).normalize();
    const toObstacle = new THREE.Vector3().subVectors(obstacle.position, startPos);
    const projectionLength = toObstacle.dot(lineDir);
    
    // Find closest point on line to obstacle center
    const closestPoint = new THREE.Vector3()
      .copy(startPos)
      .add(lineDir.clone().multiplyScalar(projectionLength));
    
    const distanceToLine = obstacle.position.distanceTo(closestPoint);
    const safeDistance = obstacle.radius * 1.05 + cylinderRadius; // 5% margin from sphere radius for closer following
    
    if (distanceToLine < safeDistance && projectionLength > 0 && projectionLength < startPos.distanceTo(endPos)) {
      pathBlocked = true;
      break;
    }
  }
  
  if (!pathBlocked) {
    // Direct path is clear - ensure endpoints are exact surface points
    const midPoint = new THREE.Vector3()
      .addVectors(startPos, endPos)
      .multiplyScalar(0.5);
    return [startPos.clone(), midPoint, endPos.clone()];
  }
  
  // Calculate detour path
  const connectionVector = new THREE.Vector3().subVectors(endPos, startPos);
  const distance = connectionVector.length();
  
  // Find best detour direction (left or right)
  const leftDetour = calculateDetourPath(startPos, endPos, obstacles, true, cylinderRadius);
  const rightDetour = calculateDetourPath(startPos, endPos, obstacles, false, cylinderRadius);
  
  // Choose shorter detour
  const leftLength = calculatePathLength(leftDetour);
  const rightLength = calculatePathLength(rightDetour);
  
  return leftLength <= rightLength ? leftDetour : rightDetour;
}

function calculateDetourPath(
  startPos: THREE.Vector3,
  endPos: THREE.Vector3,
  obstacles: { position: THREE.Vector3; radius: number }[],
  goUp: boolean,
  cylinderRadius: number
): THREE.Vector3[] {
  // New approach: find tangent path around obstacles
  const pathDirection = new THREE.Vector3().subVectors(endPos, startPos).normalize();
  const pathLength = startPos.distanceTo(endPos);
  
  // Find the most blocking obstacle
  let primaryObstacle = null;
  let minClearance = Infinity;
  
  for (const obstacle of obstacles) {
    const toObstacle = new THREE.Vector3().subVectors(obstacle.position, startPos);
    const projectionLength = toObstacle.dot(pathDirection);
    
    if (projectionLength > 0 && projectionLength < pathLength) {
      const closestPoint = new THREE.Vector3()
        .copy(startPos)
        .add(pathDirection.clone().multiplyScalar(projectionLength));
      
      const distanceToLine = obstacle.position.distanceTo(closestPoint);
      const clearance = distanceToLine - obstacle.radius;
      
      if (clearance < minClearance) {
        minClearance = clearance;
        primaryObstacle = obstacle;
      }
    }
  }
  
  if (!primaryObstacle) {
    return [startPos.clone(), endPos.clone()];
  }
  
  // Calculate tangent points around the primary obstacle
  const obstaclePos = primaryObstacle.position;
  const obstacleRadius = primaryObstacle.radius * 1.05 + cylinderRadius; // 5% margin from sphere radius for closer following
  
  // Find perpendicular direction to path in XZ plane (keep Y=0 for horizontal tangent)
  const perpendicular = new THREE.Vector3(-pathDirection.z, 0, pathDirection.x).normalize();
  
  // Calculate tangent points - goUp means left/right direction
  const offset = goUp ? obstacleRadius : -obstacleRadius;
  const tangentPoint = new THREE.Vector3()
    .copy(obstaclePos)
    .add(perpendicular.clone().multiplyScalar(offset));
  
  // Create smooth tangent path staying close to obstacle surface
  const approach = new THREE.Vector3().lerpVectors(startPos, tangentPoint, 0.7);
  const departure = new THREE.Vector3().lerpVectors(tangentPoint, endPos, 0.7);
  
  return [startPos.clone(), approach, tangentPoint, departure, endPos.clone()];
}

function calculatePathLength(path: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += path[i].distanceTo(path[i - 1]);
  }
  return length;
}

// MAGISTRAL SYSTEM FUNCTIONS
interface MagistralConnection {
  sourceTenant: string;
  targetTenant: string;
  edges: any[];
  connectionCount: number;
  statusCodes: Record<string, number>;
}

function aggregateInterTenantConnections(data: ParsedFileData): Map<string, MagistralConnection> {
  const magistrals = new Map<string, MagistralConnection>();
  
  data.edges.forEach(edge => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const sourceNode = data.nodes.find(n => n.id === sourceId);
    const targetNode = data.nodes.find(n => n.id === targetId);
    
    if (!sourceNode || !targetNode || !sourceNode.tenant || !targetNode.tenant) return;
    if (sourceNode.tenant === targetNode.tenant) return; // Skip intra-tenant connections
    
    const magistralKey = `${sourceNode.tenant}->${targetNode.tenant}`;
    
    if (!magistrals.has(magistralKey)) {
      magistrals.set(magistralKey, {
        sourceTenant: sourceNode.tenant,
        targetTenant: targetNode.tenant,
        edges: [],
        connectionCount: 0,
        statusCodes: {}
      });
    }
    
    const magistral = magistrals.get(magistralKey)!;
    magistral.edges.push(edge);
    magistral.connectionCount += edge.connectionCount || 1;
    
    // Aggregate status codes
    if (edge.statusCode) {
      magistral.statusCodes[edge.statusCode] = (magistral.statusCodes[edge.statusCode] || 0) + (edge.connectionCount || 1);
    }
  });
  
  return magistrals;
}

function createMagistralPath(
  sourceCenter: THREE.Vector3,
  targetCenter: THREE.Vector3,
  obstacles: { position: THREE.Vector3; radius: number }[],
  offsetVector?: THREE.Vector3
): THREE.Vector3[] {
  // Apply offset to avoid magistral collision
  let adjustedSource = sourceCenter.clone();
  let adjustedTarget = targetCenter.clone();
  
  if (offsetVector) {
    adjustedSource.add(offsetVector);
    adjustedTarget.add(offsetVector);
  }
  
  // Use existing obstacle avoidance algorithm but adapted for magistrals
  return calculateObstavoidingPath(adjustedSource, adjustedTarget, obstacles, 15); // Thicker radius for magistrals
}

function calculateMagistralOffset(
  sourceCenter: THREE.Vector3,
  targetCenter: THREE.Vector3,
  existingMagistrals: Map<string, { source: THREE.Vector3; target: THREE.Vector3 }>
): THREE.Vector3 | undefined {
  const currentVector = new THREE.Vector3().subVectors(targetCenter, sourceCenter);
  const currentDistance = currentVector.length();
  
  // Check for conflicts with existing magistrals
  for (const [key, existing] of existingMagistrals) {
    const existingVector = new THREE.Vector3().subVectors(existing.target, existing.source);
    const existingDistance = existingVector.length();
    
    // Check if magistrals are parallel and close
    const crossProduct = new THREE.Vector3().crossVectors(currentVector.normalize(), existingVector.normalize());
    const parallelThreshold = 0.2; // Nearly parallel
    
    if (crossProduct.length() < parallelThreshold) {
      // Check distance between line centers
      const midCurrent = new THREE.Vector3().addVectors(sourceCenter, targetCenter).multiplyScalar(0.5);
      const midExisting = new THREE.Vector3().addVectors(existing.source, existing.target).multiplyScalar(0.5);
      const centerDistance = midCurrent.distanceTo(midExisting);
      
      // If too close, apply offset
      if (centerDistance < 100) {
        // Create perpendicular offset vector
        const perpendicular = new THREE.Vector3().crossVectors(currentVector, new THREE.Vector3(0, 1, 0));
        if (perpendicular.length() < 0.1) {
          // Fallback if vectors are vertical
          perpendicular.set(1, 0, 0);
        }
        perpendicular.normalize().multiplyScalar(50); // 50 unit offset
        
        return perpendicular;
      }
    }
  }
  
  return undefined;
}

function getMagistralColor(magistral: MagistralConnection, isReverse: boolean = false): number {
  // Green for forward direction, purple for reverse
  return isReverse ? 0x8B5CF6 : 0x10B981; // Purple : Green
}

function calculateMagistralThickness(connectionCount: number, maxCount: number): number {
  if (maxCount === 1) return 8; // Base thickness for magistrals
  const normalized = (connectionCount - 1) / (maxCount - 1);
  return Math.round(8 + normalized * 12); // 8 to 20 pixels thickness
}

// Helper function to create a single directional arrow
function createDirectionalArrow(
  sourcePoint: THREE.Vector3,
  targetPoint: THREE.Vector3,
  sourceCenter: THREE.Vector3,
  targetCenter: THREE.Vector3,
  obstacles: { position: THREE.Vector3; radius: number }[],
  cylinderRadius: number,
  separationOffset: number,
  edge: any,
  color: number,
  lodLevel: 'high' | 'medium' | 'low',
  calculateLineThickness: (count: number) => number,
  sourceNode: any,
  targetNode: any
): THREE.Group {
  const arrowGroup = new THREE.Group();
  
  // Calculate obstacle-avoiding path
  const path = calculateObstavoidingPath(
    sourcePoint,
    targetPoint,
    obstacles,
    cylinderRadius
  );
  
  // Apply separation offset to middle points
  const offsetPath = path.map((point, index) => {
    if (index === 0 || index === path.length - 1) {
      return point.clone(); // Keep endpoints on cylinder surface
    } else {
      return new THREE.Vector3(point.x, point.y + separationOffset, point.z);
    }
  });
  
  // Create curve
  let curve;
  if (offsetPath.length === 3) {
    curve = new THREE.QuadraticBezierCurve3(
      offsetPath[0],
      offsetPath[1],
      offsetPath[2]
    );
  } else {
    curve = new THREE.CatmullRomCurve3(offsetPath);
  }
  
  // LOD optimization
  const arrowDetail = lodLevel === 'low' ? 4 : lodLevel === 'medium' ? 8 : 50;
  const tubeDetail = lodLevel === 'low' ? 3 : lodLevel === 'medium' ? 4 : 8;
  
  // Create tube line
  const tubeGeometry = new THREE.TubeGeometry(
    curve, 
    arrowDetail, 
    calculateLineThickness(edge.connectionCount || 1) * 0.5, 
    tubeDetail, 
    false
  );
  const tubeMaterial = new THREE.MeshBasicMaterial({ 
    color: color,
    transparent: true,
    opacity: 0.95
  });
  const tubeLine = new THREE.Mesh(tubeGeometry, tubeMaterial);
  tubeLine.userData = {
    isArrow: true,
    edgeData: edge,
    sourceLabel: sourceNode.label,
    targetLabel: targetNode.label
  };
  arrowGroup.add(tubeLine);
  
  // Add direction indicator arrow at center of curve
  const arrowGeometry = new THREE.ConeGeometry(6, 24, 8);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: color });
  const directionArrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
  
  // Position at center of curve
  const centerPoint = curve.getPoint(0.5);
  const tangent = curve.getTangent(0.5).normalize();
  
  directionArrow.position.copy(centerPoint);
  directionArrow.lookAt(
    centerPoint.x + tangent.x,
    centerPoint.y + tangent.y,
    centerPoint.z + tangent.z
  );
  directionArrow.rotateX(Math.PI / 2);
  directionArrow.userData = { isDirectionIndicator: true, edgeData: edge };
  arrowGroup.add(directionArrow);
  
  // Add flow indicator if not low LOD
  if (lodLevel !== 'low') {
    const flowIndicatorDetail = lodLevel === 'medium' ? 4 : 16;
    const flowIndicatorSize = lodLevel === 'medium' ? 2 : 4;
    const flowIndicatorGeometry = new THREE.SphereGeometry(flowIndicatorSize, flowIndicatorDetail, flowIndicatorDetail);
    const flowIndicatorMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.8
    });
    const flowIndicator = new THREE.Mesh(flowIndicatorGeometry, flowIndicatorMaterial);
    flowIndicator.userData = { 
      isFlowIndicator: true, 
      curve: curve,
      speed: 0.02 + Math.random() * 0.03,
      progress: Math.random()
    };
    arrowGroup.add(flowIndicator);
  }
  
  return arrowGroup;
}

function createOrientationCube() {
  const cubeGroup = new THREE.Group();
  
  // Create cube geometry
  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  
  // Face labels adjusted to match model coordinate system
  // X cube = -Z model, Z cube = -X model, Y cube = Y model
  const faceLabels = ['+Z', '-Z', '+Y', '-Y', '+X', '-X'];
  const faceColors = ['#0000FF', '#6666FF', '#00FF00', '#66FF66', '#FF0000', '#FF6666'];
  
  const materials = faceLabels.map((label, index) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 256;
    
    // Fill background with axis-corresponding colors
    const gradient = context.createLinearGradient(0, 0, 256, 256);
    gradient.addColorStop(0, faceColors[index]);
    gradient.addColorStop(1, '#FFFFFF');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    
    // Add thick border for better clickability indication
    context.strokeStyle = '#333333';
    context.lineWidth = 6;
    context.strokeRect(0, 0, 256, 256);
    
    // Add text with shadow for better visibility
    context.fillStyle = '#000000';
    context.font = 'bold 24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Add text shadow
    context.shadowColor = 'rgba(255, 255, 255, 0.8)';
    context.shadowOffsetX = 1;
    context.shadowOffsetY = 1;
    context.shadowBlur = 2;
    
    context.fillText(label, 128, 128);
    
    // Reset shadow
    context.shadowColor = 'transparent';
    
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.MeshBasicMaterial({ map: texture });
  });
  
  const cube = new THREE.Mesh(cubeGeometry, materials);
  
  // Keep cube at origin without rotation - labels adjusted to match model axes
  cube.rotation.set(0, 0, 0);
  
  cubeGroup.add(cube);
  
  // Cube axes are hidden - only face labels show orientation
  
  // Define view orientations for standard CAD views
  const viewOrientations = {
    '+X': { x: 0, y: -Math.PI / 2 },   // Right view
    '-X': { x: 0, y: Math.PI / 2 },    // Left view  
    '+Y': { x: -Math.PI / 2, y: 0 },   // Top view
    '-Y': { x: Math.PI / 2, y: 0 },    // Bottom view
    '+Z': { x: 0, y: 0 },              // Front view
    '-Z': { x: 0, y: Math.PI }         // Back view
  };
  
  return {
    group: cubeGroup,
    cube: cube,
    viewOrientations: viewOrientations,
    faceLabels: faceLabels
  };
}

interface Diagram3DProps {
  data: DiagramData | null;
  settings: DiagramSettings;
  onApplyLayout?: () => void;
  selectedTraceId?: string | null;
  onLODUpdate?: (lodLevel: 'high' | 'medium' | 'low', relativeDistance: number, serviceCount: number) => void;
}

export default function Diagram3D({ data, settings, selectedTraceId, onLODUpdate }: Diagram3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number | null>(null);
  
  // Store camera state to preserve position during updates
  const cameraStateRef = useRef<{
    rotationX: number;
    rotationY: number;
    distance: number;
    panX: number;
    panY: number;
  } | null>(null);
  
  // State for hover tooltip
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    statusCounts: Record<string, number>;
    sourceLabel: string;
    targetLabel: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    statusCounts: {},
    sourceLabel: '',
    targetLabel: ''
  });

  // State for legend visibility
  const [showLegend, setShowLegend] = useState(false);

  // State for service metrics popup
  const [metricsPopup, setMetricsPopup] = useState<{
    visible: boolean;
    serviceName: string;
    metrics: ServiceMetrics | null;
    position: { x: number; y: number };
  }>({
    visible: false,
    serviceName: '',
    metrics: null,
    position: { x: 0, y: 0 }
  });

  // Store last spacing values to detect changes
  const lastSpacingRef = useRef<{
    nodeSpacing: number;
    clusterSpacing: number;
  } | null>(null);

  // Store service metrics
  const [serviceMetrics, setServiceMetrics] = useState<Map<string, ServiceMetrics>>(new Map());

  // Fetch service metrics
  const fetchServiceMetrics = useCallback(async () => {
    try {
      const response = await fetch('/api/metrics/latest');
      if (response.ok) {
        const metrics: ServiceMetrics[] = await response.json();
        const metricsMap = new Map();
        metrics.forEach(metric => {
          metricsMap.set(metric.serviceName, metric);
        });
        setServiceMetrics(metricsMap);
      }
    } catch (error) {
      console.error('Failed to fetch service metrics:', error);
    }
  }, []);

  // Load metrics on mount and periodically refresh
  useEffect(() => {
    fetchServiceMetrics();
    const interval = setInterval(fetchServiceMetrics, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [fetchServiceMetrics]);

  // Initialize scene and camera only once
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup with professional background
    const scene = new THREE.Scene();
    // Modern gradient background (dark professional theme)
    scene.background = new THREE.Color(0x0a0a15);
    sceneRef.current = scene;
    
    // Disable fog to prevent objects disappearing at distance
    scene.fog = null;

    // Camera setup with extended far plane for extreme zoom
    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      10000 // Extended far plane to prevent clipping at distance
    );
    
    // Only set default position if no saved state
    if (!cameraStateRef.current) {
      camera.position.set(0, 0, 500);
    }
    
    cameraRef.current = camera;

    // Professional renderer setup
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false; // Disable shadows to prevent darkening
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.5 * (settings.brightness || 1.0); // Adjustable brightness exposure
    renderer.autoClear = false;
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Handle resize
    const handleResize = () => {
      if (mountRef.current && camera && renderer) {
        camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (mountRef.current && renderer && mountRef.current.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
      
      renderer?.dispose();
    };
  }, []); // Only run once on mount

  // Store previous data for incremental updates
  const prevDataRef = useRef<DiagramData | null>(null);
  const sceneObjectsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const lastLODLevelRef = useRef<'high' | 'medium' | 'low' | null>(null);
  
  // Material cache to prevent WebGL shader issues
  const materialCacheRef = useRef<Map<string, THREE.Material>>(new Map());
  
  // Function to get cached material
  const getCachedMaterial = (color: number, type: 'basic' | 'line' = 'basic') => {
    const key = `${type}-${color}`;
    let material = materialCacheRef.current.get(key);
    
    if (!material) {
      if (type === 'line') {
        material = new THREE.LineBasicMaterial({ color });
      } else {
        material = new THREE.MeshBasicMaterial({ color });
      }
      materialCacheRef.current.set(key, material);
    }
    
    return material;
  };

  // Function to perform incremental scene updates
  const updateSceneIncrementally = (
    scene: THREE.Scene, 
    prevData: DiagramData, 
    newData: DiagramData, 
    sceneObjects: Map<string, THREE.Object3D>
  ) => {
    // Create sets for comparison
    const prevNodeIds = new Set(prevData.nodes.map(n => n.id));
    const newNodeIds = new Set(newData.nodes.map(n => n.id));
    const prevEdgeIds = new Set(prevData.edges.map(e => e.id));
    const newEdgeIds = new Set(newData.edges.map(e => e.id));

    // Remove disappeared nodes and edges
    prevNodeIds.forEach(nodeId => {
      if (!newNodeIds.has(nodeId)) {
        const cylinderKey = `cylinder-${nodeId}`;
        const segmentKey = `segment-${nodeId}`;
        
        [cylinderKey, segmentKey].forEach(key => {
          const object = sceneObjects.get(key);
          if (object) {
            scene.remove(object);
            sceneObjects.delete(key);
            // Dispose geometry and materials
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
              if (object.material instanceof THREE.Material) {
                object.material.dispose();
              }
            }
          }
        });
      }
    });

    prevEdgeIds.forEach(edgeId => {
      if (!newEdgeIds.has(edgeId)) {
        const arrowKey = `arrow-${edgeId}`;
        const object = sceneObjects.get(arrowKey);
        if (object) {
          scene.remove(object);
          sceneObjects.delete(arrowKey);
          // Dispose geometry and materials
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose();
              if (child.material instanceof THREE.Material) {
                child.material.dispose();
              }
            }
          });
        }
      }
    });

    // For new nodes and edges, we'll let the main rendering code handle them
    // by only processing new items in the creation loops
    console.log(`Incremental update: Removed ${prevNodeIds.size - newNodeIds.size} nodes, ${prevEdgeIds.size - newEdgeIds.size} edges`);
  };

  // Update scene data when data changes  
  useEffect(() => {
    console.log('🔄 useEffect triggered with data:', data ? `${data.edges.length} edges` : 'null', 'Data object ID:', data ? Math.random().toString(36).substr(2, 9) : 'null');
    if (!sceneRef.current || !rendererRef.current || !cameraRef.current) return;
    
    console.log('🔄 Scene update starting:', {
      sceneChildren: sceneRef.current.children.length,
      cacheSize: sceneObjectsRef.current.size,
      nodeCount: data ? data.nodes.length : 0,
      edgeCount: data ? data.edges.length : 0,
      firstFewCacheKeys: Array.from(sceneObjectsRef.current.keys()).slice(0, 5)
    });
    
    // Clear cache on component mount/restart to ensure fresh userData
    if (sceneObjectsRef.current.size > 0) {
      console.log('🧹 Clearing scene cache due to component restart');
      sceneObjectsRef.current.clear();
    }
    
    // Clear cache only when data is null or on first mount, not every data change
    if (!data || sceneObjectsRef.current.size === 0) {
      console.log('🧹 Clearing cache for null data or first mount', {
        cacheSizeBefore: sceneObjectsRef.current.size,
        hasData: !!data
      });
      sceneObjectsRef.current.clear();
    }
    
    // Handle empty data by clearing the scene
    if (!data) {
      console.log('💥 Clearing scene for empty data');
      const scene = sceneRef.current;
      
      // Force remove all objects from scene, but keep lights and essential objects
      const toRemove = scene.children.filter(child => 
        !child.userData.isLight && 
        !child.userData.isAxis && 
        !child.userData.isOrientationCube
      );
      
      toRemove.forEach(child => {
        scene.remove(child);
        // Dispose of geometries and materials to free memory
        if (child.type === 'Mesh' || child.type === 'Group') {
          child.traverse((object: any) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach((mat: any) => mat.dispose());
              } else {
                object.material.dispose();
              }
            }
          });
        }
      });
      
      sceneObjectsRef.current.clear();
      prevDataRef.current = null;
      
      // Stop animation loop
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      
      console.log('💥 Scene fully cleared, children count:', scene.children.length);
      
      // Force immediate render to show empty scene
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      renderer.render(scene, camera);
      return;
    }

    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const prevData = prevDataRef.current;
    const sceneObjects = sceneObjectsRef.current;
    
    // Calculate LOD level based on service count and relative camera distance
    const serviceCount = data.nodes.filter(node => node.service).length;
    const currentCameraDistance = camera.position.length();
    
    // Log spacing changes for debugging LOD issues
    const currentSpacing = {
      nodeSpacing: settings.nodeSpacing || 120,
      clusterSpacing: settings.clusterSpacing || 600
    };
    if (!lastSpacingRef.current || 
        lastSpacingRef.current.nodeSpacing !== currentSpacing.nodeSpacing ||
        lastSpacingRef.current.clusterSpacing !== currentSpacing.clusterSpacing) {
      console.log('📏 Spacing changed:', {
        previous: lastSpacingRef.current,
        current: currentSpacing,
        willAffectLOD: 'Yes, scheme size and relative distance will change'
      });
      lastSpacingRef.current = currentSpacing;
    }
    
    console.log('🔍 LOD Debug Info:', {
      clusterSpacing: currentSpacing.clusterSpacing,
      nodeSpacing: currentSpacing.nodeSpacing,
      serviceCount,
      currentCameraDistance: Math.round(currentCameraDistance)
    });
    
    // Calculate scheme bounds to determine relative distance
    const schemeBounds = {
      minX: Math.min(...data.nodes.map(n => (n as any).x3d || 0)),
      maxX: Math.max(...data.nodes.map(n => (n as any).x3d || 0)),
      minY: Math.min(...data.nodes.map(n => (n as any).y3d || 0)),
      maxY: Math.max(...data.nodes.map(n => (n as any).y3d || 0)),
      minZ: Math.min(...data.nodes.map(n => (n as any).z3d || 0)),
      maxZ: Math.max(...data.nodes.map(n => (n as any).z3d || 0))
    };
    
    const schemeWidth = Math.max(schemeBounds.maxX - schemeBounds.minX, 200);
    const schemeHeight = Math.max(schemeBounds.maxY - schemeBounds.minY, 200);
    const schemeDepth = Math.max(schemeBounds.maxZ - schemeBounds.minZ, 200);
    const schemeDiagonal = Math.sqrt(schemeWidth * schemeWidth + schemeHeight * schemeHeight + schemeDepth * schemeDepth);
    
    // Calculate relative distance as ratio to scheme size
    const relativeDistance = currentCameraDistance / schemeDiagonal;
    
    // Dynamic LOD thresholds based on user's actual zoom range
    // Calculate typical zoom range: minimum distance (closest zoom) and maximum practical distance
    const minDistanceRatio = 0.05; // Closest reasonable zoom (5% of diagram size)
    const maxDistanceRatio = 1.5;  // Furthest practical zoom (150% of diagram size)
    const zoomRangeRatio = maxDistanceRatio - minDistanceRatio;
    
    // Calculate dynamic thresholds that divide the user's actual zoom range into 3 equal parts
    const mediumThreshold = minDistanceRatio + zoomRangeRatio * 0.33; // First 33% = 0.53x
    const lowThreshold = minDistanceRatio + zoomRangeRatio * 0.67;    // First 67% = 1.02x
    
    // Apply dynamic LOD thresholds - distance takes priority over service count
    let lodLevel: 'high' | 'medium' | 'low' = 'high';
    
    // Distance based LOD (primary factor)
    console.log('🔍 LOD Logic Debug:', {
      relativeDistance: relativeDistance.toFixed(3),
      mediumThreshold: mediumThreshold.toFixed(3),
      lowThreshold: lowThreshold.toFixed(3),
      'relativeDistance > lowThreshold': relativeDistance > lowThreshold,
      'relativeDistance > mediumThreshold': relativeDistance > mediumThreshold,
      serviceCount
    });
    
    if (relativeDistance > lowThreshold) {
      lodLevel = 'low';
      console.log('🔍 LOD Decision: LOW (distance > lowThreshold)');
    } else if (relativeDistance > mediumThreshold) {
      lodLevel = 'medium';  
      console.log('🔍 LOD Decision: MEDIUM (distance > mediumThreshold)');
    } else {
      lodLevel = 'high'; // Close distance = high detail regardless of service count
      console.log('🔍 LOD Decision: HIGH (close distance)');
    }
    
    // Service count override only for extreme cases
    if (serviceCount > 100) {
      lodLevel = 'low'; // Force low for very large service counts
      console.log('🔍 LOD Override: LOW (serviceCount > 100)');
    }
    
    // LOD calculation completed - debug output in animation loop only

    // Update parent component with LOD data
    if (onLODUpdate) {
      onLODUpdate(lodLevel, relativeDistance, serviceCount);
    }

    // First render - clear everything
    console.log('Render cycle:', { 
      hasPrevData: !!prevData, 
      prevDataEdges: prevData?.edges?.length || 0,
      newDataEdges: data.edges.length,
      sceneObjectsCount: sceneObjects.size
    });
    
    console.log('prevDataRef.current before logic:', prevDataRef.current ? `${prevDataRef.current.edges.length} edges` : 'null');
    
    // Use incremental updates when possible
    if (prevData && sceneObjects.size > 0) {
      console.log('🔄 Using incremental update');
      updateSceneIncrementally(scene, prevData, data, sceneObjects);
      prevDataRef.current = data;
      // Don't return here - continue to restart animation if needed
    }
    
    // Simple approach: never clear the cache, just reuse existing objects
    console.log('Smart caching: scene objects count:', sceneObjects.size);
    console.log('Scene children count:', scene.children.length);
    console.log('Scene children types:', scene.children.map(c => c.type));
    
    // Check if data has actually changed before reusing cache
    const dataHasChanged = !prevData || 
                          prevData.nodes.length !== data.nodes.length || 
                          prevData.edges.length !== data.edges.length ||
                          // Deep compare node and edge IDs to detect actual changes
                          JSON.stringify(prevData.nodes.map(n => n.id).sort()) !== JSON.stringify(data.nodes.map(n => n.id).sort()) ||
                          JSON.stringify(prevData.edges.map(e => e.id).sort()) !== JSON.stringify(data.edges.map(e => e.id).sort());
    
    console.log('🔍 Data change analysis:', {
      hasPrevData: !!prevData,
      nodeCountChanged: prevData ? prevData.nodes.length !== data.nodes.length : 'no prev data',
      edgeCountChanged: prevData ? prevData.edges.length !== data.edges.length : 'no prev data',
      dataHasChanged
    });
    
    // If scene is empty but cache has objects, only restore if data hasn't changed
    if (scene.children.length === 0 && sceneObjects.size > 0 && !dataHasChanged) {
      console.log('🔧 Re-adding cached objects to empty scene (data unchanged)');
      sceneObjects.forEach((obj, key) => {
        // Restore protected userData for cylinders
        if (key.startsWith('endpoint-') && obj.userData && Object.keys(obj.userData).length === 0) {
          const endpointId = key.replace('endpoint-', '');
          const matchingNode = data.nodes.find(node => node.id === endpointId);
          
          if (matchingNode && obj instanceof THREE.Mesh) {
            // Get the actual current color from the material
            const material = obj.material as THREE.MeshBasicMaterial;
            const currentColor = material.color.getHex();
            
            const protectedUserData = {
              nodeId: matchingNode.id,
              isNode: true,
              isEndpoint: true,
              serviceName: matchingNode.service,
              tenant: matchingNode.tenant,
              originalColor: currentColor // Use actual material color
            };
            
            Object.defineProperty(obj, 'userData', {
              get: () => protectedUserData,
              set: (newValue) => {
                console.error('🚨 userData overwrite attempt during restoration!', {
                  endpointId: matchingNode.id,
                  newData: JSON.stringify(newValue)
                });
                Object.assign(protectedUserData, newValue);
              },
              configurable: false,
              enumerable: true
            });
            
            console.log('🔧 Restored protected userData for:', endpointId);
          }
        }
        scene.add(obj);
      });
      prevDataRef.current = data;
      return;
    }
    
    // If data has changed, clear cache and rebuild
    if (dataHasChanged) {
      console.log('🔄 Data changed, clearing cache and rebuilding');
      scene.clear();
      sceneObjects.clear();
    }
    
    // If scene has too many objects (duplication), clear and rebuild from cache
    if (scene.children.length > sceneObjects.size * 2) {
      console.log('🧹 Clearing duplicated scene, rebuilding from cache');
      
      // Dispose old materials and geometries to prevent WebGL issues
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.dispose());
          } else {
            child.material?.dispose();
          }
        }
      });
      
      scene.clear();
      sceneObjects.forEach((obj, key) => {
        // Restore protected userData for cylinders during duplication cleanup
        if (key.startsWith('endpoint-') && obj.userData && Object.keys(obj.userData).length === 0) {
          const endpointId = key.replace('endpoint-', '');
          const matchingNode = data.nodes.find(node => node.id === endpointId);
          
          if (matchingNode) {
            const protectedUserData = {
              nodeId: matchingNode.id,
              isNode: true,
              isEndpoint: true,
              serviceName: matchingNode.service,
              tenant: matchingNode.tenant,
              originalColor: 0xFFFFFF
            };
            
            Object.defineProperty(obj, 'userData', {
              get: () => protectedUserData,
              set: (newValue) => {
                console.error('🚨 userData overwrite during deduplication!', {
                  endpointId: matchingNode.id,
                  newData: JSON.stringify(newValue)
                });
                Object.assign(protectedUserData, newValue);
              },
              configurable: false,
              enumerable: true
            });
            
            console.log('🔧 Restored protected userData during cleanup for:', endpointId);
          }
        }
        scene.add(obj);
      });
      prevDataRef.current = data;
      return;
    }

    // Raycaster for hover detection with wider detection area
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 10; // Increase line detection threshold
    const mouseVector = new THREE.Vector2();
    
    // Function to update mouse coordinates and check for arrow hover
    const updateMouseAndCheckHover = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouseVector, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      
      let hoveredArrow = null;
      for (const intersect of intersects) {
        if (intersect.object.userData?.isArrow) {
          hoveredArrow = intersect.object;
          break;
        }
      }
      
      if (hoveredArrow && hoveredArrow.userData.edgeData) {
        const edgeData = hoveredArrow.userData.edgeData;
        const rect = renderer.domElement.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          statusCounts: edgeData.statusCounts || {},
          sourceLabel: hoveredArrow.userData.sourceLabel || '',
          targetLabel: hoveredArrow.userData.targetLabel || ''
        });
        // Change cursor to pointer when hovering over arrows
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setTooltip(prev => ({ ...prev, visible: false }));
        // Reset cursor to grab when not hovering over arrows
        renderer.domElement.style.cursor = 'grab';
      }
    };

    // Create orientation cube in separate scene
    const cubeScene = new THREE.Scene();
    const cubeCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    // Position camera to match model's coordinate system
    // Model shows: X forward (to viewer), Y up, Z left
    // So camera should be at positive Z looking at origin
    cubeCamera.position.set(0, 0, 3);
    cubeCamera.lookAt(0, 0, 0);
    cubeCamera.up.set(0, 1, 0); // Y is up

    // Create orientation cube at origin first
    const orientationCube = createOrientationCube();
    
    // Position cube group to show in corner while keeping axes aligned with model
    orientationCube.group.position.set(0, 0, 0); // Keep at center initially for axis alignment
    
    cubeScene.add(orientationCube.group);
    
    // Add lighting for the cube
    const cubeLight = new THREE.DirectionalLight(0xffffff, 1);
    cubeLight.position.set(1, 1, 1);
    cubeScene.add(cubeLight);
    const cubeAmbientLight = new THREE.AmbientLight(0x404040, 0.5);
    cubeScene.add(cubeAmbientLight);

    // Add coordinate axes vectors at origin (0,0,0)
    const axesGroup = new THREE.Group();
    
    // X-axis (red)
    const xAxisGeometry = new THREE.CylinderGeometry(2, 2, 60, 8);
    const xAxisMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const xAxis = new THREE.Mesh(xAxisGeometry, xAxisMaterial);
    xAxis.rotation.z = -Math.PI / 2;
    xAxis.position.x = 30;
    axesGroup.add(xAxis);
    
    // X-axis arrow
    const xArrowGeometry = new THREE.ConeGeometry(6, 20, 8);
    const xArrow = new THREE.Mesh(xArrowGeometry, xAxisMaterial);
    xArrow.rotation.z = -Math.PI / 2;
    xArrow.position.x = 70;
    axesGroup.add(xArrow);
    
    // Y-axis (green) 
    const yAxisGeometry = new THREE.CylinderGeometry(2, 2, 60, 8);
    const yAxisMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const yAxis = new THREE.Mesh(yAxisGeometry, yAxisMaterial);
    yAxis.position.y = 30;
    axesGroup.add(yAxis);
    
    // Y-axis arrow
    const yArrowGeometry = new THREE.ConeGeometry(6, 20, 8);
    const yArrow = new THREE.Mesh(yArrowGeometry, yAxisMaterial);
    yArrow.position.y = 70;
    axesGroup.add(yArrow);
    
    // Z-axis (blue)
    const zAxisGeometry = new THREE.CylinderGeometry(2, 2, 60, 8);
    const zAxisMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const zAxis = new THREE.Mesh(zAxisGeometry, zAxisMaterial);
    zAxis.rotation.x = Math.PI / 2;
    zAxis.position.z = 30;
    axesGroup.add(zAxis);
    
    // Z-axis arrow
    const zArrowGeometry = new THREE.ConeGeometry(6, 20, 8);
    const zArrow = new THREE.Mesh(zArrowGeometry, zAxisMaterial);
    zArrow.rotation.x = Math.PI / 2;
    zArrow.position.z = 70;
    axesGroup.add(zArrow);
    
    // Add axis labels
    const axisLabels = ['X', 'Y', 'Z'];
    const axisColors = ['#ff0000', '#00ff00', '#0000ff'];
    const axisPositions = [
      new THREE.Vector3(85, 0, 0),
      new THREE.Vector3(0, 85, 0),
      new THREE.Vector3(0, 0, 85)
    ];

    axisLabels.forEach((label, index) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.width = 64;
      canvas.height = 64;
      
      context.fillStyle = axisColors[index];
      context.font = 'bold 32px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, 32, 32);
      
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(axisPositions[index]);
      sprite.scale.set(15, 15, 1);
      axesGroup.add(sprite);
    });
    
    // Only add axes and lighting if not already present
    if (!scene.getObjectByName('mainAxes')) {
      axesGroup.name = 'mainAxes';
      scene.add(axesGroup);
    }
    
    // Add professional lighting setup only once
    if (!scene.getObjectByName('mainLighting')) {
      const lightingGroup = new THREE.Group();
      lightingGroup.name = 'mainLighting';
      
      // Extremely bright ambient light for guaranteed visibility at any distance
      const ambientLight = new THREE.AmbientLight(0xffffff, 4.0);
      lightingGroup.add(ambientLight);
      
      // Key light - main directional without shadows for maximum brightness
      const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
      keyLight.position.set(100, 150, 80);
      keyLight.castShadow = false; // Disable shadows to prevent darkening
      lightingGroup.add(keyLight);
      
      // Fill light - much brighter, opposite direction
      const fillLight = new THREE.DirectionalLight(0x7fb3d4, 1.8);
      fillLight.position.set(-80, 120, -60);
      lightingGroup.add(fillLight);
      
      // Rim light - dramatic edge lighting
      const rimLight = new THREE.DirectionalLight(0x4a90e2, 1.2);
      rimLight.position.set(20, 50, -120);
      lightingGroup.add(rimLight);
      
      // Additional side lights for better coverage
      const leftLight = new THREE.DirectionalLight(0xaaaaff, 1.5);
      leftLight.position.set(-150, 80, 0);
      lightingGroup.add(leftLight);
      
      const rightLight = new THREE.DirectionalLight(0xffaaaa, 1.5);
      rightLight.position.set(150, 80, 0);
      lightingGroup.add(rightLight);
      
      // Top-down light for uniform illumination
      const topLight = new THREE.DirectionalLight(0xffffff, 1.3);
      topLight.position.set(0, 200, 0);
      lightingGroup.add(topLight);
      
      // Additional directional lights for uniform illumination at any distance
      const bottomLight = new THREE.DirectionalLight(0xffffff, 1.0);
      bottomLight.position.set(0, -200, 0);
      lightingGroup.add(bottomLight);
      
      const frontLight = new THREE.DirectionalLight(0xffffff, 1.2);
      frontLight.position.set(0, 0, 200);
      lightingGroup.add(frontLight);
      
      const backLight = new THREE.DirectionalLight(0xffffff, 1.2);
      backLight.position.set(0, 0, -200);
      lightingGroup.add(backLight);
      
      // Corner lights for complete coverage
      const cornerLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
      cornerLight1.position.set(100, 100, 100);
      lightingGroup.add(cornerLight1);
      
      const cornerLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
      cornerLight2.position.set(-100, 100, -100);
      lightingGroup.add(cornerLight2);
      
      const cornerLight3 = new THREE.DirectionalLight(0xffffff, 0.8);
      cornerLight3.position.set(100, -100, -100);
      lightingGroup.add(cornerLight3);
      
      const cornerLight4 = new THREE.DirectionalLight(0xffffff, 0.8);
      cornerLight4.position.set(-100, -100, 100);
      lightingGroup.add(cornerLight4);
      
      scene.add(lightingGroup);
    }

    // Group nodes by tenant and then by service for clustering
    const tenantGroups = new Map<string, Map<string, DiagramNode[]>>();
    data.nodes.forEach(node => {
      const tenantName = node.tenant || 'Unknown';
      const serviceName = node.service || 'Unknown Service';
      
      if (!tenantGroups.has(tenantName)) {
        tenantGroups.set(tenantName, new Map());
      }
      if (!tenantGroups.get(tenantName)!.has(serviceName)) {
        tenantGroups.get(tenantName)!.set(serviceName, []);
      }
      tenantGroups.get(tenantName)!.get(serviceName)!.push(node);
    });

    // Calculate positions for tenant clusters using settings
    const serviceSpacing = settings.nodeSpacing || 120; // Distance between services within a cluster
    const tenantSpacing = settings.clusterSpacing || 600; // Distance between tenant cluster centers
    const spacing = serviceSpacing; // For backward compatibility

    // Position tenant clusters horizontally, with services arranged symmetrically within each cluster
    
    // Color palette for endpoint segments (bright colors for dark theme)
    const endpointColors = [
      0x60A5FA, // Bright Blue
      0xF87171, // Bright Red
      0x34D399, // Bright Green
      0xFBBF24, // Bright Orange
      0xA78BFA, // Bright Purple
      0xF472B6, // Bright Pink
      0x22D3EE, // Bright Cyan
      0xA3E635, // Bright Lime
      0xFB923C, // Bright Orange-red
      0x818CF8, // Bright Indigo
    ];

    // Calculate inter-tenant connections for proximity-based clustering
    const tenantConnectionCounts = new Map<string, number>();
    const interTenantConnections = new Map<string, Map<string, number>>();
    
    // Count both total connections and inter-tenant connections
    data.edges.forEach(edge => {
      const sourceNode = data.nodes.find(n => n.id === edge.source);
      const targetNode = data.nodes.find(n => n.id === edge.target);
      
      if (sourceNode && targetNode) {
        const sourceTenant = sourceNode.tenant || 'Unknown';
        const targetTenant = targetNode.tenant || 'Unknown';
        
        // Count total connections per tenant
        tenantConnectionCounts.set(sourceTenant, (tenantConnectionCounts.get(sourceTenant) || 0) + 1);
        tenantConnectionCounts.set(targetTenant, (tenantConnectionCounts.get(targetTenant) || 0) + 1);
        
        // Count inter-tenant connections for clustering
        if (sourceTenant !== targetTenant) {
          if (!interTenantConnections.has(sourceTenant)) {
            interTenantConnections.set(sourceTenant, new Map());
          }
          if (!interTenantConnections.has(targetTenant)) {
            interTenantConnections.set(targetTenant, new Map());
          }
          
          const sourceMap = interTenantConnections.get(sourceTenant)!;
          const targetMap = interTenantConnections.get(targetTenant)!;
          
          sourceMap.set(targetTenant, (sourceMap.get(targetTenant) || 0) + 1);
          targetMap.set(sourceTenant, (targetMap.get(sourceTenant) || 0) + 1);
        }
      }
    });
    
    // Build clusters using proximity algorithm
    const tenantClusters = new Map<number, string[]>();
    const assignedTenants = new Set<string>();
    const allTenants = Array.from(tenantGroups.keys());
    
    // Find most connected tenant as cluster 0 center
    const centralTenant = allTenants.reduce((best, tenant) => {
      const connections = tenantConnectionCounts.get(tenant) || 0;
      const bestConnections = tenantConnectionCounts.get(best) || 0;
      return connections > bestConnections ? tenant : best;
    });
    
    tenantClusters.set(0, [centralTenant]);
    assignedTenants.add(centralTenant);
    
    // Build clusters by finding strongly connected tenants
    let clusterIndex = 1;
    
    while (assignedTenants.size < allTenants.length) {
      let bestTenant = '';
      let bestClusterIndex = -1;
      let maxConnectionStrength = 0;
      
      // Find unassigned tenant with strongest connection to existing clusters
      for (const tenant of allTenants) {
        if (assignedTenants.has(tenant)) continue;
        
        for (const [existingClusterIndex, clusterTenants] of tenantClusters) {
          let connectionStrength = 0;
          
          for (const clusterTenant of clusterTenants) {
            const connections = interTenantConnections.get(tenant)?.get(clusterTenant) || 0;
            connectionStrength += connections;
          }
          
          if (connectionStrength > maxConnectionStrength) {
            maxConnectionStrength = connectionStrength;
            bestTenant = tenant;
            bestClusterIndex = existingClusterIndex;
          }
        }
      }
      
      if (bestTenant && maxConnectionStrength > 0) {
        // Add to existing cluster
        tenantClusters.get(bestClusterIndex)!.push(bestTenant);
        assignedTenants.add(bestTenant);
      } else {
        // Create new cluster for isolated tenant
        const remainingTenants = allTenants.filter(t => !assignedTenants.has(t));
        if (remainingTenants.length > 0) {
          tenantClusters.set(clusterIndex, [remainingTenants[0]]);
          assignedTenants.add(remainingTenants[0]);
          clusterIndex++;
        }
      }
    }
    
    console.log('🏘️ Tenant clusters based on inter-connections:', 
      Array.from(tenantClusters.entries()).map(([clusterIdx, tenants]) => ({
        cluster: clusterIdx,
        tenants: tenants,
        connections: tenants.map(t => tenantConnectionCounts.get(t) || 0)
      }))
    );
    
    console.log('🎯 Central tenant selected:', centralTenant, 'with', tenantConnectionCounts.get(centralTenant), 'connections');
    
    // Create ordered list based on cluster membership
    const sortedTenantNames: string[] = [];
    for (const [clusterIdx, tenants] of tenantClusters) {
      // Sort tenants within cluster by connection count
      const sortedClusterTenants = tenants.sort((a, b) => {
        const countA = tenantConnectionCounts.get(a) || 0;
        const countB = tenantConnectionCounts.get(b) || 0;
        return countB - countA;
      });
      sortedTenantNames.push(...sortedClusterTenants);
    }
    
    console.log('🏗️ Tenant+Service cluster architecture - tenants:', sortedTenantNames);
    
    // Store real tenant center positions for trunk routing
    const tenantCenterPositions = new Map<string, THREE.Vector3>();
    
    sortedTenantNames.forEach((tenantName, tenantIndex) => {
      const servicesMap = tenantGroups.get(tenantName)!;
      const services = Array.from(servicesMap.keys()).sort();
      
      // Calculate tenant cluster center position using proximity-based clustering
      let tenantCenterX, tenantCenterY, tenantCenterZ;
      
      // Find which cluster this tenant belongs to
      let tenantClusterIndex = 0;
      let tenantPositionInCluster = 0;
      
      for (const [clusterIdx, clusterTenants] of tenantClusters) {
        const positionInCluster = clusterTenants.indexOf(tenantName);
        if (positionInCluster >= 0) {
          tenantClusterIndex = clusterIdx;
          tenantPositionInCluster = positionInCluster;
          break;
        }
      }
      
      // VERTICAL ARCHITECTURE: Place each tenant at different Y level (like building floors)
      const baseRadius = tenantSpacing * 0.8; // Horizontal distance from center
      
      // Use clusterSpacingY from settings for Y-level spacing
      const levelHeight = settings.clusterSpacingY || 300;
      
      if (tenantName === centralTenant) {
        // Central tenant at origin level (center of Y-axis)
        tenantCenterX = 0;
        tenantCenterY = 0;
        tenantCenterZ = 0;
      } else {
        // Other tenants arranged in spiral pattern above and below center
        const otherTenants = sortedTenantNames.filter(t => t !== centralTenant);
        const tenantIndexInSpiral = otherTenants.indexOf(tenantName);
        
        if (tenantIndexInSpiral >= 0) {
          // Spiral pattern: both angle and height increase
          const spiralTurns = 2.5; // Number of full rotations in the spiral
          const totalTenants = otherTenants.length;
          const spiralProgress = tenantIndexInSpiral / Math.max(1, totalTenants - 1);
          
          // Angle increases with spiral progress
          const angle = spiralProgress * spiralTurns * 2 * Math.PI;
          // Radius varies to create more interesting layout
          const radiusVariation = 0.7 + 0.3 * Math.sin(spiralProgress * Math.PI * 4);
          const currentRadius = baseRadius * radiusVariation;
          
          tenantCenterX = Math.cos(angle) * currentRadius;
          
          // Y-positioning: center tenants around Y=0 (symmetrical above/below)
          const levelsFromCenter = Math.floor((tenantIndexInSpiral + 1) / 2); // Pairs: 1,2->1  3,4->2  5,6->3
          const isEven = (tenantIndexInSpiral % 2) === 1; // 0,2,4... = odd positions (below), 1,3,5... = even positions (above)
          tenantCenterY = isEven ? levelsFromCenter * levelHeight : -levelsFromCenter * levelHeight;
          
          tenantCenterZ = Math.sin(angle) * currentRadius;
        } else {
          // Fallback for edge cases
          tenantCenterX = 0;
          tenantCenterY = (tenantIndex - Math.floor(sortedTenantNames.length / 2)) * levelHeight;
          tenantCenterZ = baseRadius;
        }
      }
      
      // Store real tenant center position
      tenantCenterPositions.set(tenantName, new THREE.Vector3(tenantCenterX, tenantCenterY, tenantCenterZ));
      
      console.log(`🏛️ Creating cluster for tenant: ${tenantName} with ${services.length} services`, {
        connections: tenantConnectionCounts.get(tenantName) || 0,
        position: { x: tenantCenterX, y: tenantCenterY, z: tenantCenterZ },
        cluster: tenantClusterIndex,
        positionInCluster: tenantPositionInCluster,
        clusterSize: tenantClusters.get(tenantClusterIndex)?.length || 0,
        isCentralTenant: tenantName === centralTenant,
        centralTenant: centralTenant
      });
      
      // Create tenant boundary sphere
      const tenantSphereKey = `tenant-sphere-${tenantName}`;
      if (!sceneObjectsRef.current.has(tenantSphereKey)) {
        // Calculate sphere radius based on service count and spacing
        const sphereRadius = Math.max(serviceSpacing * 1.2, serviceSpacing * 0.8 + (services.length * 15));
        const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 16, 12);
        
        // Sphere material with opacity based on LOD level
        const sphereOpacity = lodLevel === 'low' ? 1.0 : 0.05;
        const sphereMaterial = new THREE.MeshBasicMaterial({
          color: tenantName === centralTenant ? 0x4A90E2 : 0x888888,
          transparent: true,
          opacity: sphereOpacity,
          wireframe: false // Never use wireframe
        });
        
        const tenantSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        tenantSphere.position.set(tenantCenterX, tenantCenterY, tenantCenterZ);
        tenantSphere.userData = { 
          isTenantSphere: true, 
          tenantName,
          sphereRadius,
          lodLevel 
        };
        
        scene.add(tenantSphere);
        sceneObjectsRef.current.set(tenantSphereKey, tenantSphere);
        
        // Add large tenant label next to sphere
        const tenantLabelKey = `tenant-label-${tenantName}`;
        if (!sceneObjectsRef.current.has(tenantLabelKey)) {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = 900;
          canvas.height = 180;
          
          // Extra large tenant label styling with black background
          context.fillStyle = 'rgba(0, 0, 0, 0.95)';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.strokeStyle = 'rgba(100, 150, 255, 1.0)';
          context.lineWidth = 4;
          context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
          
          // Extra large white text
          context.fillStyle = '#FFFFFF';
          context.font = 'bold 64px Arial';
          context.textAlign = 'center';
          context.fillText(tenantName.toUpperCase(), canvas.width / 2, canvas.height / 2 + 20);

          const texture = new THREE.CanvasTexture(canvas);
          const labelMaterial = new THREE.SpriteMaterial({ map: texture });
          const tenantLabel = new THREE.Sprite(labelMaterial);
          tenantLabel.position.set(tenantCenterX, tenantCenterY + sphereRadius + 120, tenantCenterZ);
          tenantLabel.scale.set(200, 40, 1); // Smaller tenant labels
          tenantLabel.userData = { 
            isTenantLabel: true, 
            tenantName 
          };
          
          scene.add(tenantLabel);
          sceneObjectsRef.current.set(tenantLabelKey, tenantLabel);
        }
      } else {
        // Update existing sphere for LOD changes
        const existingSphere = sceneObjectsRef.current.get(tenantSphereKey) as THREE.Mesh;
        if (existingSphere) {
          const sphereMaterial = existingSphere.material as THREE.MeshBasicMaterial;
          sphereMaterial.opacity = lodLevel === 'low' ? 1.0 : 0.05;
          sphereMaterial.wireframe = false; // Never use wireframe
          sphereMaterial.needsUpdate = true;
        }
      }
      
      // Arrange services symmetrically within the cluster
      services.forEach((serviceName, serviceIndex) => {
        const endpoints = servicesMap.get(serviceName)!;
        
        // Calculate service position within cluster (symmetric arrangement)
        let serviceX, serviceY, serviceZ;
        
        if (services.length === 1) {
          // Single service at cluster center
          serviceX = tenantCenterX;
          serviceY = tenantCenterY;
          serviceZ = tenantCenterZ;
        } else if (services.length <= 4) {
          // Small cluster: arrange in 2x2 grid pattern in XZ plane
          const cols = Math.min(2, services.length);
          const rows = Math.ceil(services.length / cols);
          const col = serviceIndex % cols;
          const row = Math.floor(serviceIndex / cols);
          
          serviceX = tenantCenterX + (col - (cols - 1) / 2) * serviceSpacing;
          serviceY = tenantCenterY; // All at same Y height
          serviceZ = tenantCenterZ + (row - (rows - 1) / 2) * serviceSpacing;
        } else {
          // Larger cluster: arrange in circle in XZ plane
          const angle = (serviceIndex / services.length) * 2 * Math.PI;
          const radius = serviceSpacing * 0.8;
          
          serviceX = tenantCenterX + Math.cos(angle) * radius;
          serviceY = tenantCenterY; // All at same Y height
          serviceZ = tenantCenterZ + Math.sin(angle) * radius;
        }

        
        // Create segmented cylinder for this service (each endpoint = one segment)
        const segmentHeight = 60;
        const cylinderRadius = 25;
        const segments = lodLevel === 'low' ? 8 : lodLevel === 'medium' ? 16 : 32;
        const totalHeight = segmentHeight * endpoints.length;
        
        endpoints.forEach((endpoint, endpointIndex) => {
          const endpointKey = `endpoint-${endpoint.id}`;
          let existingCylinder = sceneObjectsRef.current.get(endpointKey);
          
          // Track specific endpoint for detailed debugging
          const isTrackedEndpoint = endpoint.id === 'gateway-metrics_route_request';
          
          if (isTrackedEndpoint) {
            console.log('🎯 TRACKED ENDPOINT - Cache lookup:', {
              endpointId: endpoint.id,
              endpointKey,
              existingCylinder: !!existingCylinder,
              existingUserData: existingCylinder?.userData ? JSON.stringify(existingCylinder.userData) : null
            });
          }
          
          if (!existingCylinder && lodLevel !== 'low') {
            const geometry = new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, segmentHeight, segments);
            const colorIndex = endpointIndex % endpointColors.length;
            const material = getCachedMaterial(endpointColors[colorIndex]);
            
            const segmentY = serviceY + (endpointIndex - (endpoints.length - 1) / 2) * segmentHeight;
            
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(serviceX, segmentY, serviceZ);
            // No rotation - keep cylinders vertical (Y-axis aligned)
            mesh.castShadow = false;
            
            // Log creation of ALL cylinders for debugging
            console.log('🏭 Creating new cylinder:', {
              endpointId: endpoint.id,
              position: { x: serviceX, y: segmentY, z: serviceZ },
              geometryType: geometry.type,
              uuid: mesh.uuid
            });
            // Create protected userData that catches overwrites
            const protectedUserData = {
              nodeId: endpoint.id, 
              isNode: true, 
              isEndpoint: true,
              serviceName: serviceName,
              tenant: tenantName,
              originalColor: endpointColors[colorIndex]
            };
            
            // Make userData non-configurable to catch overwrites (ALL endpoints)
            Object.defineProperty(mesh, 'userData', {
              get: () => protectedUserData,
              set: (newValue) => {
                console.error('🚨 userData overwrite attempt!', {
                  endpointId: endpoint.id,
                  oldData: JSON.stringify(protectedUserData),
                  newData: JSON.stringify(newValue),
                  stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n')
                });
                // Allow the overwrite but log it
                Object.assign(protectedUserData, newValue);
              },
              configurable: false,
              enumerable: true
            });
            
            if (isTrackedEndpoint) {
              console.log('🎯 TRACKED ENDPOINT - NEW userData created:', {
                endpointId: endpoint.id,
                nodeId: mesh.userData.nodeId,
                fullUserData: JSON.stringify(mesh.userData),
                position: { x: serviceX, y: segmentY, z: serviceZ }
              });
            }
            
            // Log creation for first few endpoints to debug
            if (endpointIndex < 3) {
              console.log('🔧 Creating cylinder with userData:', {
                endpointId: endpoint.id,
                nodeId: mesh.userData.nodeId,
                hasProtection: !mesh.hasOwnProperty('userData'),
                position: { x: serviceX, y: segmentY, z: serviceZ }
              });
            }
            
            scene.add(mesh);
            sceneObjectsRef.current.set(endpointKey, mesh);
          } else if (existingCylinder) {
            // Check if userData is already protected
            const currentUserData = existingCylinder.userData;
            
            if (isTrackedEndpoint) {
              console.log('🎯 TRACKED ENDPOINT - Existing cylinder found:', {
                endpointId: endpoint.id,
                hasUserData: !!currentUserData,
                nodeId: currentUserData?.nodeId,
                userDataKeys: currentUserData ? Object.keys(currentUserData) : [],
                isProtected: !existingCylinder.hasOwnProperty('userData')
              });
            }
            
            // If userData is missing or empty, recreate protection
            if (!currentUserData || Object.keys(currentUserData).length === 0 || !currentUserData.nodeId) {
              const protectedUserData = {
                nodeId: endpoint.id,
                isNode: true,
                isEndpoint: true,
                serviceName: serviceName,
                tenant: tenantName,
                originalColor: endpointColors[endpointIndex % endpointColors.length]
              };
              
              // Recreate protected userData
              Object.defineProperty(existingCylinder, 'userData', {
                get: () => protectedUserData,
                set: (newValue) => {
                  if (isTrackedEndpoint) {
                    console.error('🚨 TRACKED ENDPOINT - userData overwrite attempt on existing!', {
                      endpointId: endpoint.id,
                      oldData: JSON.stringify(protectedUserData),
                      newData: JSON.stringify(newValue),
                      stackTrace: new Error().stack
                    });
                  }
                  Object.assign(protectedUserData, newValue);
                },
                configurable: false,
                enumerable: true
              });
              
              if (isTrackedEndpoint) {
                console.log('🎯 TRACKED ENDPOINT - userData PROTECTION RESTORED:', {
                  endpointId: endpoint.id,
                  nodeId: protectedUserData.nodeId,
                  fullUserData: JSON.stringify(protectedUserData)
                });
              }
            }
          }

          // Store 3D position for edge connections
          const endpointY = serviceY + (endpointIndex - (endpoints.length - 1) / 2) * segmentHeight;
          (endpoint as any).x3d = serviceX;
          (endpoint as any).y3d = endpointY;
          (endpoint as any).z3d = serviceZ;
          
          // Add endpoint label if LOD allows
          if (lodLevel !== 'low') {
            const endpointLabelKey = `endpoint-label-${endpoint.id}`;
            if (!sceneObjectsRef.current.has(endpointLabelKey)) {
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d')!;
              canvas.width = 300;
              canvas.height = 60;
              
              // Endpoint label styling (smaller than service labels)
              context.fillStyle = 'rgba(40, 40, 60, 0.8)';
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.strokeStyle = 'rgba(100, 150, 255, 0.4)';
              context.lineWidth = 1;
              context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
              
              // White text
              context.fillStyle = '#E0E8FF';
              context.font = '24px Arial';
              context.textAlign = 'center';
              context.fillText(endpoint.label || endpoint.id, canvas.width / 2, canvas.height / 2 + 8);

              const texture = new THREE.CanvasTexture(canvas);
              const labelMaterial = new THREE.SpriteMaterial({ map: texture });
              const endpointLabel = new THREE.Sprite(labelMaterial);
              endpointLabel.position.set(serviceX + 60, endpointY, serviceZ); // Offset to the right
              endpointLabel.scale.set(75, 15, 1); // Smaller than service labels
              endpointLabel.userData = { 
                isLabel: true, 
                isEndpointLabel: true, 
                endpointId: endpoint.id,
                originalColor: 0xFFFFFF
              };
              
              scene.add(endpointLabel);
              sceneObjectsRef.current.set(endpointLabelKey, endpointLabel);
            }
          }
        });
        
        // Add service label above the segmented cylinder
        const serviceLabelKey = `service-label-${serviceName}`;
        if (!sceneObjectsRef.current.has(serviceLabelKey)) {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d')!;
          canvas.width = 400;
          canvas.height = 80;
          
          // Dark background with border
          context.fillStyle = 'rgba(20, 20, 35, 0.9)';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.strokeStyle = 'rgba(150, 180, 255, 0.6)';
          context.lineWidth = 1;
          context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
          
          // White text
          context.fillStyle = '#F0F4FF';
          context.font = '32px Arial';
          context.textAlign = 'center';
          context.fillText(serviceName, canvas.width / 2, canvas.height / 2 + 10);

          const texture = new THREE.CanvasTexture(canvas);
          const labelMaterial = new THREE.SpriteMaterial({ map: texture });
          const label = new THREE.Sprite(labelMaterial);
          label.position.set(serviceX, serviceY + totalHeight/2 + 30, serviceZ);
          label.scale.set(100, 25, 1);
          label.userData = { 
            isLabel: true, 
            isServiceLabel: true, 
            serviceName: serviceName,
            originalColor: 0xFFFFFF
          };
          
          scene.add(label);
          sceneObjectsRef.current.set(serviceLabelKey, label);
        }
      });
      
      // Add tenant cluster label
      const tenantLabelKey = `tenant-label-${tenantName}`;
      if (!sceneObjectsRef.current.has(tenantLabelKey)) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = 512;
        canvas.height = 100;
        
        // Tenant label styling
        context.fillStyle = 'rgba(0, 0, 0, 0.8)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#60A5FA';
        context.lineWidth = 2;
        context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
        context.fillStyle = '#FFFFFF';
        context.font = 'bold 36px Arial';
        context.textAlign = 'center';
        context.fillText(tenantName, canvas.width / 2, canvas.height / 2 + 12);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const label = new THREE.Sprite(material);
        label.position.set(tenantCenterX, tenantCenterY + 80, tenantCenterZ);
        label.scale.set(80, 20, 1);
        label.userData = { 
          isLabel: true, 
          isTenantLabel: true, 
          tenantName: tenantName,
          originalColor: 0xFFFFFF
        };
        
        scene.add(label);
        sceneObjectsRef.current.set(tenantLabelKey, label);
      }
    });





    // Function to get color based on HTTP status code
    const getStatusColor = (status?: string): number => {
      if (!status) return 0xCCCCCC; // Light gray for no status (default)
      
      const statusCode = parseInt(status);
      if (isNaN(statusCode)) return 0xCCCCCC; // Light gray for invalid status
      
      if (statusCode >= 200 && statusCode < 300) return 0x00FF66; // Bright green for 2xx
      if (statusCode >= 300 && statusCode < 400) return 0xFFCC00; // Bright orange for 3xx
      if (statusCode >= 400 && statusCode < 500) return 0xFF4444; // Bright red for 4xx  
      if (statusCode >= 500) return 0xFF1111; // Very bright red for 5xx
      if (statusCode >= 100 && statusCode < 200) return 0x44AAFF; // Bright blue for 1xx
      
      return 0xCCCCCC; // Light gray fallback
    };

    // Calculate maximum connection count for line thickness scaling
    const maxConnectionCount = Math.max(1, ...data.edges.map(edge => edge.connectionCount || 1));
    
    // Function to calculate line thickness (1-10 pixels based on connection frequency)
    const calculateLineThickness = (connectionCount: number): number => {
      if (maxConnectionCount === 1) return 1; // All connections are single
      const normalized = (connectionCount - 1) / (maxConnectionCount - 1); // 0 to 1
      return Math.round(1 + normalized * 9); // 1 to 10
    };

    // Collect obstacle information for path planning
    const obstacles: { position: THREE.Vector3; radius: number }[] = [];
    const cylinderRadius = 25;
    
    // Add all tenant positions as obstacles (using real tenant center positions)
    tenantCenterPositions.forEach((center, tenantName) => {
      const services = Array.from(tenantGroups.get(tenantName)?.keys() || []);
      const sphereRadius = Math.max(serviceSpacing * 1.2, serviceSpacing * 0.8 + (services.length * 15));
      
      obstacles.push({
        position: center.clone(),
        radius: sphereRadius
      });
    });

    // MAGISTRAL SYSTEM: Create inter-tenant highways first
    console.log('🛣️ MAGISTRAL SYSTEM: Creating inter-tenant highways');
    
    // Aggregate inter-tenant connections into magistrals
    const magistrals = aggregateInterTenantConnections(data);
    const maxMagistralCount = Math.max(1, ...Array.from(magistrals.values()).map(m => m.connectionCount));
    
    // Track existing magistrals to avoid overlap
    const existingMagistrals = new Map<string, { source: THREE.Vector3; target: THREE.Vector3 }>();
    
    // Function to create magistral with direction-based coloring
    const createMagistral = (
      magistral: MagistralConnection, 
      magistralKey: string, 
      isReverse: boolean
    ) => {
      const magistralObjKey = `magistral-${magistralKey}`;
      
      // Skip if magistral already exists (for incremental updates)
      if (sceneObjectsRef.current.has(magistralObjKey)) {
        console.log(`Skipping existing magistral: ${magistralObjKey}`);
        return;
      }
      
      const sourceCenter = tenantCenterPositions.get(magistral.sourceTenant);
      const targetCenter = tenantCenterPositions.get(magistral.targetTenant);
      
      if (!sourceCenter || !targetCenter) {
        console.warn(`Missing tenant center for magistral: ${magistralKey}`);
        return;
      }
      
      // Calculate offset to avoid overlap with existing magistrals
      const offsetVector = calculateMagistralOffset(sourceCenter, targetCenter, existingMagistrals);
      if (offsetVector) {
        console.log(`Applied offset to magistral ${magistralKey}:`, offsetVector);
      }
      
      // Create magistral path with obstacle avoidance and offset
      const magistralPath = createMagistralPath(sourceCenter, targetCenter, obstacles, offsetVector);
      
      if (magistralPath.length < 2) {
        console.warn(`Invalid magistral path for: ${magistralKey}`);
        return;
      }
      
      // Create magistral curve
      const curve = new THREE.CatmullRomCurve3(magistralPath);
      const points = curve.getPoints(50);
      const geometry = new THREE.TubeGeometry(curve, 50, calculateMagistralThickness(magistral.connectionCount, maxMagistralCount), 8, false);
      
      // Magistral color: direction-based (green for forward, purple for reverse)
      const material = new THREE.MeshBasicMaterial({
        color: getMagistralColor(magistral, isReverse),
        transparent: true,
        opacity: 0.8
      });
      
      const magistralMesh = new THREE.Mesh(geometry, material);
      magistralMesh.userData = {
        isMagistral: true,
        magistralKey: magistralKey,
        sourceTenant: magistral.sourceTenant,
        targetTenant: magistral.targetTenant,
        connectionCount: magistral.connectionCount
      };
      
      scene.add(magistralMesh);
      sceneObjectsRef.current.set(magistralObjKey, magistralMesh);
      
      // Track this magistral to avoid future overlaps
      existingMagistrals.set(magistralKey, {
        source: sourceCenter.clone(),
        target: targetCenter.clone()
      });
      
      // Add arrows on magistral at 1/3 and 2/3 positions
      const arrow1Pos = curve.getPointAt(0.33);
      const arrow2Pos = curve.getPointAt(0.67);
      const direction = new THREE.Vector3().subVectors(targetCenter, sourceCenter).normalize();
      
      [arrow1Pos, arrow2Pos].forEach((arrowPos, index) => {
        const arrowKey = `magistral-arrow-${magistralKey}-${index}`;
        
        if (!sceneObjectsRef.current.has(arrowKey)) {
          const arrowGeometry = new THREE.ConeGeometry(16, 40, 6);
          const arrowMaterial = new THREE.MeshBasicMaterial({ color: getMagistralColor(magistral, isReverse) });
          const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
          
          arrowMesh.position.copy(arrowPos);
          arrowMesh.lookAt(arrowPos.clone().add(direction));
          arrowMesh.rotateX(Math.PI / 2); // Point forward
          
          arrowMesh.userData = {
            isMagistralArrow: true,
            magistralKey: magistralKey
          };
          
          scene.add(arrowMesh);
          sceneObjectsRef.current.set(arrowKey, arrowMesh);
        }
      });
      
      console.log(`Created magistral: ${magistralKey} with ${magistral.connectionCount} connections`);
    };

    // Create magistrals for all directions
    magistrals.forEach((magistral, magistralKey) => {
      // Check if reverse direction exists
      const reverseKey = `${magistral.targetTenant}->${magistral.sourceTenant}`;
      const reverseExists = magistrals.has(reverseKey);
      
      // Process forward direction (green)
      createMagistral(magistral, magistralKey, false);
      
      // Process reverse direction (purple) if it exists and hasn't been processed yet
      if (reverseExists && !existingMagistrals.has(reverseKey)) {
        const reverseMagistral = magistrals.get(reverseKey)!;
        createMagistral(reverseMagistral, reverseKey, true);
      }
    });

    // VERTICAL ARCHITECTURE: Process intra-tenant connections only
    console.log('🏗️ VERTICAL ARCHITECTURE: Creating intra-tenant connections');

    // Process only intra-tenant connections (inter-tenant are now handled by magistrals)
    const processedEdges = new Set<string>();
    
    data.edges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const sourceNode = data.nodes.find(n => n.id === sourceId);
      const targetNode = data.nodes.find(n => n.id === targetId);
      
      // Process only intra-tenant connections (inter-tenant handled by magistrals)
      if (!sourceNode || !targetNode || !sourceNode.tenant || !targetNode.tenant) return;
      if (sourceNode.tenant !== targetNode.tenant) return; // Skip inter-tenant connections
      
      const edgeKey = `${sourceId}->${targetId}`;
      const arrowKey = `arrow-${edge.id}`;
      
      // Skip if already processed as part of bidirectional pair
      if (processedEdges.has(edgeKey)) return;
      
      // Skip if arrow already exists (for incremental updates)
      if (sceneObjectsRef.current.has(arrowKey)) {
        console.log(`Skipping existing arrow: ${arrowKey}`);
        processedEdges.add(edgeKey);
        // Also mark reverse direction as processed if it's bidirectional
        const reverseKey = `${targetId}->${sourceId}`;
        if (data.edges.find(e => {
          const rSourceId = typeof e.source === 'string' ? e.source : e.source.id;
          const rTargetId = typeof e.target === 'string' ? e.target : e.target.id;
          return rSourceId === targetId && rTargetId === sourceId;
        })) {
          processedEdges.add(reverseKey);
        }
        return;
      }
      
      const sourceX3d = (sourceNode as any)?.x3d;
      const sourceY3d = (sourceNode as any)?.y3d;
      const sourceZ3d = (sourceNode as any)?.z3d;
      const targetX3d = (targetNode as any)?.x3d;
      const targetY3d = (targetNode as any)?.y3d;
      const targetZ3d = (targetNode as any)?.z3d;

      if (sourceNode && targetNode && sourceX3d !== undefined && targetX3d !== undefined && lodLevel !== 'low') {
        // Check if bidirectional connection exists and find return edge
        const returnEdge = data.edges.find(e => {
          const rSourceId = typeof e.source === 'string' ? e.source : e.source.id;
          const rTargetId = typeof e.target === 'string' ? e.target : e.target.id;
          return rSourceId === targetId && rTargetId === sourceId;
        });
        const hasBidirectional = !!returnEdge;
        
        // Color based on HTTP status code for forward direction
        const forwardColor = getStatusColor(edge.status);
        // Color for return direction (if exists)
        const returnColor = getStatusColor(returnEdge?.status);
        
        const arrowGeometry = new THREE.ConeGeometry(6, 24, 8);
        
        if (hasBidirectional) {
          // Mark both directions as processed to avoid duplicate processing
          processedEdges.add(edgeKey);
          processedEdges.add(`${targetId}->${sourceId}`);
          
          // Create separate arrows for each direction using new helper function
          console.log(`Creating separate bidirectional arrows: ${edge.id} and ${returnEdge?.id}`);
          
          // Calculate surface points on cylinders - use adaptive radius based on tenant spheres
          const minObstacleRadius = Math.min(...obstacles.map(o => o.radius));
          const cylinderRadius = minObstacleRadius * 0.12; // 12% of smallest sphere radius
          const separationDistance = minObstacleRadius * 0.15; // 15% of radius for separation
          
          // Cylinders are oriented along Z-axis, so we need to project onto XY plane
          const sourceCenter = new THREE.Vector3(sourceX3d, sourceY3d || 0, sourceZ3d || 0);
          const targetCenter = new THREE.Vector3(targetX3d, targetY3d || 0, targetZ3d || 0);
          
          // Calculate direction in XY plane (perpendicular to cylinder axis)
          const connectionDir2D = new THREE.Vector3(
            targetX3d - sourceX3d,
            (targetY3d || 0) - (sourceY3d || 0),
            0 // Only XY plane for cylinder surface
          ).normalize();
          
          // Surface points on cylinders - project to cylinder surface in XY plane
          const sourceSurfacePoint = new THREE.Vector3(
            sourceX3d + connectionDir2D.x * cylinderRadius,
            (sourceY3d || 0) + connectionDir2D.y * cylinderRadius,
            sourceZ3d || 0 // Keep Z at segment height
          );
          const targetSurfacePoint = new THREE.Vector3(
            targetX3d - connectionDir2D.x * cylinderRadius,
            (targetY3d || 0) - connectionDir2D.y * cylinderRadius,
            targetZ3d || 0 // Keep Z at segment height
          );
          
          // Create forward direction arrow (source → target) with upward offset
          const forwardArrow = createDirectionalArrow(
            sourceSurfacePoint,
            targetSurfacePoint,
            sourceCenter,
            targetCenter,
            obstacles,
            cylinderRadius,
            separationDistance, // Positive offset (upward)
            edge,
            forwardColor,
            lodLevel,
            calculateLineThickness,
            sourceNode,
            targetNode
          );
          scene.add(forwardArrow);
          sceneObjectsRef.current.set(`arrow-${edge.id}-forward`, forwardArrow);
          
          // Create reverse direction arrow (target → source) with downward offset
          if (returnEdge) {
            const reverseArrow = createDirectionalArrow(
              targetSurfacePoint,
              sourceSurfacePoint,
              targetCenter,
              sourceCenter,
              obstacles,
              cylinderRadius,
              -separationDistance, // Negative offset (downward)
              returnEdge,
              returnColor,
              lodLevel,
              calculateLineThickness,
              targetNode,
              sourceNode
            );
            scene.add(reverseArrow);
            sceneObjectsRef.current.set(`arrow-${returnEdge.id}-reverse`, reverseArrow);
          }
        } else {
          // Create single unidirectional arrow using new helper function
          console.log(`Creating unidirectional arrow: ${arrowKey}`);
          
          // Calculate surface points on cylinders - use adaptive radius based on tenant spheres
          const minObstacleRadius = Math.min(...obstacles.map(o => o.radius));
          const cylinderRadius = minObstacleRadius * 0.12; // 12% of smallest sphere radius
          
          // Cylinder centers for surface calculations
          const sourceCenter = new THREE.Vector3(sourceX3d, sourceY3d || 0, sourceZ3d || 0);
          const targetCenter = new THREE.Vector3(targetX3d, targetY3d || 0, targetZ3d || 0);
          
          // Calculate direction in XY plane (perpendicular to cylinder axis)
          const connectionDir2D = new THREE.Vector3(
            targetX3d - sourceX3d,
            (targetY3d || 0) - (sourceY3d || 0),
            0 // Only XY plane for cylinder surface
          ).normalize();
          
          // Surface points on cylinders - project to cylinder surface in XY plane
          const sourceSurfacePoint = new THREE.Vector3(
            sourceX3d + connectionDir2D.x * cylinderRadius,
            (sourceY3d || 0) + connectionDir2D.y * cylinderRadius,
            sourceZ3d || 0 // Keep Z at segment height
          );
          const targetSurfacePoint = new THREE.Vector3(
            targetX3d - connectionDir2D.x * cylinderRadius,
            (targetY3d || 0) - connectionDir2D.y * cylinderRadius,
            targetZ3d || 0 // Keep Z at segment height
          );
          
          // Create unidirectional arrow with no offset (centered)
          const singleArrow = createDirectionalArrow(
            sourceSurfacePoint,
            targetSurfacePoint,
            sourceCenter,
            targetCenter,
            obstacles,
            cylinderRadius,
            0, // No separation offset for unidirectional
            edge,
            forwardColor,
            lodLevel,
            calculateLineThickness,
            sourceNode,
            targetNode
          );
          scene.add(singleArrow);
          sceneObjectsRef.current.set(arrowKey, singleArrow);
          
          processedEdges.add(edgeKey);
        }
      }
    });

    // Camera controls with rotation and panning
    // Initial rotation for standard front view: X right, Y up, Z towards viewer
    let isMouseDown = false;
    let mouseX = 0, mouseY = 0;
    let targetRotationX = 0, targetRotationY = 0;
    let currentRotationX = 0, currentRotationY = 0;
    let cameraDistance = 500;
    let panX = 0, panY = 0;
    let targetPanX = 0, targetPanY = 0;
    
    // Restore camera state if available
    if (cameraStateRef.current) {
      const savedState = cameraStateRef.current;
      currentRotationX = targetRotationX = savedState.rotationX;
      currentRotationY = targetRotationY = savedState.rotationY;
      cameraDistance = savedState.distance;
      panX = targetPanX = savedState.panX;
      panY = targetPanY = savedState.panY;
    }
    
    // Mouse interaction for cube clicking
    
    const onMouseDown = (event: MouseEvent) => {
      // Check if click is on orientation cube first
      const rect = renderer.domElement.getBoundingClientRect();
      const cubeSize = 120;
      const cubeX = renderer.domElement.clientWidth - cubeSize - 10;
      const cubeY = 10;
      
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      
      // If clicking on cube area, handle it separately
      if (clickX >= cubeX && clickX <= cubeX + cubeSize &&
          clickY >= cubeY && clickY <= cubeY + cubeSize) {
        onCubeClick(event);
        return; // Don't start drag on cube
      }
      
      isMouseDown = true;
      mouseX = event.clientX;
      mouseY = event.clientY;
      renderer.domElement.style.cursor = 'grabbing';
    };
    
    const onMouseUp = () => {
      isMouseDown = false;
      renderer.domElement.style.cursor = 'grab';
    };
    
    const onMouseMove = (event: MouseEvent) => {
      // Check if mouse is over cube area and update cursor
      const rect = renderer.domElement.getBoundingClientRect();
      const cubeSize = 120;
      const cubeX = renderer.domElement.clientWidth - cubeSize - 10;
      const cubeY = 10;
      
      const mouseX_canvas = event.clientX - rect.left;
      const mouseY_canvas = event.clientY - rect.top;
      
      const isOverCube = (mouseX_canvas >= cubeX && mouseX_canvas <= cubeX + cubeSize &&
                          mouseY_canvas >= cubeY && mouseY_canvas <= cubeY + cubeSize);
      
      // Check for arrow hover when not dragging
      if (!isMouseDown && !isOverCube) {
        updateMouseAndCheckHover(event);
      } else if (isOverCube) {
        renderer.domElement.style.cursor = 'pointer';
      } else if (!isMouseDown) {
        renderer.domElement.style.cursor = 'grab';
      } else {
        renderer.domElement.style.cursor = 'grabbing';
      }
      
      if (!isMouseDown) return;
      
      const deltaX = event.clientX - mouseX;
      const deltaY = event.clientY - mouseY;
      
      // Shift key for panning, otherwise rotation
      if (event.shiftKey) {
        // Pan mode - move camera position
        targetPanX -= deltaX * 2;
        targetPanY += deltaY * 2;
      } else {
        // Rotation mode with constraints to prevent flipping
        targetRotationY += deltaX * 0.01;
        targetRotationX += deltaY * 0.01;
        
        // Constrain vertical rotation to prevent flipping
        targetRotationX = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, targetRotationX));
      }
      
      mouseX = event.clientX;
      mouseY = event.clientY;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraDistance += event.deltaY * 2;
      
      // Calculate adaptive camera limits based on current scheme size
      if (data && data.nodes.length > 0) {
        // Estimate scheme size using similar logic as in animation loop
        const tenantGroups = Object.groupBy(data.nodes, node => node.tenant || 'default');
        const tenantCount = Object.keys(tenantGroups).length;
        const tenantsPerRow = Math.ceil(Math.sqrt(tenantCount));
        const gridWidth = (tenantsPerRow - 1) * (settings.clusterSpacing || 600);
        const gridHeight = (Math.ceil(tenantCount / tenantsPerRow) - 1) * (settings.clusterSpacing || 600);
        const tenantClusterRadius = (settings.nodeSpacing || 120) * 1.5;
        
        const schemeWidth = Math.max(gridWidth + tenantClusterRadius, 400);
        const schemeHeight = Math.max(200, 200);
        const schemeDepth = Math.max(gridHeight + tenantClusterRadius, 400);
        const schemeDiagonal = Math.sqrt(schemeWidth * schemeWidth + schemeHeight * schemeHeight + schemeDepth * schemeDepth);
        
        // Remove camera distance limits - allow unlimited zoom in/out
        // const minDistance = schemeDiagonal * 0.15;  // 15% of diagonal
        // const maxDistance = schemeDiagonal * 0.35;  // 35% of diagonal - max 0.2x relative distance
        
        // cameraDistance = Math.max(minDistance, Math.min(maxDistance, cameraDistance));
      } else {
        // Remove fixed limits - allow unlimited zoom even without data
        // cameraDistance = Math.max(100, Math.min(1500, cameraDistance));
      }
    };

    // Click handler for orientation cube
    const onCubeClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const cubeSize = 120;
      const cubeX = renderer.domElement.clientWidth - cubeSize - 10;
      const cubeY = 10;
      
      // Check if click is within cube area
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      
      if (clickX >= cubeX && clickX <= cubeX + cubeSize &&
          clickY >= cubeY && clickY <= cubeY + cubeSize) {
        
        // Convert to cube-relative coordinates [-1, 1]
        const cubeMouseCoords = new THREE.Vector2(
          ((clickX - cubeX) / cubeSize) * 2 - 1,
          -((clickY - cubeY) / cubeSize) * 2 + 1
        );
        
        raycaster.setFromCamera(cubeMouseCoords, cubeCamera);
        const intersects = raycaster.intersectObject(orientationCube.cube);
        
        if (intersects.length > 0) {
          const faceIndex = intersects[0].face?.materialIndex;
          
          if (faceIndex !== undefined && faceIndex < orientationCube.faceLabels.length) {
            const faceName = orientationCube.faceLabels[faceIndex];
            const orientation = (orientationCube.viewOrientations as any)[faceName];
            
            // Animate to the selected view with constraints
            targetRotationX = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, orientation.x));
            targetRotationY = orientation.y;
            
            // Reset panning when switching views
            targetPanX = 0;
            targetPanY = 0;
            
            // Prevent default drag behavior
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }
    };

    // Add specific click handler for cube interaction and computer icons
    const onCanvasClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const cubeSize = 120;
      const cubeX = renderer.domElement.clientWidth - cubeSize - 10;
      const cubeY = 10;
      
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      
      // Check if click is in cube area (top-right corner)
      const inCubeArea = (clickX >= cubeX && clickX <= cubeX + cubeSize &&
                         clickY >= cubeY && clickY <= cubeY + cubeSize);
      
      if (inCubeArea) {
        onCubeClick(event);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // Check for computer icon clicks
      const mouseVector = new THREE.Vector2();
      mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouseVector, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      
      for (const intersect of intersects) {
        if (intersect.object.userData?.isComputerIcon && intersect.object.userData?.tenantName) {
          const tenantName = intersect.object.userData.tenantName;
          const firstSystem = data?.nodes.find(n => n.tenant === tenantName);
          const metrics = serviceMetrics.get(firstSystem?.service || tenantName);
          
          setMetricsPopup({
            visible: true,
            serviceName: firstSystem?.service || tenantName,
            metrics: metrics || null,
            position: { x: event.clientX, y: event.clientY }
          });
          
          event.preventDefault();
          event.stopPropagation();
          break;
        }
      }
    };
    
    // Add mousemove handler for cursor changes
    const onCanvasMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const cubeSize = 120;
      const cubeX = renderer.domElement.clientWidth - cubeSize - 10;
      const cubeY = 10;
      
      const mouseX_canvas = event.clientX - rect.left;
      const mouseY_canvas = event.clientY - rect.top;
      
      const isOverCube = (mouseX_canvas >= cubeX && mouseX_canvas <= cubeX + cubeSize &&
                         mouseY_canvas >= cubeY && mouseY_canvas <= cubeY + cubeSize);
      
      if (isOverCube) {
        renderer.domElement.style.cursor = 'pointer';
      } else {
        renderer.domElement.style.cursor = isMouseDown ? 'grabbing' : 'grab';
      }
    };

    // Attach event listeners
    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onCanvasMouseMove);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel);

    // Set initial cursor style
    renderer.domElement.style.cursor = 'grab';

    // Animation loop
    let animationFrameCount = 0;
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      animationFrameCount++;
      
      // Log animation status every 60 frames (roughly 1 second)
      if (animationFrameCount % 60 === 0) {
        console.log('🎬 Animation running, frame:', animationFrameCount);
      }
      
      // Smooth camera rotation and panning
      currentRotationX += (targetRotationX - currentRotationX) * 0.05;
      currentRotationY += (targetRotationY - currentRotationY) * 0.05;
      panX += (targetPanX - panX) * 0.05;
      panY += (targetPanY - panY) * 0.05;
      
      // Always keep camera state updated for instant preservation during data updates
      cameraStateRef.current = {
        rotationX: currentRotationX,
        rotationY: currentRotationY,
        distance: cameraDistance,
        panX: panX,
        panY: panY
      };
      
      // Calculate camera position using proper spherical coordinates
      // Prevent gimbal lock and coordinate system flipping by constraining rotation angles
      const constrainedRotationX = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, currentRotationX));
      
      // Use standard spherical coordinate system: r, theta (azimuth), phi (elevation)
      // theta = currentRotationY (horizontal rotation around Y axis)
      // phi = constrainedRotationX (vertical rotation, constrained to avoid flipping)
      const radius = cameraDistance;
      const theta = currentRotationY;
      const phi = constrainedRotationX;
      
      // Convert spherical to cartesian coordinates
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);
      
      const baseX = radius * cosPhi * sinTheta;
      const baseY = radius * sinPhi;
      const baseZ = radius * cosPhi * cosTheta;
      
      // Apply panning offset
      camera.position.x = baseX + panX;
      camera.position.y = baseY + panY;
      camera.position.z = baseZ;
      
      // Always look at the center point with pan offset
      camera.lookAt(panX, panY, 0);
      
      // Ensure camera maintains consistent up vector to prevent flipping
      camera.up.set(0, 1, 0);
      
      // Update constrained rotation values for cube synchronization
      currentRotationX = constrainedRotationX;
      
      // Update dynamic lighting to follow camera for consistent illumination
      const dynamicLightGroup = scene.getObjectByName('dynamicLighting');
      if (!dynamicLightGroup) {
        const group = new THREE.Group();
        group.name = 'dynamicLighting';
        
        // Camera-following light for guaranteed illumination
        const cameraLight = new THREE.DirectionalLight(0xffffff, 2.0);
        cameraLight.name = 'cameraLight';
        group.add(cameraLight);
        
        scene.add(group);
      } else {
        // Update camera light position to follow camera
        const cameraLight = dynamicLightGroup.getObjectByName('cameraLight') as THREE.DirectionalLight;
        if (cameraLight) {
          cameraLight.position.copy(camera.position);
          cameraLight.target.position.set(panX, panY, 0);
          cameraLight.target.updateMatrixWorld();
        }
      }
      
      // Update LOD information in real-time based on current camera position
      if (data && onLODUpdate) {
        const serviceCount = data.nodes.filter(node => node.service).length;
        const currentCameraDistance = camera.position.length();
        
        // Get current spacing settings to calculate actual scheme bounds
        const currentNodeSpacing = settings.nodeSpacing || 120;
        const currentClusterSpacing = settings.clusterSpacing || 600;
        
        // Calculate scheme bounds based on actual rendered positions (accounting for spacing)
        const tenants = [...new Set(data.nodes.map(n => n.tenant).filter(Boolean))];
        const tenantCount = tenants.length;
        
        // Estimate actual scheme bounds based on tenant grid layout and spacing
        const tenantsPerRow = Math.ceil(Math.sqrt(tenantCount));
        const gridWidth = (tenantsPerRow - 1) * currentClusterSpacing;
        const gridHeight = (Math.ceil(tenantCount / tenantsPerRow) - 1) * currentClusterSpacing;
        
        // Use more reasonable cluster radius based on actual service layout
        const tenantClusterRadius = currentNodeSpacing * 1.5;
        
        const schemeWidth = Math.max(gridWidth + tenantClusterRadius, 400);
        const schemeHeight = Math.max(200, 200); // Cylinder height
        const schemeDepth = Math.max(gridHeight + tenantClusterRadius, 400);
        const schemeDiagonal = Math.sqrt(schemeWidth * schemeWidth + schemeHeight * schemeHeight + schemeDepth * schemeDepth);
        
        // Calculate practical camera zoom range based on current scheme size
        const minPracticalDistance = schemeDiagonal * 0.15;  // 15% of diagonal
        const maxPracticalDistance = schemeDiagonal * 0.35;  // 35% of diagonal - max 0.2x relative distance
        const practicalRange = maxPracticalDistance - minPracticalDistance;
        
        // Normalize current camera distance to 0-1 based on practical range
        const normalizedDistance = Math.max(0, Math.min(1, 
          (currentCameraDistance - minPracticalDistance) / practicalRange));
        
        // LOD thresholds as percentage of practical zoom range
        const mediumThreshold = 0.30;  // 30% of practical range
        const lowThreshold = 0.50;     // 50% of practical range
        
        // For display, show relative distance as percentage
        const relativeDistance = normalizedDistance;
        
        let lodLevel: 'high' | 'medium' | 'low' = 'high';
        
        // Distance based LOD using normalized distance
        if (normalizedDistance > lowThreshold) {
          lodLevel = 'low';
        } else if (normalizedDistance > mediumThreshold) {
          lodLevel = 'medium';  
        } else {
          lodLevel = 'high'; // Close distance = high detail
        }
        
        // Service count override only for extreme cases
        if (serviceCount > 100) {
          lodLevel = 'low';
        }
        
        // Debug log when LOD level changes OR every 300 frames for spacing debugging
        if (lastLODLevelRef.current !== lodLevel || animationFrameCount % 300 === 0) {
          console.log(`🎯 Animation LOD: ${lodLevel} (services: ${serviceCount}, relative distance: ${relativeDistance.toFixed(2)}x, thresholds: high<${mediumThreshold.toFixed(2)}x, medium=${mediumThreshold.toFixed(2)}x-${lowThreshold.toFixed(2)}x, low>${lowThreshold.toFixed(2)}x)`);
          console.log(`🎯 Diagram Size: width=${Math.round(schemeWidth)}, height=${Math.round(schemeHeight)}, depth=${Math.round(schemeDepth)}, diagonal=${Math.round(schemeDiagonal)}`);
          console.log(`🎯 Camera: distance=${Math.round(currentCameraDistance)}, spacing: node=${currentNodeSpacing}, cluster=${currentClusterSpacing}`);
          lastLODLevelRef.current = lodLevel;
        }
        
        // LOD system working correctly
        
        // Update parent component with current LOD data
        onLODUpdate(lodLevel, relativeDistance, serviceCount);
        
        // Apply LOD optimizations to existing scene objects
        scene.traverse((object) => {
          // LOD optimization for cylinder geometry - more aggressive differences
          if (object.userData?.isService && object instanceof THREE.Mesh) {
            const cylinderGeometry = object.geometry as THREE.CylinderGeometry;
            if (cylinderGeometry) {
              const newSegments = lodLevel === 'low' ? 4 : lodLevel === 'medium' ? 8 : 32;
              if (cylinderGeometry.parameters?.radialSegments !== newSegments) {
                const newGeometry = new THREE.CylinderGeometry(
                  cylinderGeometry.parameters.radiusTop,
                  cylinderGeometry.parameters.radiusBottom,
                  cylinderGeometry.parameters.height,
                  newSegments
                );
                object.geometry.dispose();
                object.geometry = newGeometry;
              }
            }
          }
          
          // Update tenant sphere opacity and visibility based on LOD
          if (object.userData?.isTenantSphere && object instanceof THREE.Mesh) {
            const sphereMaterial = object.material as THREE.MeshBasicMaterial;
            sphereMaterial.opacity = lodLevel === 'low' ? 1.0 : 0.05;
            sphereMaterial.needsUpdate = true;
          }
          
          // Hide/show cylinders, labels, and arrows based on LOD
          if (lodLevel === 'low') {
            // At low LOD, hide most details but keep tenant labels, trunk routes, and main arrows
            if (object.userData?.isNode || object.userData?.isEndpoint || 
                object.userData?.isBranch || object.userData?.isService) {
              object.visible = false;
            }
            // Hide service and endpoint labels at low LOD
            if (object.userData?.isServiceLabel || object.userData?.isEndpointLabel) {
              object.visible = false;
            }
            // Keep tenant labels, trunk routes, and arrows visible at all LOD levels
            if (object.userData?.isTenantLabel || object.userData?.isTrunk || 
                object.userData?.isArrow || object.userData?.isArrowHead || 
                object.userData?.isDirectionIndicator || object.userData?.isTrunkArrow) {
              object.visible = true;
            }
          } else {
            // At medium/high LOD, show all details
            if (object.userData?.isNode || object.userData?.isEndpoint || 
                object.userData?.isArrow || object.userData?.isArrowHead || 
                object.userData?.isBranch || object.userData?.isTrunk || object.userData?.isService ||
                object.userData?.isEndpointLabel || object.userData?.isTenantLabel || object.userData?.isServiceLabel ||
                object.userData?.isDirectionIndicator || object.userData?.isTrunkArrow) {
              object.visible = true;
            }
          }
          
          // LOD optimization for flow indicators
          if (object.userData?.isFlowIndicator) {
            if (lodLevel === 'low') {
              object.visible = false; // Hide flow indicators at low detail
            } else {
              object.visible = true;
            }
          }
        });
      }
      
      // Animate flow indicators for data movement
      scene.traverse((object) => {
        if (object.userData?.isFlowIndicator && object.userData?.curve) {
          object.userData.progress += object.userData.speed;
          if (object.userData.progress > 1) {
            object.userData.progress = 0;
          }
          const point = object.userData.curve.getPoint(object.userData.progress);
          object.position.copy(point);
          
          // Add pulsing effect with vibrant glow
          const pulse = 1 + 0.4 * Math.sin(Date.now() * 0.015 + object.userData.progress * 12);
          object.scale.setScalar(pulse);
        }
      });
      
      // Sync cube rotation with main scene to show current coordinate system orientation
      // The cube should rotate opposite to camera to show the current coordinate orientation correctly
      orientationCube.group.rotation.x = -constrainedRotationX;
      orientationCube.group.rotation.y = -currentRotationY;
      
      // Render main scene
      renderer.clear();
      renderer.render(scene, camera);
      
      // Render orientation cube in top-right corner
      const width = renderer.domElement.clientWidth;
      const height = renderer.domElement.clientHeight;
      const cubeSize = 120;
      
      // Clear depth buffer only for cube area to render on top
      // Convert from DOM coordinates (Y=0 at top) to OpenGL coordinates (Y=0 at bottom)
      const cubeYOpenGL = height - 10 - cubeSize;
      renderer.setViewport(width - cubeSize - 10, cubeYOpenGL, cubeSize, cubeSize);
      renderer.clearDepth();
      renderer.setClearColor(0xf8f9fa, 0.9); // Light background with transparency
      renderer.clear(false, true, false); // Clear only color buffer for cube area
      renderer.render(cubeScene, cubeCamera);
      
      // Restore original clear color
      renderer.setClearColor(0xf0f0f0, 1);
      
      // Reset viewport
      renderer.setViewport(0, 0, width, height);
    };

    // Start animation
    console.log('🎬 Starting animation loop');
    animate();

    // Handle resize
    const handleResize = () => {
      if (mountRef.current && camera && renderer) {
        camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      // Save camera state before cleanup using current animation variables
      cameraStateRef.current = {
        rotationX: currentRotationX,
        rotationY: currentRotationY,
        distance: cameraDistance,
        panX: panX,
        panY: panY
      };
      
      renderer.domElement.removeEventListener('click', onCanvasClick);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mousemove', onCanvasMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      
      // Don't remove renderer DOM element here - it's managed by the main useEffect
      
      // Clean up Three.js resources
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (object.material instanceof THREE.Material) {
            object.material.dispose();
          }
        }
      });
      
      renderer?.dispose();
    };
    
    // Save current data as previous for next update
    prevDataRef.current = data;
  }, [data, settings]);

  // Handle brightness changes in real-time
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.toneMappingExposure = 2.5 * (settings.brightness || 1.0);
    }
  }, [settings.brightness]);

  // Track if highlighting has been applied to prevent multiple passes
  const highlightingAppliedRef = useRef<string | null>(null);
  
  // Handle trace highlighting - Updated at 9:04 PM
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`🎯 [${timestamp}] Trace highlighting useEffect START - VERSION 3`);
    console.warn(`🚨 [${timestamp}] NEW CODE EXECUTING - If you see this, the update worked!`);
    
    if (!sceneRef.current || !data) {
      console.log(`🎯 [${timestamp}] Early return - no scene or data`);
      return;
    }
    
    // Always allow re-highlighting for user selections
    // Note: This allows visual feedback when user clicks trace IDs
    
    // Mark as applied before doing the work
    highlightingAppliedRef.current = selectedTraceId;

    console.log(`🎯 [${timestamp}] Trace highlighting useEffect triggered:`, { 
      selectedTraceId, 
      hasScene: !!sceneRef.current,
      hasData: !!data,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      sceneObjectKeys: Array.from(sceneObjectsRef.current.keys()).slice(0, 10)
    });
    
    // Add immediate test when trace is selected
    if (selectedTraceId && data) {
      console.log('🧪 TESTING TRACE SELECTION:', {
        selectedTraceId,
        relevantEdges: data.edges.filter(e => e.traceId && e.traceId.includes(selectedTraceId)),
        allTraceIds: data.edges.map(e => e.traceId).filter(Boolean).slice(0, 5)
      });
    }
    
    // Simplified edge analysis - only show matching edges
    const matchingTraceEdges = data.edges.filter(e => e.traceId && e.traceId.includes(selectedTraceId));
    console.log(`🎯 Found ${matchingTraceEdges.length} edges with selected trace ${selectedTraceId}:`);
    matchingTraceEdges.slice(0, 3).forEach((edge, i) => {
      console.log(`  ↳ Matching edge ${i}:`, {
        source: edge.source,
        target: edge.target,
        traceId: edge.traceId
      });
    });
    

    
    // Find nodes we need to highlight
    const requiredNodeIds = new Set();
    matchingTraceEdges.forEach(edge => {
      requiredNodeIds.add(edge.source);
      requiredNodeIds.add(edge.target);
    });
    console.log('🎯 Required nodes for highlighting:', Array.from(requiredNodeIds));
    
    // Show coordinates of required nodes
    Array.from(requiredNodeIds).slice(0, 3).forEach(nodeId => {
      const node = data.nodes.find(n => n.id === nodeId);
      if (node) {
        console.log(`  📍 Node ${nodeId}:`, {
          x3d: node.x3d,
          y3d: node.y3d || 'undefined',
          z3d: node.z3d,
          service: node.service,
          tenant: node.tenant
        });
      }
    });
    
    const scene = sceneRef.current;
    let cylinderCount = 0;
    let arrowCount = 0;
    let rebuildCount = 0;
    
    // Create set of valid endpoint IDs from data for efficient lookup
    const validEndpointIds = new Set(data.nodes.map(node => node.id));
    
    const traverseTimestamp = new Date().toISOString();
    console.log(`🔧 [${traverseTimestamp}] DEBUG: Combined traverse - rebuilding userData AND highlighting`);
    console.log(`🔧 [${traverseTimestamp}] Valid endpoint IDs:`, Array.from(validEndpointIds).slice(0, 10), '... (total:', validEndpointIds.size, ')');
    console.log(`🔧 [${traverseTimestamp}] Sample node IDs from data:`, data.nodes.slice(0, 5).map(n => ({ id: n.id, label: n.label, service: n.service })));
    
    let totalCylinders = 0;
    let cylindersWithNodeId = 0;
    let cylindersInValidIds = 0;
    
    scene.traverse((object) => {
      // Count and handle only cylinders that correspond to actual endpoints
      if (object instanceof THREE.Mesh && 
          object.geometry instanceof THREE.CylinderGeometry) {
        
        totalCylinders++;
        
        // Check if this object has a nodeId that matches our endpoint data
        const nodeId = object.userData?.nodeId;
        const hasNodeId = !!nodeId;
        const isValidEndpoint = nodeId && validEndpointIds.has(nodeId);
        
        if (hasNodeId) cylindersWithNodeId++;
        if (isValidEndpoint) cylindersInValidIds++;
        
        // Debug first few cylinders to see nodeId matching
        if (totalCylinders <= 5) {
          console.log(`🔍 Cylinder #${totalCylinders} analysis:`, { 
            nodeId, 
            hasNodeId,
            isValidEndpoint,
            userData: Object.keys(object.userData || {}),
            position: { x: object.position.x, y: object.position.y, z: object.position.z }
          });
        }
        
        if (isValidEndpoint) {
          cylinderCount++;
        }
      }
      
      if (object instanceof THREE.Line || (object instanceof THREE.Mesh && object.userData?.isArrowHead)) {
        arrowCount++;
      }
      
      // Handle ONLY cylinders that correspond to actual endpoints
      if (object instanceof THREE.Mesh && 
          object.geometry instanceof THREE.CylinderGeometry &&
          object.userData?.nodeId &&
          validEndpointIds.has(object.userData.nodeId)) {
        rebuildCount++;
        
        // Track specific endpoint during highlight
        const isTrackedEndpoint = object.userData?.nodeId === 'gateway-metrics_route_request';
        
        if (isTrackedEndpoint) {
          console.log('🎯 TRACKED ENDPOINT - Found during highlight:', {
            nodeId: object.userData?.nodeId,
            selectedTraceId,
            fullUserData: JSON.stringify(object.userData),
            position: { x: object.position.x, y: object.position.y, z: object.position.z }
          });
        }
        
        // Note: At this point we already filtered by validEndpointIds, so object should have valid nodeId
        
        const material = object.material as THREE.MeshBasicMaterial;
        const nodeId = object.userData?.nodeId;
        
        // Debug first few cylinders found during traverse
        if (cylinderCount < 2) {
          console.log('🔍 Found cylinder during traverse:', {
            objectType: object.type,
            nodeId,
            actualNodeId: object.userData?.nodeId,
            nodeIdIsUndefined: object.userData?.nodeId === undefined,
            hasUserData: !!object.userData,
            isEndpoint: object.userData?.isEndpoint,
            userDataKeys: object.userData ? Object.keys(object.userData) : [],
            userDataStringified: JSON.stringify(object.userData),
            position: { x: object.position.x, y: object.position.y, z: object.position.z }
          });
          
          // Test userData assignment on this object
          console.log('🧪 Testing userData assignment on this object...');
          const originalUserData = { ...object.userData };
          object.userData.testField = 'test-value-123';
          console.log('After test assignment:', {
            testField: object.userData?.testField,
            userDataKeys: Object.keys(object.userData),
            userDataStringified: JSON.stringify(object.userData)
          });
          
          // CRITICAL FIX: Restore original userData correctly without losing nodeId
          delete object.userData.testField;  // Just remove the test field instead of overwriting entire userData
        }
        
        if (selectedTraceId) {
          // Debug: Log that we're processing a cylinder for highlighting
          if (rebuildCount <= 5) {
            console.log(`🎯 Processing cylinder #${rebuildCount} for highlighting:`, {
              nodeId,
              rebuildCount,
              selectedTraceId,
              hasNodeId: !!nodeId,
              isInValidIds: validEndpointIds.has(nodeId)
            });
          }
          
          // CRITICAL FIX: Skip highlighting for cylinders without nodeId
          if (!nodeId) {
            // Only dim cylinders without nodeId when a trace is selected
            if (selectedTraceId) {
              if (!object.userData.originalColor) {
                object.userData.originalColor = material.color.getHex();
              }
              material.color.setHex(0x666666);
              material.transparent = true;
              material.opacity = 0.3;
              material.needsUpdate = true;
            }
            
            if (cylinderCount < 3) {
              console.log('🔍 Dimming cylinder without nodeId:', { 
                nodeId, 
                selectedTraceId,
                hasNodeId: !!nodeId
              });
            }
            return; // Skip further processing
          }
          
          // FIXED: Use the pre-calculated requiredNodeIds set
          const isRelatedToTrace = requiredNodeIds.has(nodeId);
          
          // Debug logging for trace-related nodes
          if (cylinderCount <= 5 || requiredNodeIds.has(nodeId)) {
            console.log(`🎯 NODE TRACE CHECK #${cylinderCount}:`, {
              nodeId,
              isRelatedToTrace,
              isInRequiredSet: requiredNodeIds.has(nodeId),
              selectedTraceId,
              requiredNodesCount: requiredNodeIds.size,
              allRequiredNodes: Array.from(requiredNodeIds)
            });
          }
          
          // originalColor should already be set from creation, never overwrite it here
          if (!object.userData.originalColor) {
            console.error('⚠️ CRITICAL: originalColor missing on cylinder!', {
              nodeId,
              currentColor: material.color.getHex(),
              userData: object.userData
            });
          }
          
          // Enhanced logging for trace highlighting
          if (selectedTraceId && cylinderCount <= 5) {
            console.log(`🎨 CYLINDER COLOR PROCESSING #${cylinderCount}:`, {
              nodeId,
              isRelatedToTrace,
              selectedTraceId,
              currentColorBefore: material.color.getHex(),
              originalColor: object.userData.originalColor,
              materialColor: material.color.getHex()
            });
          }
          
          if (isRelatedToTrace) {
            // Keep original color but ensure it's bright and vivid
            const originalColor = object.userData.originalColor || 0xFFFFFF;
            const highlightMaterial = new THREE.MeshBasicMaterial({
              color: originalColor, // Keep original color
              transparent: false,
              opacity: 1.0
            });
            object.material = highlightMaterial;
            
            // Always log trace-related highlighting - SPECIAL CASE: always log required nodes
            console.log('✅ HIGHLIGHTING cylinder:', { 
              nodeId, 
              originalColor: object.userData.originalColor,
              keptOriginalColor: originalColor,
              materialColorAfterSet: highlightMaterial.color.getHex(),
              cylinderCount,
              rebuildCount
            });
          } else {
            // Create new material for dimming to avoid cache interference
            const dimMaterial = new THREE.MeshBasicMaterial({
              color: 0x666666, // Gray color
              transparent: true,
              opacity: 0.3
            });
            object.material = dimMaterial;
            
            // Debug log for dimmed cylinders
            if (cylinderCount < 10) {
              console.log('⬜ DIMMING cylinder:', { 
                nodeId, 
                originalColor: object.userData.originalColor,
                newColorHex: 0x666666,
                opacity: material.opacity,
                transparent: material.transparent
              });
            }
          }
          
          // Force renderer to update materials immediately
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }
        } else {
          // Reset to original color when no trace is selected
          if (object.userData.originalColor) {
            material.color.setHex(object.userData.originalColor);
          }
          material.transparent = false;
          material.opacity = 1.0;
          material.needsUpdate = true;
        }
      }
      
      // Handle service labels (sprites)
      if (object instanceof THREE.Sprite && object.userData?.isServiceLabel) {
        const material = object.material as THREE.SpriteMaterial;
        const serviceName = object.userData.serviceName;
        
        if (selectedTraceId) {
          // Check if this service is related to the selected trace
          const isRelatedToTrace = data.edges.some(edge => {
            if (!edge.traceId) return false;
            const traceIds = edge.traceId.split(',').map(id => id.trim());
            const isTraceMatch = traceIds.includes(selectedTraceId);
            // Check if either source or target contains this service name
            const isServiceMatch = edge.source.includes(serviceName) || edge.target.includes(serviceName);
            return isTraceMatch && isServiceMatch;
          });
          
          // Store original opacity if not stored
          if (object.userData.originalOpacity === undefined) {
            object.userData.originalOpacity = material.opacity;
          }
          
          if (isRelatedToTrace) {
            // Keep original opacity for highlighted service labels
            material.opacity = object.userData.originalOpacity || 1.0;
            material.transparent = material.opacity < 1.0;
          } else {
            // Dim non-highlighted service labels
            material.opacity = 0.2;
            material.transparent = true;
          }
          material.needsUpdate = true;
        } else {
          // Reset to original opacity when no trace is selected
          if (object.userData.originalOpacity !== undefined) {
            material.opacity = object.userData.originalOpacity;
            material.transparent = material.opacity < 1.0;
          } else {
            material.opacity = 1.0;
            material.transparent = false;
          }
          material.needsUpdate = true;
        }
      }
      
      // Handle endpoint labels (sprites without isServiceLabel)
      if (object instanceof THREE.Sprite && !object.userData?.isServiceLabel && object.userData?.isEndpointLabel) {
        const material = object.material as THREE.SpriteMaterial;
        
        if (selectedTraceId) {
          // For endpoint labels, check if any related edge is highlighted
          // Get the key for this label to find associated node
          const labelKeys = Array.from(sceneObjectsRef.current.keys());
          const thisLabelKey = labelKeys.find(key => sceneObjectsRef.current.get(key) === object);
          
          if (thisLabelKey) {
            // Extract endpoint ID from label key (format: "endpoint-label-{endpoint.id}")
            const endpointId = thisLabelKey.replace('endpoint-label-', '');
            
            // Check if this endpoint is related to the selected trace
            const isRelatedToTrace = data.edges.some(edge => {
              if (!edge.traceId) return false;
              const traceIds = edge.traceId.split(',').map(id => id.trim());
              const isTraceMatch = traceIds.includes(selectedTraceId);
              // Check if either source or target matches this endpoint
              const isEndpointMatch = edge.source === endpointId || edge.target === endpointId;
              return isTraceMatch && isEndpointMatch;
            });
            
            // Debug logging for first few endpoint labels
            if (!object.userData.debugged) {
              console.log('🔍 Endpoint label highlight:', {
                thisLabelKey,
                endpointId,
                isRelatedToTrace,
                selectedTraceId,
                matchingEdges: data.edges.filter(e => e.traceId && e.traceId.includes(selectedTraceId) && (e.source === endpointId || e.target === endpointId)),
                allRelevantEdges: data.edges.filter(e => e.source === endpointId || e.target === endpointId).slice(0, 3),
                objectUserData: object.userData
              });
              object.userData.debugged = true;
            }
            
            // Store original opacity if not stored
            if (object.userData.originalOpacity === undefined) {
              object.userData.originalOpacity = material.opacity;
            }
            
            if (isRelatedToTrace) {
              // Keep original opacity for highlighted endpoint labels
              material.opacity = object.userData.originalOpacity || 1.0;
              material.transparent = material.opacity < 1.0;
            } else {
              // Dim non-highlighted endpoint labels
              material.opacity = 0.2;
              material.transparent = true;
            }
            material.needsUpdate = true;
          }
        } else {
          // Reset to original opacity when no trace is selected
          if (object.userData.originalOpacity !== undefined) {
            material.opacity = object.userData.originalOpacity;
            material.transparent = material.opacity < 1.0;
          } else {
            material.opacity = 1.0;
            material.transparent = false;
          }
          material.needsUpdate = true;
        }
      }
      
      // Handle arrows (edges)
      if (object instanceof THREE.Line && object.userData?.isArrow) {
        const material = object.material as THREE.LineBasicMaterial;
        const edgeData = object.userData.edgeData;
        
        if (selectedTraceId && edgeData?.traceId) {
          const traceIds = edgeData.traceId.split(',').map((id: string) => id.trim());
          const isRelatedToTrace = traceIds.includes(selectedTraceId);
          
          // Store original color if not stored
          if (!object.userData.originalColor) {
            object.userData.originalColor = material.color.getHex();
          }
          
          if (isRelatedToTrace) {
            material.color.setHex(object.userData.originalColor);
            material.transparent = false;
            material.opacity = 1.0;
          } else {
            material.color.setHex(0x888888);
            material.transparent = true;
            material.opacity = 0.2;
          }
          material.needsUpdate = true;
        } else {
          if (object.userData.originalColor) {
            material.color.setHex(object.userData.originalColor);
          }
          material.transparent = false;
          material.opacity = 1.0;
          material.needsUpdate = true;
        }
      }
      
      // Handle arrow heads
      if (object instanceof THREE.Mesh && object.userData?.isArrowHead) {
        const material = object.material as THREE.MeshBasicMaterial;
        const edgeData = object.userData.edgeData;
        
        if (selectedTraceId && edgeData?.traceId) {
          const traceIds = edgeData.traceId.split(',').map((id: string) => id.trim());
          const isRelatedToTrace = traceIds.includes(selectedTraceId);
          
          // Store original color if not stored
          if (!object.userData.originalColor) {
            object.userData.originalColor = material.color.getHex();
          }
          
          if (isRelatedToTrace) {
            material.color.setHex(object.userData.originalColor);
            material.transparent = false;
            material.opacity = 1.0;
          } else {
            material.color.setHex(0x888888);
            material.transparent = true;
            material.opacity = 0.2;
          }
          material.needsUpdate = true;
        } else {
          if (object.userData.originalColor) {
            material.color.setHex(object.userData.originalColor);
          }
          material.transparent = false;
          material.opacity = 1.0;
          material.needsUpdate = true;
        }
      }
    });
    
    if (selectedTraceId) {
      console.log('🔥 Traverse complete summary:', {
        selectedTraceId,
        totalCylinders,
        cylindersWithNodeId,
        cylindersInValidIds,
        cylinderCount: cylinderCount + ' (processed)',
        arrowCount,
        rebuildCount: rebuildCount + ' (with valid nodeId)',
        requiredNodes: Array.from(requiredNodeIds),
        matchingEdges: matchingTraceEdges.length
      });
    }
  }, [selectedTraceId, data]);

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-2">No data to display</p>
          <p className="text-sm text-muted-foreground">Upload files to generate 3D cylinder visualization</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      <div ref={mountRef} className="w-full h-full" />
      
      {/* Toggle button for legend */}
      <button
        onClick={() => setShowLegend(!showLegend)}
        className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-2 shadow-lg hover:bg-white/95 transition-colors"
        title={showLegend ? "Hide legend" : "Show legend"}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {/* Legend panel */}
      {showLegend && (
        <div className="absolute top-4 left-16 bg-white/90 backdrop-blur-sm rounded-lg p-4 shadow-lg max-w-64">
          <h3 className="font-semibold text-sm mb-3 flex items-center">
            <div className="w-2 h-2 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full mr-2"></div>
            3D Network Legend
          </h3>
          
          {/* Controls Section */}
          <div className="space-y-2 text-xs mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200/50">
            <div className="font-medium text-gray-700">Controls:</div>
            <div>• <strong>Drag</strong> to rotate view</div>
            <div>• <strong>Shift + Drag</strong> to pan (move)</div>
            <div>• <strong>Scroll</strong> to zoom in/out</div>
            <div>• <strong>Click orientation cube</strong> for standard views</div>
          </div>
          
          {/* Visual Elements Section */}
          <div className="space-y-3 text-xs mb-4">
            <div className="font-medium text-gray-700 mb-2">Visual Elements:</div>
            <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200/50">
              <div className="w-3 h-3 rounded bg-gradient-to-b from-blue-500 to-red-500"></div>
              <span>Service cylinders</span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200/50">
              <div className="w-3 h-3 rounded-full bg-purple-600"></div>
              <span>Standalone nodes</span>
            </div>
          </div>
          
          {/* Traffic Flow Section */}
          <div className="space-y-3 text-xs mb-4">
            <div className="font-medium text-gray-700 mb-2">Traffic Flow:</div>
            <div className="flex items-center gap-2 p-2 bg-slate-50 rounded border border-slate-200/50">
              <div className="w-8 h-px bg-gradient-to-r from-slate-400 to-slate-600 relative">
                <div className="absolute right-0 top-0 w-0 h-0 border-l-4 border-l-slate-600 border-t-2 border-b-2 border-t-transparent border-b-transparent transform -translate-y-1/2"></div>
              </div>
              <span>Unidirectional flow</span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-red-50 rounded border border-red-200/50">
              <div className="w-8 h-px bg-gradient-to-r from-red-400 to-red-600 relative">
                <div className="absolute right-0 top-0 w-0 h-0 border-l-4 border-l-red-600 border-t-2 border-b-2 border-t-transparent border-b-transparent transform -translate-y-1/2"></div>
              </div>
              <span>Bidirectional flow</span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200/50">
              <div className="flex space-x-1">
                <div className="w-1 h-1 bg-purple-400 rounded-full"></div>
                <div className="w-1 h-1 bg-purple-500 rounded-full"></div>
                <div className="w-1 h-1 bg-purple-600 rounded-full"></div>
              </div>
              <span>Connection strength</span>
            </div>
          </div>
          
          {/* Traffic Types Section */}
          <div className="space-y-3 text-xs">
            <div className="font-medium text-gray-700 mb-2">Traffic Types:</div>
            <div className="flex items-center gap-2 p-2 bg-red-50 rounded border border-red-200/50">
              <div className="w-6 h-0.5 bg-red-600"></div>
              <span>Inter-service</span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-200/50">
              <div className="w-6 h-0.5 bg-green-600"></div>
              <span>Intra-service</span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200/50">
              <div className="w-6 h-0.5 bg-purple-600"></div>
              <span>External traffic</span>
            </div>
          </div>

          {/* Scalability Section */}
          <div className="space-y-2 text-xs mt-4">
            <div className="font-medium text-gray-700 mb-2">Scalability Features:</div>
            <div className="grid grid-cols-1 gap-1">
              <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200/50">
                <div className="w-3 h-3 rounded bg-gradient-to-r from-blue-400 to-blue-600"></div>
                <span>Adaptive LOD system</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-green-50 rounded border border-green-200/50">
                <div className="w-3 h-3 rounded bg-gradient-to-r from-green-400 to-green-600"></div>
                <span>Dynamic detail levels</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-purple-50 rounded border border-purple-200/50">
                <div className="w-3 h-3 rounded bg-gradient-to-r from-purple-400 to-purple-600"></div>
                <span>100+ service support</span>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Status tooltip */}
      {tooltip.visible && (
        <div 
          className="absolute z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-3 pointer-events-none"
          style={{
            left: `${tooltip.x + 15}px`,
            top: `${tooltip.y - 15}px`
          }}
        >
          <div className="text-sm font-semibold mb-2">
            {tooltip.sourceLabel} → {tooltip.targetLabel}
          </div>
          <div className="space-y-1">
            {Object.entries(tooltip.statusCounts).length > 0 ? (
              Object.entries(tooltip.statusCounts)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([status, count]) => (
                  <div key={status} className="flex justify-between items-center text-xs">
                    <span className="font-mono">{status}:</span>
                    <span className="ml-4 font-semibold">{count}</span>
                  </div>
                ))
            ) : (
              <div className="text-xs text-gray-500">No status data</div>
            )}
          </div>
        </div>
      )}

      {/* Service Metrics Popup */}
      {metricsPopup.visible && (
        <ServiceMetricsPopup
          serviceName={metricsPopup.serviceName}
          metrics={metricsPopup.metrics}
          onClose={() => setMetricsPopup(prev => ({ ...prev, visible: false }))}
          position={metricsPopup.position}
        />
      )}
    </div>
  );
}