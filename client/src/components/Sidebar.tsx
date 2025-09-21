import { useState, useRef } from "react";
import LayoutControls from "./LayoutControls";
import Statistics from "./Statistics";
import TraceList from "./TraceList";
import UnifiedSettings from "./UnifiedSettings";
import type { ParsedFileData, DiagramSettings, LayoutType, DiagramData } from "@/types/diagram";

interface SidebarProps {
  layout: LayoutType;
  settings: DiagramSettings;
  stats: ParsedFileData["stats"] | null;
  data: DiagramData | null;
  onLayoutChange: (layout: LayoutType) => void;
  onSpacingChange: (spacing: number) => void;
  onApplyLayout: () => void;
  onSettingsChange: (settings: DiagramSettings) => void;
  hasData: boolean;
  selectedTraceId: string | null;
  onTraceSelect: (traceId: string | null) => void;
  lodLevel?: 'high' | 'medium' | 'low';
  relativeDistance?: number;
  serviceCount?: number;
}

export default function Sidebar({
  layout,
  settings,
  stats,
  data,
  onLayoutChange,
  onSpacingChange,
  onApplyLayout,
  onSettingsChange,
  hasData,
  selectedTraceId,
  onTraceSelect,
  lodLevel,
  relativeDistance,
  serviceCount
}: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default width
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(250, Math.min(600, startWidth + deltaX)); // Min 250px, max 600px
      setSidebarWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  return (
    <div 
      ref={sidebarRef}
      className="bg-gradient-to-b from-slate-900 to-slate-800 border-r border-slate-700/60 flex flex-col shadow-lg h-full relative"
      style={{ width: `${sidebarWidth}px` }}
    >
      
      <div className="flex-1 overflow-y-auto">
        <UnifiedSettings
          settings={settings}
          onSettingsChange={onSettingsChange}
          onSpacingChange={onSpacingChange}
          disabled={false}
          lodLevel={lodLevel}
          relativeDistance={relativeDistance}
          serviceCount={serviceCount}
        />
        
        <Statistics stats={stats} data={data} />
        
        <TraceList 
          data={data} 
          selectedTraceId={selectedTraceId}
          onTraceSelect={onTraceSelect}
        />
      </div>
      
      {/* Resize handle */}
      <div
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize transition-colors ${
          isResizing ? 'bg-blue-400' : 'bg-transparent hover:bg-slate-500'
        }`}
        onMouseDown={handleMouseDown}
        style={{ right: '-2px' }}
      />
    </div>
  );
}
