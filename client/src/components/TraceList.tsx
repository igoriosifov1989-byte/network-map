import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DiagramData } from "@/types/diagram";

interface TraceListProps {
  data: DiagramData | null;
  selectedTraceId: string | null;
  onTraceSelect: (traceId: string | null) => void;
}

export default function TraceList({ data, selectedTraceId, onTraceSelect }: TraceListProps) {
  if (!data || !data.edges.length) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-sm">Trace IDs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Нет данных для отображения</p>
        </CardContent>
      </Card>
    );
  }

  // Collect all trace IDs from edges
  const traceConnections = new Map<string, string[]>();
  
  data.edges.forEach(edge => {
    if (edge.traceId) {
      // Handle multiple trace IDs separated by comma
      const traceIds = edge.traceId.split(',').map(id => id.trim());
      traceIds.forEach(traceId => {
        if (!traceConnections.has(traceId)) {
          traceConnections.set(traceId, []);
        }
        const connectionLabel = `${edge.source} → ${edge.target}`;
        if (!traceConnections.get(traceId)!.includes(connectionLabel)) {
          traceConnections.get(traceId)!.push(connectionLabel);
        }
      });
    }
  });

  const sortedTraces = Array.from(traceConnections.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center justify-between">
        <div className="flex items-center">
          <div className="w-2 h-2 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full mr-2"></div>
          Trace IDs
        </div>
        <Badge variant="secondary" className="text-xs">
          {sortedTraces.length}
        </Badge>
      </h3>
      
      <ScrollArea className="h-40">
        {sortedTraces.length === 0 ? (
          <p className="text-xs text-muted-foreground">Нет trace_id в данных</p>
        ) : (
          <div className="space-y-1">
            {sortedTraces.map(([traceId, connections]) => (
              <div 
                key={traceId} 
                className={`border rounded-lg p-2 cursor-pointer transition-colors ${
                  selectedTraceId === traceId 
                    ? 'bg-blue-900/40 border-blue-400 border-2' 
                    : 'border-slate-600/30 hover:bg-slate-700/30'
                }`}
                onClick={() => onTraceSelect(selectedTraceId === traceId ? null : traceId)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Badge 
                    variant={selectedTraceId === traceId ? "default" : "outline"} 
                    className="text-xs font-mono px-1 py-0"
                  >
                    {traceId}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    ({connections.length})
                  </span>
                </div>
                {connections.length > 0 && (
                  <div className="text-xs text-muted-foreground font-mono">
                    {connections[0]}{connections.length > 1 && ` +${connections.length - 1}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}