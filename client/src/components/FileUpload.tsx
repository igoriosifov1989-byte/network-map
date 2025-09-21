import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseFile, validateFileType } from "@/lib/fileParser";
import type { ParsedFileData, DiagramData, DiagramEdge, DiagramNode } from "@/types/diagram";

// Function to detect service patterns from node names (only used as fallback when server doesn't provide service)
function detectServiceFromNodeId(nodeId: string): { service: string; endpoint: string } | null {
  // Only try simpler patterns to avoid over-parsing complex IDs
  // Pattern: service.endpoint or service:endpoint  
  const dotColonPattern = /^([a-zA-Z0-9-_]+)[.:]([a-zA-Z0-9-_]+)$/;
  const match = nodeId.match(dotColonPattern);
  if (match) {
    return { service: match[1], endpoint: match[2] };
  }
  
  return null;
}

// Function to determine traffic type between nodes
function getTrafficType(sourceService: string | undefined, targetService: string | undefined): 'inter-service' | 'intra-service' | 'external' {
  if (!sourceService || !targetService) return 'external';
  if (sourceService === targetService) return 'intra-service';
  return 'inter-service';
}

// Function to aggregate data from multiple files with service detection
function aggregateFileData(fileDataArray: ParsedFileData[]): ParsedFileData {
  const allNodes = new Map<string, DiagramNode>();
  const connectionCounts = new Map<string, number>();
  const edgeDetails = new Map<string, DiagramEdge[]>();
  const statusCounts = new Map<string, Record<string, number>>();
  const detectedServices = new Map<string, Set<string>>();
  
  // Process all files
  fileDataArray.forEach(fileData => {
    // Collect unique nodes and preserve server-assigned service names
    fileData.data.nodes.forEach(node => {
      const serverService = (node as any).service;
      let enhancedNode: DiagramNode;
      
      if (serverService) {
        // Preserve server-assigned service grouping exactly as provided
        enhancedNode = {
          ...node,
          service: serverService,
          nodeType: 'endpoint'
        };
        
        // Track services and their endpoints using exact server service name
        if (!detectedServices.has(serverService)) {
          detectedServices.set(serverService, new Set());
        }
        detectedServices.get(serverService)!.add(node.id);
      } else {
        // Only use auto-detection if server didn't provide service name
        const servicePattern = detectServiceFromNodeId(node.id);
        if (servicePattern) {
          enhancedNode = {
            ...node,
            service: servicePattern.service,
            nodeType: 'endpoint'
          };
          
          if (!detectedServices.has(servicePattern.service)) {
            detectedServices.set(servicePattern.service, new Set());
          }
          detectedServices.get(servicePattern.service)!.add(node.id);
        } else {
          enhancedNode = { ...node, nodeType: 'service' };
        }
      }
      
      allNodes.set(node.id, enhancedNode);
    });
    
    // Count connections between node pairs and track status codes
    fileData.data.edges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const connectionKey = `${sourceId}->${targetId}`;
      
      connectionCounts.set(connectionKey, (connectionCounts.get(connectionKey) || 0) + 1);
      
      if (!edgeDetails.has(connectionKey)) {
        edgeDetails.set(connectionKey, []);
      }
      edgeDetails.get(connectionKey)!.push(edge);
      
      // Track status code counts
      if (edge.status) {
        if (!statusCounts.has(connectionKey)) {
          statusCounts.set(connectionKey, {});
        }
        const statusCount = statusCounts.get(connectionKey)!;
        statusCount[edge.status] = (statusCount[edge.status] || 0) + 1;
      }
    });
  });
  
  // Skip creating artificial service nodes - treat all nodes as they appear in CSV
  
  // Create aggregated edges with connection counts and traffic type
  const aggregatedEdges: (DiagramEdge & { connectionCount: number })[] = [];
  connectionCounts.forEach((count, connectionKey) => {
    const [sourceId, targetId] = connectionKey.split('->');
    const originalEdges = edgeDetails.get(connectionKey) || [];
    const firstEdge = originalEdges[0];
    
    const sourceNode = allNodes.get(sourceId);
    const targetNode = allNodes.get(targetId);
    const trafficType = getTrafficType(sourceNode?.service, targetNode?.service);
    
    aggregatedEdges.push({
      id: `${sourceId}-${targetId}-aggregated`,
      source: sourceId,
      target: targetId,
      label: firstEdge?.label || '',
      connectionCount: count,
      trafficType,
      status: firstEdge?.status, // Preserve status from first edge
      statusCounts: statusCounts.get(connectionKey) || {}
    });
  });
  
  const aggregatedData: DiagramData = {
    nodes: Array.from(allNodes.values()),
    edges: aggregatedEdges
  };
  
  return {
    data: aggregatedData,
    stats: {
      nodeCount: aggregatedData.nodes.length,
      edgeCount: aggregatedData.edges.length,
      componentCount: detectedServices.size || 1
    }
  };
}

interface FileUploadProps {
  onFileProcessed: (data: ParsedFileData, filename: string) => void;
  onMultipleFilesProcessed: (aggregatedData: ParsedFileData, filenames: string[]) => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

export default function FileUpload({ onFileProcessed, onMultipleFilesProcessed, onError, isProcessing, setIsProcessing }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);

  const processMultipleFiles = useCallback(async (files: File[]) => {
    setIsProcessing(true);
    const processedFiles: { data: ParsedFileData; filename: string }[] = [];
    
    try {
      for (const file of files) {
        if (!validateFileType(file)) {
          onError(`Invalid file type: ${file.name}. Please upload CSV or Excel files only.`);
          continue;
        }
        
        try {
          const result = await parseFile(file);
          processedFiles.push({ data: result, filename: file.name });
        } catch (error) {
          onError(`Failed to process ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
      
      if (processedFiles.length === 0) {
        onError("No files could be processed successfully");
        return;
      }
      
      if (processedFiles.length === 1) {
        onFileProcessed(processedFiles[0].data, processedFiles[0].filename);
      } else {
        // Aggregate multiple files
        const aggregatedData = aggregateFileData(processedFiles.map(f => f.data));
        const filenames = processedFiles.map(f => f.filename);
        onMultipleFilesProcessed(aggregatedData, filenames);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [onFileProcessed, onMultipleFilesProcessed, onError, setIsProcessing]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      processMultipleFiles(acceptedFiles);
    }
  }, [processMultipleFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: true,
    disabled: isProcessing
  });

  return (
    <div className="p-6 border-b border-gray-200">
      <h2 className="text-lg font-semibold text-foreground mb-4">Import Data</h2>
      
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
          isDragActive || dragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-gray-300 hover:border-primary/50'
        } ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="upload-content">
          {isProcessing ? (
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="text-sm font-medium text-foreground mb-1">Processing file...</p>
              <p className="text-xs text-muted-foreground">Parsing data structure</p>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Drop your CSV or Excel files here</p>
              <p className="text-xs text-muted-foreground">or click to browse (select multiple files)</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center text-xs text-muted-foreground">
          <FileText className="w-3 h-3 mr-2" />
          <span>Supported formats: CSV, Excel (.xlsx, .xls)</span>
        </div>
        <div className="flex items-center text-xs text-muted-foreground">
          <AlertCircle className="w-3 h-3 mr-2" />
          <span>Required columns: source, target</span>
        </div>
      </div>
    </div>
  );
}
