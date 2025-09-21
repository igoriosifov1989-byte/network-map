import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Crosshair, Maximize, Image, FileDown } from "lucide-react";
import { applyLayout, exportAsSVG, exportAsPNG } from "@/lib/diagramUtils";
import type { DiagramData, DiagramSettings, LayoutType } from "@/types/diagram";

interface DiagramCanvasProps {
  data: DiagramData | null;
  settings: DiagramSettings;
  layout: LayoutType;
  onApplyLayout?: () => void;
}

export default function DiagramCanvas({ data, settings, layout }: DiagramCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [transform, setTransform] = useState(d3.zoomIdentity);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = 800;
    const height = 600;

    // Clear previous content
    svg.selectAll("*").remove();

    // Apply layout to get positioned nodes
    const { nodes, edges } = applyLayout(layout, [...data.nodes], [...data.edges], width, height, settings.nodeSpacing);

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        const { transform } = event;
        setTransform(transform);
        setZoomLevel(Math.round(transform.k * 100));
        g.attr("transform", transform);
      });

    svg.call(zoom);

    // Create main group for zooming/panning
    const g = svg.append("g");

    // Define arrow markers for different edge types
    const defs = svg.append("defs");
    
    if (settings.showArrows) {
      // Standard arrow marker
      defs.append("marker")
        .attr("id", "arrowhead")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 22)
        .attr("refY", 0)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#374151")
        .attr("stroke", "none");

      // Circular dependency arrow marker (different color)
      defs.append("marker")
        .attr("id", "arrowhead-circular")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 22)
        .attr("refY", 0)
        .attr("markerWidth", 8)
        .attr("markerHeight", 8)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#DC2626")
        .attr("stroke", "none");
    }

    // Detect circular dependencies
    const circularPairs = new Set<string>();
    edges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      
      // Check if reverse edge exists
      const reverseExists = edges.some(otherEdge => {
        const otherSourceId = typeof otherEdge.source === 'string' ? otherEdge.source : otherEdge.source.id;
        const otherTargetId = typeof otherEdge.target === 'string' ? otherEdge.target : otherEdge.target.id;
        return otherSourceId === targetId && otherTargetId === sourceId;
      });
      
      if (reverseExists) {
        const pairKey = [sourceId, targetId].sort().join('-');
        circularPairs.add(pairKey);
      }
    });

    // Function to check if two curves would overlap
    const curvesOverlap = (controlX1: number, controlY1: number, controlX2: number, controlY2: number) => {
      const dx = controlX2 - controlX1;
      const dy = controlY2 - controlY1;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance < 40; // Minimum separation threshold
    };

    // Calculate edge positioning with curves for multiple edges
    const getEdgeCoordinates = (edge: any, curveOffset: number = 0, allCurves: any[] = []) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const source = nodes.find(n => n.id === sourceId);
      const target = nodes.find(n => n.id === targetId);
      
      if (!source || !target || source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) {
        return { x1: 0, y1: 0, x2: 0, y2: 0, path: null, controlX: 0, controlY: 0 };
      }
      
      // If there's a curve offset, create a curved path
      if (curveOffset !== 0) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dr = Math.sqrt(dx * dx + dy * dy);
        
        if (dr === 0) {
          return { x1: source.x, y1: source.y, x2: target.x, y2: target.y, path: null, controlX: 0, controlY: 0 };
        }
        
        // Calculate control point for curve
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        
        // Create perpendicular offset for curve
        let perpX = (-dy / dr) * curveOffset;
        let perpY = (dx / dr) * curveOffset;
        
        let controlX = midX + perpX;
        let controlY = midY + perpY;
        
        // Check for overlaps with existing curves
        let hasOverlap = false;
        
        for (const existingCurve of allCurves) {
          if (curvesOverlap(controlX, controlY, existingCurve.controlX, existingCurve.controlY)) {
            hasOverlap = true;
            break;
          }
        }
        
        // If overlap detected, mirror the curve to opposite side
        if (hasOverlap) {
          perpX = -perpX;
          perpY = -perpY;
          controlX = midX + perpX;
          controlY = midY + perpY;
        }
        
        const path = `M${source.x},${source.y} Q${controlX},${controlY} ${target.x},${target.y}`;
        return { x1: source.x, y1: source.y, x2: target.x, y2: target.y, path, controlX, controlY };
      }
      
      return { x1: source.x, y1: source.y, x2: target.x, y2: target.y, path: null, controlX: 0, controlY: 0 };
    };

    // Draw edges with proper handling for circular dependencies
    const edgeGroup = g.append("g").attr("class", "edges");
    
    // Create all edges with curves for multiple relationships
    const allEdges: any[] = [];
    
    // Group edges by node pairs to determine curve offsets
    const edgeGroups = new Map<string, any[]>();
    edges.forEach((edge, index) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const pairKey = [sourceId, targetId].sort().join('-');
      
      if (!edgeGroups.has(pairKey)) {
        edgeGroups.set(pairKey, []);
      }
      edgeGroups.get(pairKey)!.push({ ...edge, originalIndex: index });
    });
    
    // Process each group and assign curve offsets
    const processedCurves: any[] = [];
    
    edgeGroups.forEach((groupEdges, pairKey) => {
      const isCircular = circularPairs.has(pairKey);
      
      groupEdges.forEach((edge, groupIndex) => {
        let curveOffset = 0;
        
        // If there are multiple edges between same nodes, add curves
        if (groupEdges.length > 1) {
          const totalEdges = groupEdges.length;
          const maxOffset = 50; // Increased for better separation
          const isEven = totalEdges % 2 === 0;
          
          if (isEven) {
            // Even number: no line on axis, symmetric pairs
            const pairsCount = totalEdges / 2;
            const offsetStep = maxOffset / pairsCount;
            
            if (groupIndex < pairsCount) {
              // Upper curves: +offset
              curveOffset = offsetStep * (pairsCount - groupIndex);
            } else {
              // Lower curves: -offset
              curveOffset = -offsetStep * (groupIndex - pairsCount + 1);
            }
          } else {
            // Odd number: one line on axis (center), others symmetric
            const centerIndex = Math.floor(totalEdges / 2);
            
            if (groupIndex === centerIndex) {
              curveOffset = 0; // Center line on axis
            } else {
              const pairsCount = Math.floor(totalEdges / 2);
              const offsetStep = maxOffset / pairsCount;
              
              if (groupIndex < centerIndex) {
                // Upper curves: +offset
                curveOffset = offsetStep * (centerIndex - groupIndex);
              } else {
                // Lower curves: -offset
                curveOffset = -offsetStep * (groupIndex - centerIndex);
              }
            }
          }
        }
        
        const coords = getEdgeCoordinates(edge, curveOffset, processedCurves);
        const edgeData = { ...edge, isCircular, curveOffset, coords };
        
        // Add to processed curves for intersection checking
        if (coords.controlX !== 0 || coords.controlY !== 0) {
          processedCurves.push({ controlX: coords.controlX, controlY: coords.controlY });
        }
        
        allEdges.push(edgeData);
      });
    });

    // Separate straight and curved edges
    const straightEdges = allEdges.filter(d => !d.coords.path);
    const curvedEdges = allEdges.filter(d => d.coords.path);

    // Draw straight edges as lines
    const lines = edgeGroup.selectAll("line")
      .data(straightEdges)
      .enter().append("line")
      .attr("x1", (d: any) => d.coords.x1)
      .attr("y1", (d: any) => d.coords.y1)
      .attr("x2", (d: any) => d.coords.x2)
      .attr("y2", (d: any) => d.coords.y2)
      .attr("stroke", (d: any) => {
        if (d.trafficType === 'inter-service') return "#DC2626";
        if (d.trafficType === 'intra-service') return "#059669";
        if (d.trafficType === 'external') return "#7C3AED";
        return "#000000";
      })
      .attr("stroke-width", (d: any) => {
        const count = d.connectionCount || 1;
        return Math.max(1, Math.min(5, count)); // Scale from 1px to 5px
      })
      .attr("marker-end", settings.showArrows ? "url(#arrowhead)" : null)
      .attr("class", "edge")
      .on("mouseover", function(event: any, d: any) {
        if (d.connectionCount && d.connectionCount > 1) {
          const tooltip = d3.select("body").append("div")
            .attr("class", "connection-tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.8)")
            .style("color", "white")
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .text(d.connectionCount.toString());
          
          tooltip.style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        }
      })
      .on("mouseout", function() {
        d3.selectAll(".connection-tooltip").remove();
      });

    // Draw curved edges as paths
    const paths = edgeGroup.selectAll("path")
      .data(curvedEdges)
      .enter().append("path")
      .attr("d", (d: any) => d.coords.path)
      .attr("stroke", (d: any) => {
        if (d.trafficType === 'inter-service') return "#DC2626";
        if (d.trafficType === 'intra-service') return "#059669";
        if (d.trafficType === 'external') return "#7C3AED";
        return "#000000";
      })
      .attr("stroke-width", (d: any) => {
        const count = d.connectionCount || 1;
        return Math.max(1, Math.min(5, count)); // Scale from 1px to 5px
      })
      .attr("fill", "none")
      .attr("marker-end", settings.showArrows ? "url(#arrowhead)" : null)
      .attr("class", "edge")
      .on("mouseover", function(event: any, d: any) {
        if (d.connectionCount && d.connectionCount > 1) {
          const tooltip = d3.select("body").append("div")
            .attr("class", "connection-tooltip")
            .style("position", "absolute")
            .style("background", "rgba(0, 0, 0, 0.8)")
            .style("color", "white")
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .text(d.connectionCount.toString());
          
          tooltip.style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        }
      })
      .on("mouseout", function() {
        d3.selectAll(".connection-tooltip").remove();
      });

    // Draw nodes
    const node = g.append("g")
      .selectAll("g")
      .data(nodes)
      .enter().append("g")
      .attr("transform", (d: any) => `translate(${d.x},${d.y})`)
      .call(d3.drag<any, any>()
        .on("start", function(event, d: any) {
          d3.select(this).raise().classed("active", true);
        })
        .on("drag", function(event, d: any) {
          // Update node position
          d.x += event.dx;
          d.y += event.dy;
          
          // Move the node
          d3.select(this).attr("transform", `translate(${d.x},${d.y})`);
          
          // Recalculate all affected edges to maintain proper curve distribution
          const affectedEdges = allEdges.filter((edge: any) => {
            const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
            return sourceId === d.id || targetId === d.id;
          });
          
          // Rebuild curves for affected node pairs to avoid overlaps
          const affectedPairs = new Set<string>();
          affectedEdges.forEach((edge: any) => {
            const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
            const pairKey = [sourceId, targetId].sort().join('-');
            affectedPairs.add(pairKey);
          });
          
          // Recalculate curves for affected pairs
          const recalculatedCurves: any[] = [];
          affectedPairs.forEach(pairKey => {
            const pairEdges = affectedEdges.filter((edge: any) => {
              const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
              const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
              const edgePairKey = [sourceId, targetId].sort().join('-');
              return edgePairKey === pairKey;
            });
            
            pairEdges.forEach((edge: any, groupIndex: number) => {
              let curveOffset = 0;
              
              if (pairEdges.length > 1) {
                const totalEdges = pairEdges.length;
                const maxOffset = 50;
                const isEven = totalEdges % 2 === 0;
                
                if (isEven) {
                  const pairsCount = totalEdges / 2;
                  const offsetStep = maxOffset / pairsCount;
                  
                  if (groupIndex < pairsCount) {
                    curveOffset = offsetStep * (pairsCount - groupIndex);
                  } else {
                    curveOffset = -offsetStep * (groupIndex - pairsCount + 1);
                  }
                } else {
                  const centerIndex = Math.floor(totalEdges / 2);
                  
                  if (groupIndex === centerIndex) {
                    curveOffset = 0;
                  } else {
                    const pairsCount = Math.floor(totalEdges / 2);
                    const offsetStep = maxOffset / pairsCount;
                    
                    if (groupIndex < centerIndex) {
                      curveOffset = offsetStep * (centerIndex - groupIndex);
                    } else {
                      curveOffset = -offsetStep * (groupIndex - centerIndex);
                    }
                  }
                }
              }
              
              edge.curveOffset = curveOffset;
              const updatedCoords = getEdgeCoordinates(edge, curveOffset, recalculatedCurves);
              edge.coords = updatedCoords;
              
              if (updatedCoords.controlX !== 0 || updatedCoords.controlY !== 0) {
                recalculatedCurves.push({ controlX: updatedCoords.controlX, controlY: updatedCoords.controlY });
              }
            });
          });
          
          // Update straight line edges
          lines
            .filter((l: any) => affectedEdges.includes(l))
            .each(function(l: any) {
              if (!l.coords.path) {
                d3.select(this)
                  .attr("x1", l.coords.x1)
                  .attr("y1", l.coords.y1)
                  .attr("x2", l.coords.x2)
                  .attr("y2", l.coords.y2);
              }
            });
          
          // Update curved path edges
          paths
            .filter((p: any) => affectedEdges.includes(p))
            .each(function(p: any) {
              if (p.coords.path) {
                d3.select(this).attr("d", p.coords.path);
              }
            });
        })
        .on("end", function() {
          d3.select(this).classed("active", false);
        })
      );

    // Add circles for nodes
    const getNodeColor = () => {
      switch (settings.nodeColor) {
        case "red": return "#EF4444";
        case "green": return "#10B981";
        case "purple": return "#8B5CF6";
        default: return "#1976D2";
      }
    };

    node.append("circle")
      .attr("r", 20)
      .attr("fill", getNodeColor())
      .attr("stroke", "#fff")
      .attr("stroke-width", 3);

    // Add labels if enabled
    if (settings.showLabels) {
      node.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("fill", "white")
        .attr("font-size", "12px")
        .attr("font-weight", "600")
        .text((d: any) => d.label.charAt(0).toUpperCase());

      node.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "2.5em")
        .attr("fill", "#374151")
        .attr("font-size", "11px")
        .text((d: any) => d.label);
    }

  }, [data, settings, layout]);

  const handleZoomIn = () => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().call(
        d3.zoom<SVGSVGElement, unknown>().transform,
        transform.scale(1.2)
      );
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().call(
        d3.zoom<SVGSVGElement, unknown>().transform,
        transform.scale(0.8)
      );
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current) {
      const svg = d3.select(svgRef.current);
      svg.transition().call(
        d3.zoom<SVGSVGElement, unknown>().transform,
        d3.zoomIdentity
      );
    }
  };

  const handleExportSVG = () => {
    if (svgRef.current) {
      exportAsSVG(svgRef.current);
    }
  };

  const handleExportPNG = () => {
    if (svgRef.current) {
      exportAsPNG(svgRef.current);
    }
  };

  if (!data) {
    return (
      <div className="flex-1 flex flex-col bg-gray-50">
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
                <FileDown className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Create Your First Diagram</h3>
              <p className="text-muted-foreground mb-6">
                Upload a CSV or Excel file with source-target columns to automatically generate an interactive network diagram.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Canvas Toolbar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomIn}
                className="h-8 w-8 p-0"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomOut}
                className="h-8 w-8 p-0"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetZoom}
                className="h-8 w-8 p-0"
                title="Reset Zoom"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="h-6 w-px bg-gray-300"></div>
            
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Center Diagram"
            >
              <Crosshair className="h-4 w-4" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Fullscreen"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center space-x-3">
            <span className="text-xs text-muted-foreground">{zoomLevel}%</span>
            <div className="flex items-center space-x-2">
              <Button
                onClick={handleExportPNG}
                size="sm"
                className="text-xs"
              >
                <Image className="w-3 h-3 mr-1" />
                PNG
              </Button>
              <Button
                onClick={handleExportSVG}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                <FileDown className="w-3 h-3 mr-1" />
                SVG
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox="0 0 800 600"
          style={{ background: '#fafafa' }}
        />
      </div>
    </div>
  );
}
