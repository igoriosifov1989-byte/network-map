import { useState, useMemo, useEffect } from "react";
import { ChartGantt, Download, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/Sidebar";
import DiagramCanvas from "@/components/DiagramCanvas";
import Diagram3D from "@/components/Diagram3D";
import HelpPanel from "@/components/HelpPanel";
import DataGeneratorControls from "@/components/DataGeneratorControls";
import { processNetworkEvents, mergeEventData } from "@/lib/eventProcessor";
import { processOpenTelemetryData, mergeOpenTelemetryData } from "@/lib/opentelemetryProcessor";
import type { ParsedFileData, DiagramSettings, LayoutType } from "@/types/diagram";

export default function DiagramGenerator() {
  const [data, setData] = useState<ParsedFileData | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [layout, setLayout] = useState<LayoutType>("force");
  const [settings, setSettings] = useState<DiagramSettings>({
    showLabels: true,
    showArrows: true,
    nodeColor: "primary",
    nodeSpacing: 120,
    clusterSpacing: 600,
    clusterSpacingY: 300,
    edgeColor: "#6b7280",
    backgroundColor: "#f8fafc",
    showLegend: true,
    brightness: 1.0,
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [refreshLayout, setRefreshLayout] = useState(0);
  const [realTimeData, setRealTimeData] = useState<ParsedFileData | null>(null);
  const [isRealTimeMode, setIsRealTimeMode] = useState(false);
  const [diagram3DRef, setDiagram3DRef] = useState<{ saveCameraState: () => void } | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [isOpenTelemetryMode, setIsOpenTelemetryMode] = useState(false);
  const [openTelemetryData, setOpenTelemetryData] = useState<ParsedFileData | null>(null);
  
  // Debug state changes
  useEffect(() => {
    console.error('🚨 🎯 openTelemetryData state changed:', {
      hasData: !!openTelemetryData,
      nodes: openTelemetryData?.data?.nodes?.length || 0,
      edges: openTelemetryData?.data?.edges?.length || 0
    });
  }, [openTelemetryData]);
  const [isDataGeneratorActive, setIsDataGeneratorActive] = useState(false);
  const [lodInfo, setLodInfo] = useState<{ 
    level: 'high' | 'medium' | 'low', 
    relativeDistance: number, 
    serviceCount: number 
  }>({ level: 'high', relativeDistance: 0, serviceCount: 0 });
  
  const { toast } = useToast();

  const handleFileProcessed = (newData: ParsedFileData, newFileName: string) => {
    setData(newData);
    setFileName(newFileName);

    setRefreshLayout(prev => prev + 1);
    toast({
      title: "File processed successfully",
      description: `Loaded ${newData.stats.nodeCount} nodes and ${newData.stats.edgeCount} edges`,
    });
  };

  const handleMultipleFilesProcessed = (aggregatedData: ParsedFileData, filenames: string[]) => {
    const combinedFileName = `${filenames.length} files combined`;
    setData(aggregatedData);
    setFileName(combinedFileName);

    setRefreshLayout(prev => prev + 1);
    
    const totalConnections = aggregatedData.data.edges.reduce((sum, edge) => sum + (edge.connectionCount || 1), 0);
    toast({
      title: "Multiple files processed successfully",
      description: `Combined ${filenames.length} files: ${aggregatedData.stats.nodeCount} nodes, ${totalConnections} total connections`,
    });
  };

  const handleError = (error: string) => {
    toast({
      title: "Error processing file",
      description: error,
      variant: "destructive",
    });
  };

  const handleLayoutChange = (newLayout: LayoutType) => {
    setLayout(newLayout);
  };

  const handleSpacingChange = (spacing: number) => {
    setSettings(prev => ({ ...prev, nodeSpacing: spacing }));
  };

  const handleApplyLayout = () => {
    setRefreshLayout(prev => prev + 1);
    toast({
      title: "Layout applied",
      description: `Applied ${layout} layout with ${settings.nodeSpacing}px spacing`,
    });
  };

  const handleClearData = () => {
    setData(null);
    setFileName("");
    setRealTimeData(null);
    setIsRealTimeMode(false);
    setOpenTelemetryData(null);
    setIsOpenTelemetryMode(false);
    setRefreshLayout(prev => prev + 1);
    toast({
      title: "Data cleared",
      description: "All diagram data has been removed",
    });
  };

  const handleBeforeUpdate = () => {
    // This will be called before data updates to save camera state
    if (diagram3DRef && diagram3DRef.saveCameraState) {
      diagram3DRef.saveCameraState();
    }
  };

  const handleLODUpdate = (level: 'high' | 'medium' | 'low', relativeDistance: number, serviceCount: number) => {
    setLodInfo({ level, relativeDistance, serviceCount });
  };

  const handleRealTimeDataUpdate = (events: any[]) => {
    if (events.length === 0) {
      // Clear real-time data when no events found
      setRealTimeData(null);
      setRefreshLayout(prev => prev + 1);
      return;
    }
    
    const eventData = processNetworkEvents(events);
    setRealTimeData(eventData);
    setIsRealTimeMode(true);
    
    // Auto-switch to 3D mode for real-time data
    if (layout !== "3d-network") {
      setLayout("3d-network");
    }
    
    setRefreshLayout(prev => prev + 1);
    
    toast({
      title: "Real-time data loaded",
      description: `${events.length} events • ${eventData.stats.nodeCount} nodes • ${eventData.stats.edgeCount} connections`,
    });
  };

  const handleOpenTelemetryDataUpdate = (otelData: { traces: any[]; spans: any[] }) => {
    console.error('🚨 🎯 handleOpenTelemetryDataUpdate START, traces:', otelData.traces?.length, 'spans:', otelData.spans?.length);
    if (!otelData.traces || otelData.traces.length === 0) {
      setOpenTelemetryData(null);
      setIsOpenTelemetryMode(false);
      setRefreshLayout(prev => prev + 1);
      return;
    }
    
    const processedData = processOpenTelemetryData(otelData.traces, otelData.spans);
    console.error(`🚨 🔄 Setting OTEL data:`, {
      tracesCount: otelData.traces.length,
      spansCount: otelData.spans.length,
      processedNodes: processedData.data.nodes.length,
      processedEdges: processedData.data.edges.length
    });
    console.log(`🔄 Setting OTEL data:`, {
      tracesCount: otelData.traces.length,
      spansCount: otelData.spans.length,
      processedNodes: processedData.data.nodes.length,
      processedEdges: processedData.data.edges.length
    });
    console.error('🚨 🎯 About to setOpenTelemetryData with:', {
      processedDataExists: !!processedData,
      nodes: processedData?.data?.nodes?.length,
      edges: processedData?.data?.edges?.length
    });
    setOpenTelemetryData(processedData);
    console.error('🚨 🎯 setOpenTelemetryData called - state should update');
    setIsOpenTelemetryMode(true);
    console.error('🚨 🎯 setIsOpenTelemetryMode(true) called');
    
    // Auto-switch to 3D mode for OpenTelemetry data
    if (layout !== "3d-network") {
      setLayout("3d-network");
    }
    
    setRefreshLayout(prev => prev + 1);
    
    toast({
      title: "OpenTelemetry data loaded",
      description: `${otelData.traces.length} traces • ${processedData.stats.nodeCount} nodes • ${processedData.stats.edgeCount} connections`,
    });
    console.error('🚨 🎯 handleOpenTelemetryDataUpdate END - openTelemetryData state should be set');
  };

  const handleDataGeneratorUpdate = (data: any) => {
    console.error('🚨 ⚡ handleDataGeneratorUpdate called with:', {
      hasData: !!data,
      dataType: typeof data,
      isArray: Array.isArray(data),
      hasTraces: data && typeof data === 'object' && 'traces' in data,
      hasSpans: data && typeof data === 'object' && 'spans' in data,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      tracesLength: data?.traces?.length,
      spansLength: data?.spans?.length
    });
    
    // Check if this is OpenTelemetry data (has traces and spans)
    if (data && typeof data === 'object' && 'traces' in data && 'spans' in data) {
      console.error('🚨 ⚡ Calling handleOpenTelemetryDataUpdate with traces:', data.traces.length, 'spans:', data.spans.length);
      handleOpenTelemetryDataUpdate(data);
    } else if (Array.isArray(data)) {
      console.error('🚨 ⚡ Calling handleRealTimeDataUpdate with array data:', data.length);
      // This is network events data
      handleRealTimeDataUpdate(data);
    } else {
      console.error('🚨 ⚡ Unknown data format - not processing:', data);
    }
  };

  // Memoize the display data to prevent unnecessary re-renders
  const displayData = useMemo(() => {
    console.error('🚨 📊 displayData useMemo START - states:', {
      hasOpenTelemetryData: !!openTelemetryData,
      hasRealTimeData: !!realTimeData, 
      hasFileData: !!data
    });
    // Priority: OpenTelemetry > Real Time > File Data
    const result = openTelemetryData || realTimeData || data;
    
    console.error('🚨 📊 useMemo recalculating displayData', { 
      hasRealTime: !!realTimeData, 
      hasFileData: !!data,
      hasOpenTelemetry: !!openTelemetryData,
      realTimeEdges: realTimeData?.data.edges.length || 0,
      fileDataEdges: data?.data.edges.length || 0,
      otelEdges: openTelemetryData?.data.edges.length || 0,
      resultEdges: result?.data.edges.length || 0,
      sampleTraceIds: result?.data.edges.slice(0, 3).map(e => e.traceId) || []
    });
    console.log('📊 useMemo recalculating displayData', { 
      hasRealTime: !!realTimeData, 
      hasFileData: !!data,
      hasOpenTelemetry: !!openTelemetryData,
      realTimeEdges: realTimeData?.data.edges.length || 0,
      fileDataEdges: data?.data.edges.length || 0,
      otelEdges: openTelemetryData?.data.edges.length || 0,
      resultEdges: result?.data.edges.length || 0,
      sampleTraceIds: result?.data.edges.slice(0, 3).map(e => e.traceId) || []
    });
    
    console.error('🚨 📊 displayData useMemo END - result:', {
      hasResult: !!result,
      resultNodes: result?.data?.nodes?.length || 0,
      resultEdges: result?.data?.edges?.length || 0
    });
    return result;
  }, [realTimeData, data, openTelemetryData]);

  const handleExport = () => {
    // This will be handled by the DiagramCanvas component
    toast({
      title: "Export options",
      description: "Use the export buttons in the canvas toolbar",
    });
  };

  return (
    <>
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 shadow-lg border-b border-purple-500/20 sticky top-0 z-40 backdrop-blur-sm">
        <div className="max-w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg ring-2 ring-purple-500/30">
                  <ChartGantt className="w-5 h-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-bold bg-gradient-to-r from-white to-purple-100 bg-clip-text text-transparent">
                    DiagramFlow
                  </h1>
                  <span className="text-xs text-purple-200/70 font-medium">3D Network Visualization</span>
                </div>
              </div>
              <div className="hidden md:flex items-center space-x-6 ml-8">
                <div className="flex items-center space-x-2 bg-black/20 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-purple-500/20">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-sm text-purple-100 font-medium">
                    {fileName || "No file loaded"}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Unified data generator controls */}
            <div className="flex-1 flex justify-center">
              <DataGeneratorControls 
                onDataUpdate={handleDataGeneratorUpdate} 
                onBeforeUpdate={handleBeforeUpdate}
                isActive={isDataGeneratorActive}
                onActiveChange={setIsDataGeneratorActive}
              />
            </div>
            
            <div className="flex items-center space-x-3">
              <Button
                onClick={handleExport}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 border-0 ring-1 ring-purple-500/30"
              >
                <Download className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline font-medium">Export</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHelpOpen(true)}
                className="h-9 w-9 p-0 text-purple-200 hover:text-white hover:bg-purple-500/20 rounded-xl transition-all duration-200"
              >
                <HelpCircle className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 4rem)' }}>
        <Sidebar
          layout={layout}
          settings={settings}
          stats={displayData?.stats || null}
          data={displayData?.data || null}
          onLayoutChange={handleLayoutChange}
          onSpacingChange={handleSpacingChange}
          onApplyLayout={handleApplyLayout}
          onSettingsChange={(newSettings) => {
            console.log('DIAGRAMGENERATOR: onSettingsChange called!!!');
            console.warn('DIAGRAMGENERATOR: NEW SETTINGS!!!', newSettings);
            console.error('DIAGRAMGENERATOR: CALLING setSettings!!!');
            setSettings(newSettings);
            
            // Check if cluster spacing changed and call handleSpacingChange
            if (newSettings.clusterSpacing !== settings.clusterSpacing || 
                newSettings.clusterSpacingY !== settings.clusterSpacingY) {
              console.error('DIAGRAMGENERATOR: CLUSTER SPACING CHANGED!!!', 
                'clusterSpacing:', settings.clusterSpacing, '→', newSettings.clusterSpacing,
                'clusterSpacingY:', settings.clusterSpacingY, '→', newSettings.clusterSpacingY);
              handleSpacingChange(0); // Parameter doesn't matter, just triggers cache clear
            }
          }}
          hasData={!!displayData}
          selectedTraceId={selectedTraceId}
          onTraceSelect={(traceId) => {
            console.log('🎯 onTraceSelect called with:', traceId);
            setSelectedTraceId(traceId);
          }}
          lodLevel={lodInfo.level}
          relativeDistance={lodInfo.relativeDistance}
          serviceCount={lodInfo.serviceCount}
        />

        {layout === "3d-network" ? (
          <Diagram3D
            data={displayData?.data || null}
            settings={settings}
            onApplyLayout={handleApplyLayout}
            selectedTraceId={selectedTraceId}
            onLODUpdate={handleLODUpdate}
          />
        ) : (
          <DiagramCanvas
            data={displayData?.data || null}
            settings={settings}
            layout={layout}
            key={refreshLayout} // Force re-render when layout is applied
          />
        )}
      </div>

      <HelpPanel isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
