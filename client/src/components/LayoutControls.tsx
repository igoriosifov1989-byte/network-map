import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Wand2 } from "lucide-react";
import type { LayoutType } from "@/types/diagram";

interface LayoutControlsProps {
  layout: LayoutType;
  spacing: number;
  onLayoutChange: (layout: LayoutType) => void;
  onSpacingChange: (spacing: number) => void;
  onApplyLayout: () => void;
  disabled?: boolean;
}

export default function LayoutControls({
  layout,
  spacing,
  onLayoutChange,
  onSpacingChange,
  onApplyLayout,
  disabled = false
}: LayoutControlsProps) {
  return (
    <div className="p-6 border-b border-gray-200">
      <h3 className="text-sm font-semibold text-foreground mb-3">Layout Options</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Algorithm</label>
          <Select value={layout} onValueChange={onLayoutChange} disabled={disabled}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="force">Force-directed</SelectItem>
              <SelectItem value="hierarchical">Hierarchical</SelectItem>
              <SelectItem value="circular">Circular</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
              <SelectItem value="service-grouped">Service Grouped</SelectItem>
              <SelectItem value="network-topology">Network Topology</SelectItem>
              <SelectItem value="3d-network">3D Network View</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Node Spacing: {spacing}px
          </label>
          <Slider
            value={[spacing]}
            onValueChange={(value) => onSpacingChange(value[0])}
            min={50}
            max={200}
            step={10}
            disabled={disabled}
            className="w-full"
          />
        </div>
        
        <Button 
          onClick={onApplyLayout} 
          disabled={disabled}
          className="w-full"
          variant="outline"
        >
          <Wand2 className="w-4 h-4 mr-2" />
          Apply Layout
        </Button>
      </div>
    </div>
  );
}
