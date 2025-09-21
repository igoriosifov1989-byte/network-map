import * as THREE from "three";
import type { MagistralConnection, ParsedFileData, Obstacle } from "./types";
import { calculateObstavoidingPath } from "./pathfinding";

export function aggregateInterTenantConnections(data: ParsedFileData): Map<string, MagistralConnection> {
  const magistrals = new Map<string, MagistralConnection>();
  
  console.error(`🚨 🌉 DEBUG: Starting magistral aggregation with ${data.edges.length} edges`);
  console.log(`🌉 DEBUG: Starting magistral aggregation with ${data.edges.length} edges`);
  
  let interTenantCount = 0;
  let intraTenantCount = 0;
  let invalidCount = 0;
  
  data.edges.forEach((edge, index) => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    const sourceNode = data.nodes.find(n => n.id === sourceId);
    const targetNode = data.nodes.find(n => n.id === targetId);
    
    if (!sourceNode || !targetNode || !sourceNode.tenant || !targetNode.tenant) {
      invalidCount++;
      if (index < 5) { // Log first 5 invalid edges for debugging
        console.log(`🌉 DEBUG: Invalid edge ${index}: ${sourceId} → ${targetId}, sourceNode: ${!!sourceNode}, targetNode: ${!!targetNode}, sourceTenant: ${sourceNode?.tenant}, targetTenant: ${targetNode?.tenant}`);
      }
      return;
    }
    
    if (sourceNode.tenant === targetNode.tenant) {
      intraTenantCount++;
      return; // Skip intra-tenant
    }
    
    interTenantCount++;
    const magistralKey = `${sourceNode.tenant}->${targetNode.tenant}`;
    
    if (index < 5) { // Log first 5 inter-tenant connections for debugging
      console.log(`🌉 DEBUG: Inter-tenant edge ${index}: ${sourceNode.tenant} → ${targetNode.tenant} (${sourceId} → ${targetId})`);
    }
    
    if (!magistrals.has(magistralKey)) {
      magistrals.set(magistralKey, {
        sourceTenant: sourceNode.tenant,
        targetTenant: targetNode.tenant,
        edges: [],
        connectionCount: 0,
        statusCodes: {}
      });
      console.log(`🌉 DEBUG: Created new magistral: ${magistralKey}`);
    }
    
    const magistral = magistrals.get(magistralKey)!;
    magistral.edges.push(edge);
    magistral.connectionCount += edge.connectionCount || 1;
    
    // Aggregate status codes
    if (edge.statusCounts) {
      Object.entries(edge.statusCounts).forEach(([status, count]) => {
        magistral.statusCodes[status] = (magistral.statusCodes[status] || 0) + (count as number);
      });
    }
  });
  
  console.error(`🚨 🌉 DEBUG: Magistral aggregation complete - Inter-tenant: ${interTenantCount}, Intra-tenant: ${intraTenantCount}, Invalid: ${invalidCount}, Magistrals created: ${magistrals.size}`);
  console.log(`🌉 DEBUG: Magistral aggregation complete - Inter-tenant: ${interTenantCount}, Intra-tenant: ${intraTenantCount}, Invalid: ${invalidCount}, Magistrals created: ${magistrals.size}`);
  
  if (magistrals.size > 0) {
    console.error(`🚨 🌉 DEBUG: Magistral summary:`);
    console.log(`🌉 DEBUG: Magistral summary:`);
    magistrals.forEach((magistral, key) => {
      console.log(`   ${key}: ${magistral.connectionCount} connections, ${magistral.edges.length} edges`);
    });
  }
  
  return magistrals;
}

