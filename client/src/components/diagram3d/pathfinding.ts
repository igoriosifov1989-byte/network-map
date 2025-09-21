import * as THREE from "three";
import type { Obstacle } from "./types";

export function calculateObstavoidingPath(
  startPos: THREE.Vector3,
  endPos: THREE.Vector3,
  obstacles: Obstacle[],
  cylinderRadius: number
): THREE.Vector3[] {
  // Direct path check
  const directPath = [startPos.clone(), endPos.clone()];
  
  // Check if direct path intersects any obstacles
  let needsDetour = false;
  let blockingObstacles: Obstacle[] = [];
  
  for (const obstacle of obstacles) {
    const distance = distanceFromPointToLine(obstacle.position, startPos, endPos);
    const safeDistance = obstacle.radius + cylinderRadius + 10; // Small safety margin
    
    // Additional check: ensure the obstacle is actually between start and end points
    const lineDirection = new THREE.Vector3().subVectors(endPos, startPos);
    const toObstacle = new THREE.Vector3().subVectors(obstacle.position, startPos);
    const projection = toObstacle.dot(lineDirection) / lineDirection.lengthSq();
    
    // Only consider obstacles that are roughly between start and end (0.1 to 0.9 of the path)
    if (distance < safeDistance && projection > 0.1 && projection < 0.9) {
      needsDetour = true;
      blockingObstacles.push(obstacle);
    }
  }
  
  if (!needsDetour) {
    console.log('✅ Direct path clear for magistral');
    return directPath;
  }
  
  console.log(`🚧 ${blockingObstacles.length} obstacles blocking direct path, calculating detour`);
  
  // Calculate detour paths using only blocking obstacles
  const leftDetour = calculateDetourPath(startPos, endPos, blockingObstacles, true, cylinderRadius);
  const rightDetour = calculateDetourPath(startPos, endPos, blockingObstacles, false, cylinderRadius);
  
  // Choose shorter path
  const leftLength = calculatePathLength(leftDetour);
  const rightLength = calculatePathLength(rightDetour);
  
  return leftLength <= rightLength ? leftDetour : rightDetour;
}

export function calculateDetourPath(
  startPos: THREE.Vector3,
  endPos: THREE.Vector3,
  obstacles: Obstacle[],
  isLeft: boolean,
  cylinderRadius: number
): THREE.Vector3[] {
  const direction = new THREE.Vector3().subVectors(endPos, startPos).normalize();
  const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x); // Perpendicular in XZ plane
  
  if (!isLeft) {
    perpendicular.multiplyScalar(-1);
  }
  
  // Calculate detour waypoints around obstacles
  const waypoints = [startPos.clone()];
  const baseOffset = 150; // Base detour distance
  
  for (const obstacle of obstacles) {
    const toObstacle = new THREE.Vector3().subVectors(obstacle.position, startPos);
    const distanceToLine = distanceFromPointToLine(obstacle.position, startPos, endPos);
    
    if (distanceToLine < obstacle.radius + cylinderRadius + 50) {
      const offset = perpendicular.clone().multiplyScalar(obstacle.radius + baseOffset);
      const detourPoint = obstacle.position.clone().add(offset);
      waypoints.push(detourPoint);
    }
  }
  
  waypoints.push(endPos.clone());
  return waypoints;
}

export function calculatePathLength(path: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += path[i].distanceTo(path[i - 1]);
  }
  return length;
}

export function getLineIntersection2D(
  line1Start: { x: number; z: number },
  line1End: { x: number; z: number },
  line2Start: { x: number; z: number },
  line2End: { x: number; z: number }
): { x: number; z: number } | null {
  const denom = (line1Start.x - line1End.x) * (line2Start.z - line2End.z) - (line1Start.z - line1End.z) * (line2Start.x - line2End.x);
  if (Math.abs(denom) < 1e-10) return null;
  
  const t = ((line1Start.x - line2Start.x) * (line2Start.z - line2End.z) - (line1Start.z - line2Start.z) * (line2Start.x - line2End.x)) / denom;
  const u = -((line1Start.x - line1End.x) * (line1Start.z - line2Start.z) - (line1Start.z - line1End.z) * (line1Start.x - line2Start.x)) / denom;
  
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: line1Start.x + t * (line1End.x - line1Start.x),
      z: line1Start.z + t * (line1End.z - line1Start.z)
    };
  }
  return null;
}

export function getHighwayPriority(tenantPair: string): number {
  if (tenantPair.startsWith('api-gateway->')) return 1000;
  if (tenantPair.includes('user-management')) return 500;
  if (tenantPair.includes('payment-system')) return 400;
  return 100;
}

function distanceFromPointToLine(point: THREE.Vector3, lineStart: THREE.Vector3, lineEnd: THREE.Vector3): number {
  const lineVec = new THREE.Vector3().subVectors(lineEnd, lineStart);
  const pointVec = new THREE.Vector3().subVectors(point, lineStart);
  const lineLength = lineVec.length();
  
  if (lineLength === 0) return point.distanceTo(lineStart);
  
  const t = Math.max(0, Math.min(1, pointVec.dot(lineVec) / (lineLength * lineLength)));
  const projection = lineStart.clone().add(lineVec.multiplyScalar(t));
  return point.distanceTo(projection);
}

// Helper function to detect highway intersections and create bridge/tunnel system
export function detectHighwayIntersections(
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