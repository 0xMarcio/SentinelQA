export interface VisualComparisonResult {
  totalPixels: number;
  diffPixels: number;
  diffPercentage: number;
  passed: boolean;
}

export function evaluateVisualThreshold(totalPixels: number, diffPixels: number, thresholdPercentage: number): VisualComparisonResult {
  const diffPercentage = totalPixels <= 0 ? 0 : (diffPixels / totalPixels) * 100;
  return {
    totalPixels,
    diffPixels,
    diffPercentage,
    passed: diffPercentage <= thresholdPercentage
  };
}

