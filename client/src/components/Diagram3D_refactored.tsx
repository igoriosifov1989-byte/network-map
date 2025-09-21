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

interface Diagram3DProps {
  data: DiagramData | null;
  settings: DiagramSettings;
  onApplyLayout?: () => void;
  selectedTraceId?: string | null;
  onLODUpdate?: (lodLevel: 'high' | 'medium' | 'low', relativeDistance: number, serviceCount: number) => void;
}

export default function Diagram3D({ data, settings, selectedTraceId, onLODUpdate }: Diagram3DProps) {
  // State and refs
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

  // Placeholder content - will copy the rest from original file
  // This is just to establish the structure

  return (
    <div 
      ref={mountRef} 
      className="w-full h-full bg-[#0a0a15] relative overflow-hidden"
      style={{ 
        background: 'linear-gradient(135deg, #0a0a15 0%, #1a1a2e 50%, #16213e 100%)' 
      }}
    >
      {/* Tooltip */}
      {tooltip.visible && (
        <div 
          className="absolute z-50 bg-gray-800 text-white p-3 rounded-lg shadow-lg text-sm pointer-events-none border border-gray-600"
          style={{ 
            left: tooltip.x + 10, 
            top: tooltip.y - 10,
            maxWidth: '300px'
          }}
        >
          <div className="font-semibold mb-2">{tooltip.sourceLabel} → {tooltip.targetLabel}</div>
          {Object.entries(tooltip.statusCounts).length > 0 && (
            <div>
              <div className="text-xs text-gray-300 mb-1">Status Codes:</div>
              {Object.entries(tooltip.statusCounts).map(([status, count]) => (
                <div key={status} className="text-xs flex justify-between">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                    status.startsWith('2') ? 'bg-green-400' : 
                    status.startsWith('4') ? 'bg-yellow-400' : 
                    status.startsWith('5') ? 'bg-red-400' : 'bg-blue-400'
                  }`}></span>
                  <span>{status}: {count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Service Metrics Popup */}
      <ServiceMetricsPopup
        visible={metricsPopup.visible}
        serviceName={metricsPopup.serviceName}
        metrics={metricsPopup.metrics}
        position={metricsPopup.position}
        onClose={() => setMetricsPopup({ ...metricsPopup, visible: false })}
      />
    </div>
  );
}