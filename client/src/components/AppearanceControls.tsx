import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { DiagramSettings } from "@/types/diagram";

interface AppearanceControlsProps {
  settings: DiagramSettings;
  onSettingsChange: (settings: DiagramSettings) => void;
  disabled?: boolean;
}

const colorOptions = [
  { value: "primary", color: "bg-primary", label: "Blue" },
  { value: "red", color: "bg-red-500", label: "Red" },
  { value: "green", color: "bg-green-500", label: "Green" },
  { value: "purple", color: "bg-purple-500", label: "Purple" },
];

export default function AppearanceControls({
  settings,
  onSettingsChange,
  disabled = false
}: AppearanceControlsProps) {
  const handleToggle = (key: keyof DiagramSettings, value: boolean) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleColorChange = (color: string) => {
    onSettingsChange({ ...settings, nodeColor: color });
  };

  const handleBrightnessChange = (value: number[]) => {
    onSettingsChange({ ...settings, brightness: value[0] });
  };

  const handleNodeSpacingChange = (value: number[]) => {
    onSettingsChange({ ...settings, nodeSpacing: value[0] });
  };

  const handleClusterSpacingChange = (value: number[]) => {
    onSettingsChange({ ...settings, clusterSpacing: value[0] });
  };

  return (
    <div className="p-6 border-b border-gray-200">
      <h3 className="text-sm font-semibold text-foreground mb-3">Appearance</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Show Labels</span>
          <Switch
            checked={settings.showLabels}
            onCheckedChange={(checked) => handleToggle("showLabels", checked)}
            disabled={disabled}
          />
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Show Arrows</span>
          <Switch
            checked={settings.showArrows}
            onCheckedChange={(checked) => handleToggle("showArrows", checked)}
            disabled={disabled}
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">
            Node Spacing: {(settings.nodeSpacing || 120)}
          </label>
          <Slider
            value={[settings.nodeSpacing || 120]}
            onValueChange={handleNodeSpacingChange}
            min={50}
            max={300}
            step={10}
            disabled={disabled}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">
            Cluster Spacing: {(settings.clusterSpacing || 600)}
          </label>
          <Slider
            value={[settings.clusterSpacing || 600]}
            onValueChange={handleClusterSpacingChange}
            min={200}
            max={1500}
            step={50}
            disabled={disabled}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">
            Brightness: {(settings.brightness || 1.0).toFixed(1)}x
          </label>
          <Slider
            value={[settings.brightness || 1.0]}
            onValueChange={handleBrightnessChange}
            min={0.1}
            max={3.0}
            step={0.1}
            disabled={disabled}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Node Color</label>
          <div className="flex space-x-2">
            {colorOptions.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                size="sm"
                className={`w-6 h-6 p-0 rounded-full border-2 ${option.color} ${
                  settings.nodeColor === option.value 
                    ? 'ring-2 ring-primary ring-offset-2' 
                    : 'hover:ring-1 hover:ring-gray-300'
                }`}
                onClick={() => handleColorChange(option.value)}
                disabled={disabled}
                title={option.label}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
