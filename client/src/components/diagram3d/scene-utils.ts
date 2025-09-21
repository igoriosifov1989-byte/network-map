import * as THREE from "three";
import type { DiagramData } from "@/types/diagram";

export function updateSceneIncrementally(
  scene: THREE.Scene,
  prevData: DiagramData,
  newData: DiagramData,
  sceneObjects: Map<string, THREE.Object3D>
) {
  console.log('updateSceneIncrementally called', { 
    prevEdges: prevData.edges.length, 
    newEdges: newData.edges.length,
    cachedObjects: sceneObjects.size 
  });
  
  const currentObjects = new Set<string>();
  
  // Check for new or updated nodes (cylinders)
  newData.nodes.forEach(node => {
    const nodeKey = `segment-${node.id}`;
    const labelKey = `label-${node.id}`;
    currentObjects.add(nodeKey);
    currentObjects.add(labelKey);
    
    const prevNode = prevData.nodes.find(n => n.id === node.id);
    if (prevNode && node.id === prevNode.id && 
        node.label === prevNode.label && 
        node.service === prevNode.service) {
      return;
    }
    
    if (!prevNode || node.id !== prevNode.id || node.service !== prevNode.service) {
      [nodeKey, labelKey].forEach(key => {
        const obj = sceneObjects.get(key);
        if (obj) {
          scene.remove(obj);
          sceneObjects.delete(key);
        }
      });
    }
  });
  
  // Check for new or updated edges (arrows)
  newData.edges.forEach(edge => {
    const arrowKey = `arrow-${edge.id}`;
    currentObjects.add(arrowKey);
    
    const prevEdge = prevData.edges.find(e => e.id === edge.id);
    const hasChanged = !prevEdge || 
        prevEdge.connectionCount !== edge.connectionCount ||
        JSON.stringify(prevEdge.statusCounts || {}) !== JSON.stringify(edge.statusCounts || {});
    
    if (hasChanged) {
      console.log(`Edge changed, removing: ${arrowKey}`, { 
        prevCount: prevEdge?.connectionCount, 
        newCount: edge.connectionCount 
      });
      const obj = sceneObjects.get(arrowKey);
      if (obj) {
        scene.remove(obj);
        sceneObjects.delete(arrowKey);
      }
    } else {
      console.log(`Edge unchanged, keeping: ${arrowKey}`);
    }
  });
  
  // Remove objects that are no longer needed
  sceneObjects.forEach((object, key) => {
    if (!currentObjects.has(key)) {
      scene.remove(object);
      sceneObjects.delete(key);
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach(mat => mat.dispose());
        } else {
          object.material.dispose();
        }
      }
    }
  });
  
  console.log(`Scene cleanup: ${sceneObjects.size} objects remaining`);
}

export function createOrientationCube() {
  const cubeGroup = new THREE.Group();
  const cubeSize = 80;
  const faceLabels = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  const faceColors = [0xff4444, 0x884444, 0x44ff44, 0x448844, 0x4444ff, 0x444488];
  
  const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const materials = faceLabels.map((label, index) => {
    return new THREE.MeshBasicMaterial({ 
      color: faceColors[index],
      transparent: true,
      opacity: 0.8
    });
  });
  
  const cube = new THREE.Mesh(cubeGeometry, materials);
  
  // Keep cube at origin without rotation - labels adjusted to match model axes
  cube.rotation.set(0, 0, 0);
  
  cubeGroup.add(cube);
  
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

export function createArrowSystem(
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
  
  // Simple direct path for now (can be enhanced later)
  const path = [sourcePoint.clone(), targetPoint.clone()];
  
  // Apply separation offset to middle points
  const offsetPath = path.map((point, index) => {
    if (index === 0 || index === path.length - 1) {
      return point.clone(); // Keep endpoints on cylinder surface
    } else {
      return new THREE.Vector3(point.x, point.y + separationOffset, point.z);
    }
  });
  
  // Create line connection
  if (offsetPath.length >= 2) {
    const lineThickness = calculateLineThickness(edge.connectionCount || 1);
    
    // Create simple line geometry
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(offsetPath);
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color, 
      linewidth: lineThickness 
    });
    const lineMesh = new THREE.Line(lineGeometry, lineMaterial);
    
    arrowGroup.add(lineMesh);
    
    // Add simple arrow head at target
    const direction = new THREE.Vector3().subVectors(offsetPath[offsetPath.length - 1], offsetPath[offsetPath.length - 2]).normalize();
    
    // Create cone for arrow head
    const arrowGeometry = new THREE.ConeGeometry(8, 20, 6);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color });
    const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
    
    arrowMesh.position.copy(offsetPath[offsetPath.length - 1]);
    arrowMesh.lookAt(offsetPath[offsetPath.length - 1].clone().add(direction));
    arrowMesh.rotateX(Math.PI / 2);
    
    arrowGroup.add(arrowMesh);
  }
  
  // Store metadata
  arrowGroup.userData = {
    isArrow: true,
    edgeId: edge.id,
    sourceNode: sourceNode?.id,
    targetNode: targetNode?.id,
    connectionCount: edge.connectionCount,
    traceIds: edge.traceIds || []
  };
  
  return arrowGroup;
}

export function getCachedMaterial(
  color: number, 
  type: 'basic' | 'line' = 'basic',
  materialsCache: Map<string, THREE.Material>
): THREE.Material {
  const key = `${type}-${color.toString(16)}`;
  
  if (materialsCache.has(key)) {
    return materialsCache.get(key)!;
  }
  
  let material: THREE.Material;
  if (type === 'line') {
    material = new THREE.LineBasicMaterial({ color });
  } else {
    material = new THREE.MeshBasicMaterial({ color });
  }
  
  materialsCache.set(key, material);
  return material;
}