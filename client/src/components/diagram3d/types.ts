import * as THREE from "three";

export interface MagistralConnection {
  sourceTenant: string;
  targetTenant: string;
  edges: any[];
  connectionCount: number;
  statusCodes: Record<string, number>;
}

export interface ParsedFileData {
  nodes: any[];
  edges: any[];
}

export interface Diagram3DProps {
  data: any | null;
  settings: any;
  onApplyLayout?: () => void;
  selectedTraceId?: string | null;
  onLODUpdate?: (lodLevel: 'high' | 'medium' | 'low', relativeDistance: number, serviceCount: number) => void;
}

export interface CameraState {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  target?: THREE.Vector3;
}

export interface Obstacle {
  position: THREE.Vector3;
  radius: number;
}