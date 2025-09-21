import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Play, Pause, Square, RefreshCw, Settings, Database, Activity } from "lucide-react";
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import TimeRangeControls from "./TimeRangeControls";
import { apiRequest } from '@/lib/queryClient';

interface DataGeneratorControlsProps {
  onDataUpdate?: (data: any) => void;
  onBeforeUpdate?: () => void;
  isActive: boolean;
  onActiveChange: (active: boolean) => void;
}

export default function DataGeneratorControls({ 
  onDataUpdate, 
  onBeforeUpdate,
  isActive, 
  onActiveChange 
}: DataGeneratorControlsProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [interval, setInterval] = useState(2000);
  const [generatorInterval, setGeneratorInterval] = useState('5000');
  const [format, setFormat] = useState<'network' | 'opentelemetry' | 'realistic-otel'>('realistic-otel');
  const [isLoading, setIsLoading] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const autoUpdateIntervalRef = useRef<number | null>(null);
  const isGeneratingRef = useRef(false);
  
  // Time range controls state
  const [timeRange, setTimeRange] = useState<{ from: Date; to: Date }>({
    from: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
    to: new Date()
  });
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(true);

  // Time range control handlers
  const handleTimeRangeChange = (range: { from: Date; to: Date }) => {
    setTimeRange(range);
    setTimeout(() => fetchRecentEvents(), 0);
  };

  const handleIntervalChange = (intervalMs: number) => {
    setRefreshInterval(intervalMs);
  };

  const handleRefreshToggle = (enabled: boolean) => {
    setIsAutoRefreshing(enabled);
  };

  const startGeneratorUpdates = () => {
    if (autoUpdateIntervalRef.current) {
      console.log('🔄 Clearing existing interval:', autoUpdateIntervalRef.current);
      clearTimeout(autoUpdateIntervalRef.current);
    }
    
    console.log('🔄 Starting auto-refresh every', refreshInterval, 'ms', 'isAutoRefreshing:', isAutoRefreshing);
    
    const runUpdate = () => {
      console.error('🚨 🔄 runUpdate START - Auto-refreshing data... format:', format, new Date().toISOString());
      fetchRecentEvents(undefined, true);
      console.error('🚨 🔄 runUpdate END - fetchRecentEvents called');
      
      // Schedule next update
      autoUpdateIntervalRef.current = setTimeout(runUpdate, refreshInterval) as unknown as number;
      console.log('🔄 Next update scheduled in', refreshInterval, 'ms, timeoutId:', autoUpdateIntervalRef.current);
    };
    
    // Start first update immediately  
    runUpdate();
  };

  const stopGeneratorUpdates = () => {
    if (autoUpdateIntervalRef.current) {
      console.log('🔄 Stopping auto-refresh interval:', autoUpdateIntervalRef.current);
      clearInterval(autoUpdateIntervalRef.current);
      autoUpdateIntervalRef.current = null;
    }
  };

  const fetchRecentEvents = async (rangeToUse?: { from: Date; to: Date }, silent = false) => {
    console.error('🚨 📡 fetchRecentEvents START, format:', format, 'onDataUpdate exists:', !!onDataUpdate);
    if (!silent) setIsLoading(true);
    
    try {
      // Always use current time for "to" in auto-refresh mode
      const range = rangeToUse || {
        from: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes from now
        to: new Date() // Current time
      };
      console.log('📊 Querying events for 15 min range:', range.from.toISOString(), 'to', range.to.toISOString());
      
      let eventCount = 0;
      if (format === 'opentelemetry' || format === 'realistic-otel') {
        console.error('🚨 📡 Making traces API request');
        const tracesResponse = await apiRequest("GET", `/api/otel/traces?limit=20`);
        console.error('🚨 📡 Traces API response received');
        const traces = await tracesResponse.json() as any[];
        console.error('🚨 📡 Traces parsed:', traces.length);
        
        // Fetch spans for all traces
        console.error('🚨 📡 Starting to fetch spans for', traces.length, 'traces');
        const allSpans: any[] = [];
        for (const trace of traces) {
          try {
            const spansResponse = await apiRequest("GET", `/api/otel/traces/${trace.traceId}/spans`);
            const spans = await spansResponse.json() as any[];
            allSpans.push(...spans);
          } catch (error) {
            console.warn(`Failed to fetch spans for trace ${trace.traceId}:`, error);
          }
        }
        
        console.error('🚨 📡 About to call onDataUpdate with traces:', traces.length, 'spans:', allSpans.length);
        onDataUpdate?.({ traces, spans: allSpans });
        console.error('🚨 📡 onDataUpdate called successfully');
        eventCount = traces.length + allSpans.length;
      } else {
        const eventsResponse = await apiRequest("GET", '/api/network/events?limit=100');
        const events = await eventsResponse.json() as any[];
        console.log('📊 Found', events.length, 'events, oldest:', events[0]?.timestamp, ', newest:', events[events.length-1]?.timestamp);
        onDataUpdate?.(events);
        eventCount = events.length;
      }
      
      if (!silent) {
        setEventCount(eventCount);
      }
    } catch (error) {
      console.error('🚨 📡 fetchRecentEvents ERROR:', error);
    } finally {
      console.error('🚨 📡 fetchRecentEvents END');
      if (!silent) setIsLoading(false);
    }
  };

  const handleStartGeneration = async () => {
    try {
      setIsGenerating(true);
      onBeforeUpdate?.();
      
      let endpoint;
      if (format === 'opentelemetry') {
        endpoint = '/api/otel/start';
      } else if (format === 'realistic-otel') {
        endpoint = '/api/otel/realistic/start';
      } else {
        endpoint = '/api/network/start';
      }
      
      await apiRequest("POST", endpoint, { interval: parseInt(generatorInterval) });
      
      onActiveChange(true);
      isGeneratingRef.current = true;
      
      // Initial fetch
      fetchRecentEvents();
    } catch (error) {
      console.error('Failed to start generation:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStopGeneration = async () => {
    try {
      let endpoint;
      if (format === 'opentelemetry') {
        endpoint = '/api/otel/stop';
      } else if (format === 'realistic-otel') {
        endpoint = '/api/otel/realistic/stop';
      } else {
        endpoint = '/api/network/stop';
      }
      
      await apiRequest("POST", endpoint);
      
      onActiveChange(false);
      isGeneratingRef.current = false;
      stopGeneratorUpdates();
    } catch (error) {
      console.error('Failed to stop generation:', error);
    }
  };

  const handleToggleGenerator = () => {
    if (isActive) {
      handleStopGeneration();
    } else {
      handleStartGeneration();
    }
  };

  const handleManualRefresh = () => {
    onBeforeUpdate?.();
    fetchRecentEvents();
  };

  // Auto-refresh effect
  useEffect(() => {
    console.error('🚨 🔄 useEffect triggered: isAutoRefreshing=', isAutoRefreshing, 'refreshInterval=', refreshInterval, 'isActive=', isActive, 'current interval:', autoUpdateIntervalRef.current);
    console.log('🔄 useEffect triggered: isAutoRefreshing=', isAutoRefreshing, 'refreshInterval=', refreshInterval, 'isActive=', isActive, 'current interval:', autoUpdateIntervalRef.current);
    if (isAutoRefreshing && isActive) {
      console.error('🚨 🔄 CONDITIONS MET - starting generator updates');
      startGeneratorUpdates();
    } else {
      console.error('🚨 🔄 CONDITIONS NOT MET - stopping generator updates', {
        isAutoRefreshing,
        isActive,
        reason: !isAutoRefreshing ? 'auto-refresh disabled' : 'generator inactive'
      });
      stopGeneratorUpdates();
    }

    return () => {
      console.log('🔄 useEffect cleanup called');
      stopGeneratorUpdates();
    };
  }, [isAutoRefreshing, refreshInterval, isActive]);

  // Initialize auto-refresh on mount
  useEffect(() => {
    // Auto-enable refresh after component mount
    const initTimer = setTimeout(() => {
      console.error('🚨 🔄 Auto-enabling refresh on mount, isActive:', isActive);
      console.log('🔄 Auto-enabling refresh on mount, isActive:', isActive);
      // Force enable auto-refresh regardless of isActive
      console.error('🚨 🔄 Forcing auto-refresh to true');
      console.log('🔄 Forcing auto-refresh to true');
      setIsAutoRefreshing(true);
      
      // Also force fetch once even without generator being active
      console.error('🚨 🔄 Force fetching data on mount');
      fetchRecentEvents();
    }, 1000);
    
    return () => clearTimeout(initTimer);
  }, []);

  // Force auto-refresh when generator becomes active
  useEffect(() => {
    if (isActive && !isAutoRefreshing) {
      console.log('🔄 Generator is active, enabling auto-refresh');
      setIsAutoRefreshing(true);
    }
  }, [isActive, isAutoRefreshing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopGeneratorUpdates();
    };
  }, []);

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant={isActive ? "destructive" : "default"}
            size="sm"
            onClick={handleToggleGenerator}
            disabled={isGenerating}
            className="flex items-center gap-2"
          >
            {isActive ? (
              <>
                <Square className="h-4 w-4" />
                Остановить
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Запустить
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="format-select" className="text-sm font-medium">
            Формат:
          </Label>
          <Select value={format} onValueChange={(value: 'network' | 'opentelemetry' | 'realistic-otel') => setFormat(value)}>
            <SelectTrigger className="w-40" id="format-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="network">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Network Events
                </div>
              </SelectItem>
              <SelectItem value="opentelemetry">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  OpenTelemetry
                </div>
              </SelectItem>
              <SelectItem value="realistic-otel">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Realistic Gateway Flow
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Настройки генератора</h4>
                <p className="text-sm text-muted-foreground">
                  Настройте интервал генерации данных
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="generator-interval">Интервал генерации (мс)</Label>
                <Select value={generatorInterval} onValueChange={setGeneratorInterval}>
                  <SelectTrigger id="generator-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1000">1 секунда</SelectItem>
                    <SelectItem value="2000">2 секунды</SelectItem>
                    <SelectItem value="5000">5 секунд</SelectItem>
                    <SelectItem value="10000">10 секунд</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-2">
          {isActive && (
            <Badge variant="outline" className="flex items-center gap-1">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              Активен
            </Badge>
          )}
          
          {eventCount > 0 && (
            <Badge variant="secondary">
              {eventCount} событий
            </Badge>
          )}
        </div>

        <div className="ml-auto">
          <TimeRangeControls
            onTimeRangeChange={handleTimeRangeChange}
            onIntervalChange={handleIntervalChange}
            onRefreshToggle={handleRefreshToggle}
            isRefreshing={isAutoRefreshing}
            currentInterval={refreshInterval}
          />
        </div>
      </div>
    </div>
  );
}