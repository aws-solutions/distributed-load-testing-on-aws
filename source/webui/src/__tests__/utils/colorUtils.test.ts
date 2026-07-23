// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CLOUDSCAPE_CATEGORICAL_COLORS, getRegionColor, createRegionColorMap } from "../../utils/colorUtils";

describe("colorUtils", () => {
  describe("CLOUDSCAPE_CATEGORICAL_COLORS", () => {
    it("should contain 50 colors", () => {
      expect(CLOUDSCAPE_CATEGORICAL_COLORS).toHaveLength(50);
    });

    it("should contain valid hex color codes", () => {
      CLOUDSCAPE_CATEGORICAL_COLORS.forEach((color) => {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });
  });

  describe("getRegionColor", () => {
    it("should return a consistent color for a region", () => {
      const regions = ["us-east-1", "us-west-2", "eu-west-1"];
      const color1 = getRegionColor("us-east-1", regions);
      const color2 = getRegionColor("us-east-1", regions);
      expect(color1).toBe(color2);
    });

    it("should return different colors for different regions", () => {
      const regions = ["us-east-1", "us-west-2", "eu-west-1"];
      const color1 = getRegionColor("us-east-1", regions);
      const color2 = getRegionColor("us-west-2", regions);
      expect(color1).not.toBe(color2);
    });

    it("should assign colors based on alphabetical sort order", () => {
      const regions = ["us-west-2", "eu-west-1", "us-east-1"];
      // Alphabetical order: eu-west-1, us-east-1, us-west-2
      const euColor = getRegionColor("eu-west-1", regions);
      const usEast = getRegionColor("us-east-1", regions);
      const usWest = getRegionColor("us-west-2", regions);

      expect(euColor).toBe(CLOUDSCAPE_CATEGORICAL_COLORS[0]);
      expect(usEast).toBe(CLOUDSCAPE_CATEGORICAL_COLORS[1]);
      expect(usWest).toBe(CLOUDSCAPE_CATEGORICAL_COLORS[2]);
    });

    it("should handle single region", () => {
      const regions = ["ap-southeast-1"];
      const color = getRegionColor("ap-southeast-1", regions);
      expect(color).toBe(CLOUDSCAPE_CATEGORICAL_COLORS[0]);
    });
  });

  describe("createRegionColorMap", () => {
    it("should create a mapping for all regions", () => {
      const regions = ["us-east-1", "us-west-2", "eu-west-1"];
      const map = createRegionColorMap(regions);

      expect(Object.keys(map)).toHaveLength(3);
      expect(map["us-east-1"]).toBeDefined();
      expect(map["us-west-2"]).toBeDefined();
      expect(map["eu-west-1"]).toBeDefined();
    });

    it("should use getRegionColor for each region", () => {
      const regions = ["us-east-1", "us-west-2"];
      const map = createRegionColorMap(regions);

      expect(map["us-east-1"]).toBe(getRegionColor("us-east-1", regions));
      expect(map["us-west-2"]).toBe(getRegionColor("us-west-2", regions));
    });

    it("should return an empty map for empty regions array", () => {
      const map = createRegionColorMap([]);
      expect(map).toEqual({});
    });
  });
});
