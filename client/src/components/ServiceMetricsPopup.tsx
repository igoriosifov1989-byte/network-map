import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Computer, 
  Cpu, 
  HardDrive, 
  Activity, 
  Network, 
  Users, 
  Clock, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  X
} from "lucide-react";
import type { ServiceMetrics } from "@shared/schema";

interface ServiceMetricsPopupProps {
  serviceName: string;
  metrics: ServiceMetrics | null;
  onClose: () => void;
  position: { x: number; y: number };
}

function getHealthColor(status: string) {
  switch (status) {
    case "healthy": return "text-green-400";
    case "warning": return "text-yellow-400";
    case "critical": return "text-red-400";
    default: return "text-gray-400";
  }
}

function getHealthIcon(status: string) {
  switch (status) {
    case "healthy": return CheckCircle;
    case "warning": return AlertTriangle;
    case "critical": return XCircle;
    default: return Activity;
  }
}

function getUsageColor(percentage: number) {
  if (percentage >= 85) return "text-red-400";
  if (percentage >= 70) return "text-yellow-400";
  return "text-green-400";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 MB/s";
  return `${bytes.toFixed(1)} MB/s`;
}

export default function ServiceMetricsPopup({ 
  serviceName, 
  metrics, 
  onClose, 
  position 
}: ServiceMetricsPopupProps) {
  if (!metrics) {
    return (
      <div 
        className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-4 min-w-80"
        style={{ 
          left: Math.min(position.x, window.innerWidth - 320), 
          top: Math.min(position.y, window.innerHeight - 400)
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Computer className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200">{serviceName}</h3>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onClose}
            className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="text-center py-4">
          <div className="text-slate-400 text-sm">No metrics available</div>
        </div>
      </div>
    );
  }

  const HealthIcon = getHealthIcon(metrics.healthStatus);

  return (
    <div 
      className="fixed z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-4 min-w-80 max-w-96"
      style={{ 
        left: Math.min(position.x, window.innerWidth - 400), 
        top: Math.min(position.y, window.innerHeight - 500)
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Computer className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">{serviceName}</h3>
          <Badge 
            variant={metrics.deploymentType === "kubernetes" ? "default" : "secondary"}
            className="text-xs"
          >
            {metrics.deploymentType === "kubernetes" ? "K8s" : "VM"}
          </Badge>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onClose}
          className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Health Status */}
      <div className="flex items-center space-x-2 mb-4 p-2 bg-slate-700/50 rounded-md">
        <HealthIcon className={`w-4 h-4 ${getHealthColor(metrics.healthStatus)}`} />
        <span className={`text-sm font-medium ${getHealthColor(metrics.healthStatus)}`}>
          {metrics.healthStatus.charAt(0).toUpperCase() + metrics.healthStatus.slice(1)}
        </span>
        <span className="text-xs text-slate-400 ml-auto">
          {new Date(metrics.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Resource Usage */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-3 h-3 text-blue-400" />
            <div>
              <div className="text-xs text-slate-400">CPU</div>
              <div className={`text-sm font-medium ${getUsageColor(metrics.cpuUsage)}`}>
                {metrics.cpuUsage.toFixed(1)}%
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Activity className="w-3 h-3 text-purple-400" />
            <div>
              <div className="text-xs text-slate-400">Memory</div>
              <div className={`text-sm font-medium ${getUsageColor(metrics.memoryUsage)}`}>
                {metrics.memoryUsage.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center space-x-2">
            <HardDrive className="w-3 h-3 text-green-400" />
            <div>
              <div className="text-xs text-slate-400">Disk</div>
              <div className={`text-sm font-medium ${getUsageColor(metrics.diskUsage)}`}>
                {metrics.diskUsage.toFixed(1)}%
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Users className="w-3 h-3 text-cyan-400" />
            <div>
              <div className="text-xs text-slate-400">Connections</div>
              <div className="text-sm font-medium text-slate-200">
                {metrics.activeConnections}
              </div>
            </div>
          </div>
        </div>

        {/* Network */}
        <div className="border-t border-slate-600 pt-3">
          <div className="flex items-center space-x-1 mb-2">
            <Network className="w-3 h-3 text-indigo-400" />
            <span className="text-xs text-slate-400">Network I/O</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-400">In: </span>
              <span className="text-slate-200">{formatBytes(metrics.networkIn)}</span>
            </div>
            <div>
              <span className="text-slate-400">Out: </span>
              <span className="text-slate-200">{formatBytes(metrics.networkOut)}</span>
            </div>
          </div>
        </div>

        {/* Performance */}
        <div className="border-t border-slate-600 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center space-x-2">
              <Clock className="w-3 h-3 text-orange-400" />
              <div>
                <div className="text-xs text-slate-400">Response</div>
                <div className="text-sm font-medium text-slate-200">
                  {metrics.responseTime}ms
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-3 h-3 text-red-400" />
              <div>
                <div className="text-xs text-slate-400">Error Rate</div>
                <div className={`text-sm font-medium ${metrics.errorRate > 5 ? 'text-red-400' : metrics.errorRate > 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {metrics.errorRate.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Kubernetes specific */}
        {metrics.deploymentType === "kubernetes" && metrics.podCount && (
          <div className="border-t border-slate-600 pt-3">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded-sm"></div>
              <div>
                <div className="text-xs text-slate-400">Active Pods</div>
                <div className="text-sm font-medium text-slate-200">
                  {metrics.podCount}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}