export function createMagistralPath(
  sourceEndpoint: THREE.Vector3,
  targetEndpoint: THREE.Vector3,
  obstacles: Obstacle[],
  offsetVector?: THREE.Vector3,
  sourceTenant?: string,
  targetTenant?: string,
  sourceCenter?: THREE.Vector3,
  targetCenter?: THREE.Vector3
): THREE.Vector3[] {
  console.error(`🚨 MAGISTRAL PATH FUNCTION CALLED: ${sourceTenant || 'unknown'} → ${targetTenant || 'unknown'}`);
  console.log(`🚨 MAGISTRAL PATH FUNCTION CALLED: ${sourceTenant || 'unknown'} → ${targetTenant || 'unknown'}`);
  // Use the already calculated sphere boundary endpoints directly
  // Do NOT apply offset to boundary points as it would move them away from sphere surface
  let adjustedSource = sourceEndpoint.clone();
  let adjustedTarget = targetEndpoint.clone();
  
  // Filter out source and target tenants from obstacles to allow direct connections  
  const filteredObstacles = obstacles.filter(obstacle => {
    // Use centers if provided, otherwise use endpoints for distance calculation
    const sourcePos = sourceCenter || adjustedSource;
    const targetPos = targetCenter || adjustedTarget;
    const distToSource = obstacle.position.distanceTo(sourcePos);
    const distToTarget = obstacle.position.distanceTo(targetPos);
    // Remove obstacles that are too close to source or target (same tenant)
    return distToSource > 50 && distToTarget > 50;
  });
  
  console.log(`🛣️ MAGISTRAL PATH DEBUG for ${sourceTenant} → ${targetTenant}:`);
  console.log(`   🎯 SPHERE BOUNDARY ENDPOINTS (должны быть на границе сфер):`);
  console.log(`   Source endpoint: (${adjustedSource.x.toFixed(1)}, ${adjustedSource.y.toFixed(1)}, ${adjustedSource.z.toFixed(1)})`);
  console.log(`   Target endpoint: (${adjustedTarget.x.toFixed(1)}, ${adjustedTarget.y.toFixed(1)}, ${adjustedTarget.z.toFixed(1)})`);
  console.log(`   Distance between endpoints: ${adjustedSource.distanceTo(adjustedTarget).toFixed(1)}`);
  console.log(`   Filtered obstacles: ${filteredObstacles.length} (total: ${obstacles.length})`);
  
  const resultPath = calculateObstavoidingPath(adjustedSource, adjustedTarget, filteredObstacles, 15);
  
  // Apply offset to the entire path if provided
  if (offsetVector && offsetVector.length() > 0) {
    console.log(`   🔄 Applying offset to magistral path: (${offsetVector.x.toFixed(1)}, ${offsetVector.y.toFixed(1)}, ${offsetVector.z.toFixed(1)})`);
    resultPath.forEach(point => {
      point.add(offsetVector);
    });
  }
  
  console.log(`   🛣️ FINAL MAGISTRAL PATH POINTS:`);
  console.log(`   Result path length: ${resultPath.length} points`);
  if (resultPath.length > 0) {
    console.log(`   ✅ MAGISTRAL ACTUAL START: (${resultPath[0].x.toFixed(1)}, ${resultPath[0].y.toFixed(1)}, ${resultPath[0].z.toFixed(1)}) [должен быть на границе источника]`);
    console.log(`   ✅ MAGISTRAL ACTUAL END: (${resultPath[resultPath.length-1].x.toFixed(1)}, ${resultPath[resultPath.length-1].y.toFixed(1)}, ${resultPath[resultPath.length-1].z.toFixed(1)}) [должен быть на границе цели]`);
    
    // Проверяем соответствие
    const startMatches = resultPath[0].distanceTo(adjustedSource) < 1.0;
    const endMatches = resultPath[resultPath.length-1].distanceTo(adjustedTarget) < 1.0;
    console.error(`   🔍 VERIFICATION: Start точка совпадает с расчетной? ${startMatches ? '✅ ДА' : '❌ НЕТ'} (разница: ${resultPath[0].distanceTo(adjustedSource).toFixed(1)}px)`);
    console.error(`   🔍 VERIFICATION: End точка совпадает с расчетной? ${endMatches ? '✅ ДА' : '❌ НЕТ'} (разница: ${resultPath[resultPath.length-1].distanceTo(adjustedTarget).toFixed(1)}px)`);
    
    if (!startMatches || !endMatches) {
      console.error(`   ⚠️ ПРОБЛЕМА: Pathfinding изменил endpoints магистрали!`);
      console.error(`   📏 РАСЧЕТНЫЕ ТОЧКИ: source(${adjustedSource.x.toFixed(1)}, ${adjustedSource.y.toFixed(1)}, ${adjustedSource.z.toFixed(1)}) target(${adjustedTarget.x.toFixed(1)}, ${adjustedTarget.y.toFixed(1)}, ${adjustedTarget.z.toFixed(1)})`);
      console.error(`   📏 PATHFINDING ТОЧКИ: start(${resultPath[0].x.toFixed(1)}, ${resultPath[0].y.toFixed(1)}, ${resultPath[0].z.toFixed(1)}) end(${resultPath[resultPath.length-1].x.toFixed(1)}, ${resultPath[resultPath.length-1].y.toFixed(1)}, ${resultPath[resultPath.length-1].z.toFixed(1)})`);
    }
  }
  
  return resultPath;
}

