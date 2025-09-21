import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import type { DiagramSettings } from "@/types/diagram";

interface UnifiedSettingsProps {
  settings: DiagramSettings;
  onSettingsChange: (settings: DiagramSettings) => void;
  onSpacingChange: (spacing: number) => void;
  disabled?: boolean;
  lodLevel?: 'high' | 'medium' | 'low';
  relativeDistance?: number;
  serviceCount?: number;
}

export default function UnifiedSettings({
  settings,
  onSettingsChange,
  onSpacingChange,
  disabled = false,
  lodLevel = 'high',
  relativeDistance = 0,
  serviceCount = 0,
}: UnifiedSettingsProps) {
  console.log('UNIFIEDSETTINGS RENDER!!!', disabled, settings.clusterSpacing);
  console.error('UNIFIEDSETTINGS: Slider will be', disabled ? 'DISABLED' : 'ENABLED');
  
  const handleToggle = (key: keyof DiagramSettings, value: boolean) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleBrightnessChange = (value: number[]) => {
    onSettingsChange({ ...settings, brightness: value[0] });
  };

  const handleSpacingChange = (value: number[]) => {
    onSpacingChange(value[0]);
  };

  const handleClusterSpacingChange = (value: number[]) => {
    console.log('UNIFIEDSETTINGS: CLUSTER SPACING CHANGED!!!', 'from', settings.clusterSpacing, 'to', value[0]);
    const newSettings = { ...settings, clusterSpacing: value[0] };
    console.error('UNIFIEDSETTINGS: CALLING onSettingsChange!!!', newSettings);
    onSettingsChange(newSettings);
  };

  const handleClusterSpacingYChange = (value: number[]) => {
    onSettingsChange({ ...settings, clusterSpacingY: value[0] });
  };

  return (
    <div className="space-y-4 p-4 bg-slate-800/50 rounded-lg border border-slate-700/60">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">Settings</h3>
        <div className={`px-2 py-1 rounded text-xs font-medium ${
          lodLevel === 'high' ? 'bg-green-700 text-green-100' :
          lodLevel === 'medium' ? 'bg-yellow-700 text-yellow-100' :
          'bg-red-700 text-red-100'
        }`}>
          LOD: {lodLevel.toUpperCase()}
        </div>
      </div>
      
      {/* LOD Information */}
      <div className="text-xs text-slate-400 space-y-1">
        <div>Services: {serviceCount} | Relative Distance: {relativeDistance?.toFixed(2)}x</div>
        <div className="text-xs">
          {lodLevel === 'low' && '⚡ Low detail: simplified geometry, no animations'}
          {lodLevel === 'medium' && '🔧 Medium detail: balanced performance'}
          {lodLevel === 'high' && '✨ High detail: full animations & geometry'}
        </div>
      </div>
      
      <div className="space-y-4">
        {/* Node Spacing */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
            Node Spacing: {settings.nodeSpacing}
          </label>
          <Slider
            value={[settings.nodeSpacing]}
            onValueChange={handleSpacingChange}
            min={50}
            max={300}
            step={10}
            disabled={disabled}
            className="w-full"
          />
        </div>

        {/* Cluster Spacing */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
            Cluster Spacing: {settings.clusterSpacing || 600}
          </label>
          <div className="space-y-2">
            <Slider
              value={[settings.clusterSpacing || 600]}
              onValueChange={(value) => {
                console.error('🔥 SLIDER ONVALUECHANGE FIRED!!!', value);
                console.error('🔥 CALLING handleClusterSpacingChange!!!', value);
                handleClusterSpacingChange(value);
                console.error('🔥 FINISHED handleClusterSpacingChange!!!');
              }}
              min={200}
              max={1500}
              step={50}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex gap-1">
              <button 
                onClick={() => {
                  console.error('TEST BUTTON CLICKED - CHANGING TO 800!!!');
                  handleClusterSpacingChange([800]);
                }}
                className="px-2 py-1 text-xs bg-red-600 text-white rounded"
              >
                Test 800
              </button>
              <button 
                onClick={() => {
                  console.error('TEST BUTTON CLICKED - CHANGING TO 1200!!!');
                  handleClusterSpacingChange([1200]);
                }}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
              >
                Test 1200
              </button>
            </div>
          </div>
        </div>

        {/* Cluster Spacing Y */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
            Cluster Spacing Y: {settings.clusterSpacingY || 300}
          </label>
          <Slider
            value={[settings.clusterSpacingY || 300]}
            onValueChange={handleClusterSpacingYChange}
            min={0}
            max={1000}
            step={25}
            disabled={disabled}
            className="w-full"
          />
        </div>

        {/* Display Options */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-400">Show Labels</label>
            <Switch
              checked={settings.showLabels}
              onCheckedChange={(checked) => handleToggle("showLabels", checked)}
              disabled={disabled}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-400">Show Arrows</label>
            <Switch
              checked={settings.showArrows}
              onCheckedChange={(checked) => handleToggle("showArrows", checked)}
              disabled={disabled}
            />
          </div>
        </div>
        
        {/* Brightness Control */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-2">
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

      </div>
    </div>
  );
}