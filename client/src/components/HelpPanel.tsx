import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpPanel({ isOpen, onClose }: HelpPanelProps) {
  return (
    <div className={`fixed inset-y-0 right-0 w-96 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-50 ${
      isOpen ? 'translate-x-0' : 'translate-x-full'
    }`}>
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-foreground">Help & Tips</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-2">File Format</h3>
              <p className="text-sm text-muted-foreground mb-3">Your file should contain at least two columns:</p>
              <div className="bg-muted p-3 rounded-lg text-sm font-mono">
                <div>source,target</div>
                <div>Node A,Node B</div>
                <div>Node B,Node C</div>
                <div>Node A,Node D</div>
              </div>
            </div>
            
            <div>
              <h3 className="font-semibold text-foreground mb-2">Navigation</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Mouse wheel: Zoom in/out</li>
                <li>• Click & drag: Pan around</li>
                <li>• Drag nodes: Reposition manually</li>
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold text-foreground mb-2">Layout Algorithms</h3>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li><strong>Force-directed:</strong> Natural clustering</li>
                <li><strong>Hierarchical:</strong> Tree-like structure</li>
                <li><strong>Circular:</strong> Nodes in a circle</li>
                <li><strong>Grid:</strong> Organized rows and columns</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
