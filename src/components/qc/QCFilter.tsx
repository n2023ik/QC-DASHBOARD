import { useState, useMemo } from "react";
import { Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export type TimeRangeType = "all" | "24h" | "7d" | "month" | "custom";

export interface QCFilterState {
  timeRange: TimeRangeType;
  customFromDate?: Date;
  customToDate?: Date;
  versions: string[];
}

interface QCFilterProps {
  state: QCFilterState;
  onChange: (state: QCFilterState) => void;
  availableVersions: string[];
}

const TIME_RANGE_OPTIONS: { label: string; value: TimeRangeType; description?: string }[] = [
  { label: "All Time", value: "all" },
  { label: "Last 24 Hours", value: "24h" },
  { label: "Last 7 Days", value: "7d" },
  { label: "Last Month", value: "month" },
  { label: "Custom Range", value: "custom" },
];

export function QCFilter({ state, onChange, availableVersions }: QCFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleTimeRangeChange = (range: TimeRangeType) => {
    onChange({
      ...state,
      timeRange: range,
      ...(range !== "custom" && { customFromDate: undefined, customToDate: undefined }),
    });
  };

  const handleVersionToggle = (version: string) => {
    const newVersions = state.versions.includes(version)
      ? state.versions.filter((v) => v !== version)
      : [...state.versions, version];
    onChange({ ...state, versions: newVersions });
  };

  const handleClearFilters = () => {
    onChange({
      timeRange: "all",
      versions: [],
      customFromDate: undefined,
      customToDate: undefined,
    });
  };

  const isFiltered = state.timeRange !== "all" || state.versions.length > 0;

  const formatDate = (date: Date | undefined) => {
    if (!date) return "";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "gap-2",
            isFiltered && "bg-secondary border-info text-info"
          )}
        >
          <Calendar className="h-4 w-4" />
          Filters
          {isFiltered && <span className="h-2 w-2 rounded-full bg-info" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-80 p-0 max-h-96 overflow-y-auto">
        <div className="divide-y divide-border">
          {/* Time Range Section */}
          <div className="space-y-3 p-4">
            <div className="text-sm font-semibold">Time Range</div>
            <div className="space-y-2">
              {TIME_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleTimeRangeChange(option.value)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm rounded-md transition-colors",
                    state.timeRange === option.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-secondary"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* Custom Date Range */}
            {state.timeRange === "custom" && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <Input
                    type="date"
                    value={state.customFromDate?.toISOString().split("T")[0] || ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        onChange({
                          ...state,
                          customFromDate: new Date(e.target.value + "T00:00:00"),
                        });
                      }
                    }}
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <Input
                    type="date"
                    value={state.customToDate?.toISOString().split("T")[0] || ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        onChange({
                          ...state,
                          customToDate: new Date(e.target.value + "T23:59:59"),
                        });
                      }
                    }}
                    className="mt-1 text-sm"
                  />
                </div>
                {state.customFromDate && state.customToDate && (
                  <div className="text-xs text-muted-foreground">
                    {formatDate(state.customFromDate)} → {formatDate(state.customToDate)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Version Filter Section */}
          {availableVersions.length > 0 && (
            <div className="space-y-3 p-4">
              <div className="text-sm font-semibold">Device Version</div>
              <div className="space-y-2">
                {availableVersions.map((version) => (
                  <label key={version} className="flex items-center gap-2 cursor-pointer hover:bg-secondary p-2 rounded transition-colors">
                    <Checkbox
                      checked={state.versions.includes(version)}
                      onCheckedChange={() => handleVersionToggle(version)}
                    />
                    <span className="text-sm">{version || "(No version)"}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Clear Filters */}
          {isFiltered && (
            <div className="p-4">
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleClearFilters}
              >
                <X className="h-4 w-4" />
                Clear All Filters
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function getTimeRangeMs(timeRange: TimeRangeType, customFrom?: Date, customTo?: Date): { from: number; to: number } {
  const now = Date.now();
  const to = now;

  switch (timeRange) {
    case "all":
      return { from: 0, to: Number.MAX_SAFE_INTEGER };
    case "24h":
      return { from: now - 24 * 60 * 60 * 1000, to };
    case "7d":
      return { from: now - 7 * 24 * 60 * 60 * 1000, to };
    case "month":
      return { from: now - 30 * 24 * 60 * 60 * 1000, to };
    case "custom":
      return {
        from: customFrom?.getTime() || now - 24 * 60 * 60 * 1000,
        to: customTo?.getTime() || now,
      };
    default:
      return { from: 0, to: Number.MAX_SAFE_INTEGER };
  }
}

export function filterDevices(
  devices: any[],
  filterState: QCFilterState
) {
  const { from, to } = getTimeRangeMs(
    filterState.timeRange,
    filterState.customFromDate,
    filterState.customToDate
  );

  return devices.filter((device) => {
    // Version filter - apply first (more common to filter by version)
    const isVersionMatch = filterState.versions.length === 0 || filterState.versions.includes(device.version || "");
    if (!isVersionMatch) return false;

    // Time range filter - only apply if we have valid timestamps
    const ts = toTimestamp(device.actionAt ?? device.endTime ?? device.startTime);
    
    // If time filtering is disabled, include every row.
    if (filterState.timeRange === "all") return true;

    // If device has no timestamp, include it (don't filter out unknown devices)
    if (!ts || ts === 0) return true;
    
    // If device has timestamp, check if it's in range
    const isInTimeRange = ts >= from && ts <= to;
    return isInTimeRange;
  });
}

function toTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}