export function calculateMagistralOffset(
  sourceCenter: THREE.Vector3,
  targetCenter: THREE.Vector3,
  existingMagistrals: Map<string, { source: THREE.Vector3; target: THREE.Vector3 }>
): THREE.Vector3 | null {
  const currentVector = new THREE.Vector3().subVectors(targetCenter, sourceCenter);
  const currentLength = currentVector.length();
  
  for (const [key, existing] of existingMagistrals) {
    const existingVector = new THREE.Vector3().subVectors(existing.target, existing.source);
    const existingLength = existingVector.length();
    
    const centerDistance = sourceCenter.distanceTo(existing.source);
    
    if (centerDistance < 100 && Math.abs(currentLength - existingLength) < 50) {
      const perpendicular = new THREE.Vector3(-currentVector.z, 0, currentVector.x).normalize();
      return perpendicular.multiplyScalar(50);
    }
  }
  
  return null;
}

export function getMagistralColor(magistral: MagistralConnection, isReverse: boolean = false): number {
  return isReverse ? 0x8B5CF6 : 0x10B981; // Purple : Green
}

export function calculateMagistralThickness(connectionCount: number, maxCount: number): number {
  // Uniform thickness for all magistrals regardless of connection count
  return 10; // Fixed thickness of 10 units for all magistrals
}

// Unified function to calculate magistral endpoints (touch points with tenant spheres)
export function calculateMagistralEndpoints(
  sourceCenter: THREE.Vector3,
  targetCenter: THREE.Vector3,
  sourceSphereRadius: number,
  targetSphereRadius: number
): { sourceEndpoint: THREE.Vector3; targetEndpoint: THREE.Vector3; direction: THREE.Vector3 } {
  const direction = new THREE.Vector3().subVectors(targetCenter, sourceCenter).normalize();
  
  const sourceEndpoint = sourceCenter.clone().add(direction.clone().multiplyScalar(sourceSphereRadius));
  const targetEndpoint = targetCenter.clone().sub(direction.clone().multiplyScalar(targetSphereRadius));
  
  return {
    sourceEndpoint,
    targetEndpoint,
    direction
  };
}

// Unified function to calculate tenant sphere radius consistently across all code
export function calculateTenantSphereRadius(serviceCount: number, serviceSpacing: number): number {
  // Use the same formula as in Diagram3D.tsx for consistency
  return Math.max(serviceSpacing * 1.2, serviceSpacing * 0.8 + (serviceCount * 15));
}

export function createDirectionalArrow(
  scene: THREE.Scene,
  position: THREE.Vector3,
  direction: THREE.Vector3,
  color: number,
  scale: number = 1,
  userData?: any
): THREE.Group {
  const arrowGroup = new THREE.Group();
  
  // Validate parameters and provide safe defaults
  const safeScale = isNaN(scale) || scale <= 0 ? 1 : scale;
  const safeRadius = 16 * safeScale;
  const safeHeight = 40 * safeScale;
  
  // Validate direction vector
  if (direction.length() === 0) {
    console.warn('createDirectionalArrow: Invalid direction vector', direction);
    direction.set(1, 0, 0); // Default direction
  }
  
  // Arrow cone with validated parameters
  const arrowGeometry = new THREE.ConeGeometry(safeRadius, safeHeight, 6);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color });
  const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
  
  arrowMesh.position.copy(position);
  arrowMesh.lookAt(position.clone().add(direction.clone().normalize()));
  arrowMesh.rotateX(Math.PI / 2);
  
  // Add userData if provided
  if (userData) {
    arrowGroup.userData = userData;
    arrowMesh.userData = { ...userData, isArrowHead: true };
  }
  
  arrowGroup.add(arrowMesh);
  
  scene.add(arrowGroup);
  
  return arrowGroup;
}