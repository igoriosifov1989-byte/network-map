import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Clock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface TimeRangeControlsProps {
  onTimeRangeChange: (range: { from: Date; to: Date }) => void;
  onIntervalChange: (intervalMs: number) => void;
  onRefreshToggle: (enabled: boolean) => void;
  isRefreshing: boolean;
  currentInterval: number;
}

const TIME_RANGES = [
  { label: "Last 5 minutes", value: 5 * 60 * 1000 },
  { label: "Last 15 minutes", value: 15 * 60 * 1000 },
  { label: "Last 30 minutes", value: 30 * 60 * 1000 },
  { label: "Last 1 hour", value: 60 * 60 * 1000 },
  { label: "Last 3 hours", value: 3 * 60 * 60 * 1000 },
  { label: "Last 6 hours", value: 6 * 60 * 60 * 1000 },
  { label: "Last 12 hours", value: 12 * 60 * 60 * 1000 },
  { label: "Last 24 hours", value: 24 * 60 * 60 * 1000 },
];

const REFRESH_INTERVALS = [
  { label: "Off", value: 0 },
  { label: "1s", value: 1000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "5m", value: 5 * 60000 },
];

export default function TimeRangeControls({
  onTimeRangeChange,
  onIntervalChange,
  onRefreshToggle,
  isRefreshing,
  currentInterval
}: TimeRangeControlsProps) {
  const [selectedRange, setSelectedRange] = useState("15m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isCustomRange, setIsCustomRange] = useState(false);

  const handleQuickRangeSelect = (rangeMs: number, label: string) => {
    const now = new Date();
    const from = new Date(now.getTime() - rangeMs);
    setSelectedRange(label);
    setIsCustomRange(false);
    onTimeRangeChange({ from, to: now });
  };

  const handleCustomRangeApply = () => {
    if (customFrom && customTo) {
      const from = new Date(customFrom);
      const to = new Date(customTo);
      if (from < to) {
        onTimeRangeChange({ from, to });
        setIsCustomRange(true);
        setSelectedRange("Custom");
      }
    }
  };



  return (
    <div className="flex items-center space-x-2 text-sm">
      {/* Time Range Selector */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <Calendar className="w-3 h-3 mr-1" />
            {selectedRange}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium mb-2 block">Quick ranges</Label>
              <div className="grid grid-cols-2 gap-1">
                {TIME_RANGES.map((range) => (
                  <Button
                    key={range.label}
                    variant={selectedRange === range.label ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs justify-start"
                    onClick={() => handleQuickRangeSelect(range.value, range.label)}
                  >
                    {range.label}
                  </Button>
                ))}
              </div>
            </div>
            
            <div>
              <Label className="text-xs font-medium mb-2 block">Custom range</Label>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input
                    type="datetime-local"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input
                    type="datetime-local"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleCustomRangeApply}
                  disabled={!customFrom || !customTo}
                  className="h-7 w-full text-xs"
                >
                  Apply custom range
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Refresh Interval */}
      <Select 
        value={currentInterval.toString()} 
        onValueChange={(value) => {
          const interval = parseInt(value);
          onIntervalChange(interval);
          if (interval > 0) {
            onRefreshToggle(true);
          } else {
            onRefreshToggle(false);
          }
        }}
      >
        <SelectTrigger className="h-8 w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REFRESH_INTERVALS.map((interval) => (
            <SelectItem key={interval.value} value={interval.value.toString()}>
              {interval.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>



      {/* Current time indicator */}
      <div className="text-xs text-muted-foreground">
        <Clock className="w-3 h-3 inline mr-1" />
        {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}