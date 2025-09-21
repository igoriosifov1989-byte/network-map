import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertDiagramSchema, diagramDataSchema } from "@shared/schema";
import { startNetworkGenerator, getRecentEvents, getEventsSince, getEventsInRange } from "./networkGenerator";
import { startOpenTelemetryGeneration, stopOpenTelemetryGeneration, getRecentTraces, getSpansForTrace, getTracesInRange } from "./opentelemetryGenerator";
import { startRealisticGeneration, stopRealisticGeneration } from "./realisticOtelGenerator";
import { startServiceMetricsGeneration, stopServiceMetricsGeneration, getLatestServiceMetrics, getServiceMetricsHistory } from "./serviceMetricsGenerator";
import { pushToGitHub } from "./github-utils";
import multer from "multer";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";

const upload = multer({ storage: multer.memoryStorage() });

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Parse uploaded file and extract source-target relationships
  app.post("/api/parse-file", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { buffer, originalname } = req.file;
      let data: any[] = [];

      // Parse based on file extension
      if (originalname.endsWith('.csv')) {
        const csvText = buffer.toString('utf-8');
        data = parse(csvText, { columns: true, skip_empty_lines: true });
      } else if (originalname.endsWith('.xlsx') || originalname.endsWith('.xls')) {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(worksheet);
      } else {
        return res.status(400).json({ message: "Unsupported file format. Please use CSV or Excel files." });
      }

      // Validate required columns
      if (data.length === 0) {
        return res.status(400).json({ message: "File is empty or could not be parsed" });
      }

      const firstRow = data[0];
      const columns = Object.keys(firstRow).map(col => col.toLowerCase());
      
      if (!columns.includes('source') || !columns.includes('target')) {
        return res.status(400).json({ 
          message: "File must contain 'source' and 'target' columns. Found columns: " + Object.keys(firstRow).join(', ')
        });
      }

      // First pass: collect all service-label combinations
      const serviceLabels = new Map<string, Set<string>>();
      
      data.forEach(row => {
        const source = String(row.source || row.Source || '').trim();
        const target = String(row.target || row.Target || '').trim();
        const label = String(row.label || row.Label || '').trim();
        
        if (!serviceLabels.has(source)) {
          serviceLabels.set(source, new Set());
        }
        if (!serviceLabels.has(target)) {
          serviceLabels.set(target, new Set());
        }
        
        if (label) {
          serviceLabels.get(source)!.add(label);
          serviceLabels.get(target)!.add(label);
        }
      });

      // Create nodes: one node per service-label combination
      const nodes: any[] = [];
      console.log('SERVER: Service-Label mapping:', Array.from(serviceLabels.entries()));
      
      serviceLabels.forEach((labels, serviceName) => {
        console.log(`SERVER: Processing service "${serviceName}" with labels:`, Array.from(labels));
        if (labels.size > 0) {
          labels.forEach(label => {
            const node = {
              id: `${serviceName}_${label}`,
              label: label,
              service: serviceName  // This should be the original CSV service name
            };
            console.log(`SERVER: Created node:`, node);
            nodes.push(node);
          });
        } else {
          nodes.push({
            id: serviceName,
            label: serviceName,
            service: serviceName
          });
        }
      });

      // Create edges
      const edges = data.map((row, index) => {
        const source = String(row.source || row.Source || '').trim();
        const target = String(row.target || row.Target || '').trim();
        const label = String(row.label || row.Label || '').trim();
        const status = String(row.status || row.Status || '').trim();
        

        
        return {
          id: `edge_${index}`,
          source: label ? `${source}_${label}` : source,
          target: label ? `${target}_${label}` : target,
          label: label,
          status: status || undefined
        };
      });

      const diagramData = { nodes, edges };
      
      // Validate the data structure
      const validated = diagramDataSchema.parse(diagramData);
      
      res.json({
        data: validated,
        stats: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          componentCount: 1 // Simplified for now
        }
      });

    } catch (error) {
      console.error("File parsing error:", error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to parse file"
      });
    }
  });

  // Save diagram
  app.post("/api/diagrams", async (req, res) => {
    try {
      const validated = insertDiagramSchema.parse(req.body);
      const diagram = await storage.createDiagram(validated);
      res.json(diagram);
    } catch (error) {
      res.status(400).json({ message: "Invalid diagram data" });
    }
  });

  // Get diagram
  app.get("/api/diagrams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const diagram = await storage.getDiagram(id);
      if (!diagram) {
        return res.status(404).json({ message: "Diagram not found" });
      }
      res.json(diagram);
    } catch (error) {
      res.status(400).json({ message: "Invalid diagram ID" });
    }
  });

  // Update diagram
  app.patch("/api/diagrams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = insertDiagramSchema.partial().parse(req.body);
      const diagram = await storage.updateDiagram(id, updates);
      if (!diagram) {
        return res.status(404).json({ message: "Diagram not found" });
      }
      res.json(diagram);
    } catch (error) {
      res.status(400).json({ message: "Invalid update data" });
    }
  });

  // Get all diagrams
  app.get("/api/diagrams", async (req, res) => {
    try {
      const diagrams = await storage.getAllDiagrams();
      res.json(diagrams);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch diagrams" });
    }
  });

  // Real-time network events endpoints
  
  // Start generating network events
  app.post("/api/network/start", (req, res) => {
    try {
      const interval = req.body.interval || 2000; // Default 2 seconds
      
      // Stop existing generator if running
      const existingStopGenerator = (app as any).networkGeneratorStop;
      if (existingStopGenerator) {
        existingStopGenerator();
        delete (app as any).networkGeneratorStop;
      }
      
      // Start new generator with new interval
      const stopGenerator = startNetworkGenerator(interval);
      
      // Store the stop function (in a real app, you'd use a proper state manager)
      (app as any).networkGeneratorStop = stopGenerator;
      
      res.json({ 
        message: "Network event generator started", 
        interval: interval 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to start generator" });
    }
  });

  // Stop generating network events
  app.post("/api/network/stop", (req, res) => {
    try {
      const stopGenerator = (app as any).networkGeneratorStop;
      if (stopGenerator) {
        stopGenerator();
        delete (app as any).networkGeneratorStop;
      }
      
      res.json({ message: "Network event generator stopped" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop generator" });
    }
  });

  // Get recent network events
  app.get("/api/network/events", async (req, res) => {
    try {
      // Disable caching for real-time data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      const limit = parseInt(req.query.limit as string) || 100;
      const from = req.query.from ? new Date(req.query.from as string) : null;
      const to = req.query.to ? new Date(req.query.to as string) : null;
      
      // If time range is specified, use it; otherwise get recent events
      if (from && to) {
        const rangeDuration = Math.round((to.getTime() - from.getTime()) / (1000 * 60));
        console.log(`📊 Querying events for ${rangeDuration} min range: ${from.toISOString()} to ${to.toISOString()}`);
        const events = await getEventsInRange(from, to, limit);
        if (events.length > 0) {
          const oldestEvent = new Date(events[events.length - 1].timestamp);
          const newestEvent = new Date(events[0].timestamp);
          console.log(`📊 Found ${events.length} events, oldest: ${oldestEvent.toISOString()}, newest: ${newestEvent.toISOString()}`);
        } else {
          console.log(`📊 No events found in ${rangeDuration} min range`);
        }
        res.json(events);
      } else {
        const events = await getRecentEvents(limit);
        res.json(events);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  // Get events since timestamp
  app.get("/api/network/events/since/:timestamp", async (req, res) => {
    try {
      const timestamp = new Date(req.params.timestamp);
      const events = await getEventsSince(timestamp);
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch events since timestamp" });
    }
  });

  // OpenTelemetry endpoints
  
  // Start OpenTelemetry trace generation
  app.post("/api/otel/start", (req, res) => {
    try {
      const interval = req.body.interval || 5000; // Default 5 seconds for traces
      
      // Stop existing generator if running
      const existingStopGenerator = (app as any).otelGeneratorStop;
      if (existingStopGenerator) {
        existingStopGenerator();
        delete (app as any).otelGeneratorStop;
      }
      
      // Start new generator
      startOpenTelemetryGeneration(interval);
      
      // Store stop function for later cleanup
      (app as any).otelGeneratorStop = () => stopOpenTelemetryGeneration();
      
      res.json({ 
        message: "OpenTelemetry trace generation started", 
        interval,
        format: "OpenTelemetry with traces and spans"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to start OpenTelemetry generation" });
    }
  });

  // Stop OpenTelemetry trace generation
  app.post("/api/otel/stop", (req, res) => {
    try {
      const stopGenerator = (app as any).otelGeneratorStop;
      if (stopGenerator) {
        stopGenerator();
        delete (app as any).otelGeneratorStop;
      }
      
      stopOpenTelemetryGeneration();
      res.json({ message: "OpenTelemetry trace generation stopped" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop OpenTelemetry generation" });
    }
  });

  // Get recent traces
  app.get("/api/otel/traces", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const from = req.query.from ? new Date(req.query.from as string) : null;
      const to = req.query.to ? new Date(req.query.to as string) : null;
      
      if (from && to) {
        const traces = await getTracesInRange(from, to, limit);
        res.json(traces);
      } else {
        const traces = await getRecentTraces(limit);
        res.json(traces);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch traces" });
    }
  });

  // Get spans for a specific trace
  app.get("/api/otel/traces/:traceId/spans", async (req, res) => {
    try {
      const { traceId } = req.params;
      const spans = await getSpansForTrace(traceId);
      res.json(spans);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch spans for trace" });
    }
  });

  // Realistic OpenTelemetry generation endpoints
  
  // Start realistic OpenTelemetry trace generation (Gateway → API Bus → Business Services)
  app.post("/api/otel/realistic/start", (req, res) => {
    try {
      const interval = req.body.interval || 2000; // Default 2 seconds for realistic traces
      
      // Stop any existing generators first
      stopOpenTelemetryGeneration();
      stopRealisticGeneration();
      
      // Start realistic generation
      startRealisticGeneration(interval);
      
      res.json({ 
        message: "Realistic OpenTelemetry trace generation started", 
        interval,
        format: "Realistic Gateway → API Bus → Business Services flow"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to start realistic OpenTelemetry generation" });
    }
  });
  
  // Stop realistic OpenTelemetry trace generation
  app.post("/api/otel/realistic/stop", (req, res) => {
    try {
      stopRealisticGeneration();
      res.json({ message: "Realistic OpenTelemetry trace generation stopped" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop realistic OpenTelemetry generation" });
    }
  });

  // Service Metrics API endpoints
  app.post("/api/metrics/start", (req, res) => {
    try {
      const interval = parseInt(req.body.intervalMs) || 30000;
      startServiceMetricsGeneration(interval);
      res.json({ 
        message: "Service metrics generation started", 
        interval: interval 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to start metrics generation" });
    }
  });

  app.post("/api/metrics/stop", (req, res) => {
    try {
      stopServiceMetricsGeneration();
      res.json({ message: "Service metrics generation stopped" });
    } catch (error) {
      res.status(500).json({ message: "Failed to stop metrics generation" });
    }
  });

  app.get("/api/metrics/latest", async (req, res) => {
    try {
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      const metrics = await getLatestServiceMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch service metrics" });
    }
  });

  app.get("/api/metrics/history/:serviceName", async (req, res) => {
    try {
      const serviceName = req.params.serviceName;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const history = await getServiceMetricsHistory(serviceName, limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch service metrics history" });
    }
  });

  // GitHub push endpoint
  app.post("/api/github/push", async (req, res) => {
    try {
      const { 
        message = "Update files", 
        branch = "main", 
        owner, 
        repo 
      } = req.body;
      
      console.log(`Starting GitHub push with message: "${message}" to ${owner || 'default-owner'}/${repo || 'default-repo'} on branch: ${branch}`);
      const result = await pushToGitHub(message, branch, owner, repo);
      
      res.json({
        message: "Successfully pushed to GitHub",
        ...result
      });
    } catch (error) {
      console.error('GitHub push API error:', error);
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : "Failed to push to GitHub"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
