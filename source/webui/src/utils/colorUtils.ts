// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cloudscape Design System Generic Categorical Palette (50 colors)
 * Colors are ordered for optimal visual distinction when used together
 * Source: https://cloudscape.design/foundation/visual-foundation/data-vis-colors/#generic-categorical-palette
 */
export const CLOUDSCAPE_CATEGORICAL_COLORS = [
  '#688ae8', // charts-blue-2-300
  '#c33d69', // charts-pink-500
  '#2ea597', // charts-teal-300
  '#8456ce', // charts-purple-500
  '#e07941', // charts-orange-300
  '#3759ce', // charts-blue-2-600
  '#962249', // charts-pink-800
  '#096f64', // charts-teal-600
  '#5c2e91', // charts-purple-800
  '#cc5f21', // charts-orange-400
  '#1f4788', // charts-blue-2-800
  '#da7596', // charts-pink-300
  '#40bfa9', // charts-teal-400
  '#a783e1', // charts-purple-300
  '#f89256', // charts-orange-600
  '#5978e3', // charts-blue-2-400
  '#ce567c', // charts-pink-400
  '#1c8e81', // charts-teal-400
  '#9b6de8', // charts-purple-400
  '#e6a157', // charts-orange-500
  '#4a67d6', // charts-blue-2-500
  '#b8396b', // charts-pink-600
  '#018977', // charts-teal-500
  '#7c4dbd', // charts-purple-600
  '#d67c3b', // charts-orange-700
  '#6384f5', // charts-blue-2-400 (variant)
  '#d56889', // charts-pink-400 (variant)
  '#009d89', // charts-teal-400 (variant)
  '#8d59de', // charts-purple-300 (variant)
  '#c55305', // charts-orange-300 (variant)
  '#8ea9ff', // charts-blue-2-600 (variant)
  '#ffb0c8', // charts-pink-800 (variant)
  '#5dd6c6', // charts-teal-200
  '#c9a9f5', // charts-purple-200
  '#ffb380', // charts-orange-200
  '#486de8', // charts-blue-2-300 (dark mode)
  '#e07f9d', // charts-pink-500 (dark mode)
  '#40d4c2', // charts-teal-300 (dark mode)
  '#b088f5', // charts-purple-500 (dark mode)
  '#ff9c5a', // charts-orange-300 (dark mode)
  '#7a9eff', // charts-blue-2-500 (dark mode)
  '#ff8fb3', // charts-pink-400 (dark mode)
  '#2db5a5', // charts-teal-400 (dark mode)
  '#9f73e8', // charts-purple-400 (dark mode)
  '#ffab6b', // charts-orange-400 (dark mode)
  '#5c85ff', // charts-blue-2-400 (dark mode)
  '#ff7aa0', // charts-pink-300 (dark mode)
  '#1aa394', // charts-teal-500 (dark mode)
  '#8b5ee8', // charts-purple-600 (dark mode)
  '#ff9650', // charts-orange-500 (dark mode)
];

/**
 * Maps a region name to a consistent color from the Cloudscape categorical palette
 * @param region - The region name (e.g., 'us-east-1', 'us-west-2')
 * @param allRegions - Array of all regions to ensure consistent ordering
 * @returns Hex color string
 */
export function getRegionColor(region: string, allRegions: string[]): string {
  // Sort regions alphabetically to ensure consistent color assignment
  const sortedRegions = [...allRegions].sort();
  const regionIndex = sortedRegions.indexOf(region);
  
  return CLOUDSCAPE_CATEGORICAL_COLORS[regionIndex];
}

/**
 * Creates a color mapping object for all regions
 * @param regions - Array of region names
 * @returns Object mapping region names to colors
 */
export function createRegionColorMap(regions: string[]): Record<string, string> {
  const colorMap: Record<string, string> = {};
  
  regions.forEach((region) => {
    colorMap[region] = getRegionColor(region, regions);
  });
  
  return colorMap;
}
