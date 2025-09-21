import { CheckCircle, AlertCircle, XCircle, Activity, Filter } from "lucide-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DiagramStats, DiagramData } from "@/types/diagram";

interface StatisticsProps {
  stats: DiagramStats | null;
  data: DiagramData | null;
}

function calculateStatusStats(data: DiagramData | null, selectedConnection?: string) {
  if (!data?.edges) return { total: 0, success: 0, clientError: 0, serverError: 0 };
  
  let total = 0;
  let success = 0;
  let clientError = 0;
  let serverError = 0;
  
  data.edges.forEach(edge => {
    // Если выбрано соединение, фильтруем только это соединение
    if (selectedConnection && selectedConnection !== 'all') {
      const edgeId = `${edge.source} → ${edge.target}`;
      if (edgeId !== selectedConnection) return;
    }
    
    if (edge.statusCounts) {
      Object.entries(edge.statusCounts).forEach(([status, count]) => {
        const statusCode = parseInt(status);
        const numCount = count as number;
        total += numCount;
        
        if (statusCode >= 200 && statusCode < 300) {
          success += numCount;
        } else if (statusCode >= 400 && statusCode < 500) {
          clientError += numCount;
        } else if (statusCode >= 500 && statusCode < 600) {
          serverError += numCount;
        }
      });
    }
  });
  
  return { total, success, clientError, serverError };
}

function getConnectionOptions(data: DiagramData | null) {
  if (!data?.edges) return [];
  
  const connections = data.edges
    .filter(edge => edge.statusCounts && Object.keys(edge.statusCounts).length > 0)
    .map(edge => `${edge.source} → ${edge.target}`)
    .sort();
  
  return ['all', ...connections];
}

export default function Statistics({ stats, data }: StatisticsProps) {
  const [selectedConnection, setSelectedConnection] = useState<string>('all');
  const connectionOptions = getConnectionOptions(data);
  const statusStats = calculateStatusStats(data, selectedConnection);
  
  const statCards = [
    {
      icon: CheckCircle,
      label: "Success (2xx)",
      value: statusStats.total > 0 ? Math.round((statusStats.success / statusStats.total) * 100) : 0,
      suffix: "%",
      color: "from-green-500 to-emerald-600",
      bgColor: "bg-green-900/30",
      textColor: "text-green-300"
    },
    {
      icon: AlertCircle,
      label: "Client Errors (4xx)", 
      value: statusStats.total > 0 ? Math.round((statusStats.clientError / statusStats.total) * 100) : 0,
      suffix: "%",
      color: "from-orange-500 to-red-600",
      bgColor: "bg-orange-900/30",
      textColor: "text-orange-300"
    },
    {
      icon: XCircle,
      label: "Server Errors (5xx)",
      value: statusStats.total > 0 ? Math.round((statusStats.serverError / statusStats.total) * 100) : 0,
      suffix: "%",
      color: "from-red-500 to-red-700", 
      bgColor: "bg-red-900/30",
      textColor: "text-red-300"
    },
    {
      icon: Activity,
      label: "Total Requests",
      value: statusStats.total,
      suffix: "",
      color: "from-blue-500 to-purple-600",
      bgColor: "bg-blue-900/30",
      textColor: "text-blue-300"
    }
  ];

  return (
    <div className="p-4 flex-1 overflow-y-auto">
      <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center">
        <div className="w-2 h-2 bg-gradient-to-r from-purple-400 to-blue-400 rounded-full mr-2"></div>
        Request Statistics
      </h3>
      
      {/* Connection Filter */}
      {connectionOptions.length > 1 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 mb-2">
            <Filter className="w-3 h-3 text-slate-400" />
            <span className="text-xs font-medium text-slate-400">Connection:</span>
          </div>
          <Select value={selectedConnection} onValueChange={setSelectedConnection}>
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue placeholder="Select connection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Connections</SelectItem>
              {connectionOptions.slice(1).map(connection => (
                <SelectItem key={connection} value={connection}>
                  {connection}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      
      <div className="space-y-2">
        {statCards.map((stat, index) => {
          const IconComponent = stat.icon;
          return (
            <div key={index} className={`${stat.bgColor} rounded-lg p-3 border border-slate-600/30 shadow-sm hover:shadow-md transition-all duration-200`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className={`w-6 h-6 bg-gradient-to-r ${stat.color} rounded-md flex items-center justify-center shadow-sm`}>
                    <IconComponent className="w-3 h-3 text-white" />
                  </div>
                  <span className={`text-xs font-medium ${stat.textColor}`}>{stat.label}</span>
                </div>
                <span className={`text-sm font-bold ${stat.textColor}`}>
                  {stat.value.toLocaleString()}{stat.suffix}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
