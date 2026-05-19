// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { TestStatus } from "../pages/scenarios/constants";
import { computeTaskStatusItem } from "../pages/scenarios/components/TaskStatus";
import { buildPercentageSeries } from "../pages/scenarios/components/RegionProgressIndicator";
import type { TasksPerRegion, TestTaskConfig, TaskStatusItem } from "../pages/scenarios/types";

/** Arbitrary that generates aggregate task counts for a region (describeServices shape). */
const tasksPerRegionArbitrary: fc.Arbitrary<TasksPerRegion> = fc
  .record({
    running: fc.nat({ max: 100 }),
    pending: fc.nat({ max: 100 }),
    desired: fc.nat({ max: 200 }),
  })
  .map((fields) => ({ region: "us-east-1", ...fields }));

/** Arbitrary that generates a valid TaskStatusItem for Property 9. */
const taskStatusItemArbitrary: fc.Arbitrary<TaskStatusItem> = fc
  .record({
    running: fc.nat({ max: 50 }),
    pending: fc.nat({ max: 50 }),
    provisioning: fc.nat({ max: 50 }),
    stopped: fc.nat({ max: 50 }),
    desired: fc.nat({ max: 200 }),
    concurrency: fc.nat({ max: 100 }),
  })
  .map((fields) => ({
    region: "us-east-1",
    ...fields,
    regionStatus: "Provisioning" as const,
  }));

describe("Task Status Computation — Property Tests", () => {
  /**
   * Property 6: Counts are derived correctly from describeServices + taskFailureCount
   *
   * For any TasksPerRegion and taskFailureCount:
   * - running and pending are preserved from the API response
   * - stopped equals taskFailureCount
   * - provisioning equals max(0, desired - running - pending - stopped)
   * - desired equals config.taskCount
   *
   * **Validates: Requirements 3.1, 4.1, 4.2**
   */
  it("Property 6: counts are derived correctly from describeServices + taskFailureCount", () => {
    fc.assert(
      fc.property(
        tasksPerRegionArbitrary,
        fc.nat({ max: 200 }),
        fc.nat({ max: 100 }),
        fc.nat({ max: 50 }),
        (tasksPerRegion, taskCount, concurrency, taskFailureCount) => {
          const testTaskConfig: TestTaskConfig = {
            region: "us-east-1",
            taskCount,
            concurrency,
          };

          const result = computeTaskStatusItem(tasksPerRegion, testTaskConfig, TestStatus.RUNNING, taskFailureCount);

          expect(result.running).toBe(tasksPerRegion.running);
          expect(result.pending).toBe(tasksPerRegion.pending);
          expect(result.stopped).toBe(taskFailureCount);
          expect(result.provisioning).toBe(
            Math.max(0, taskCount - tasksPerRegion.running - tasksPerRegion.pending - taskFailureCount)
          );
          expect(result.desired).toBe(taskCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 7: Region status derivation is correct
   *
   * For any non-negative integers running, stopped, desired where desired > 0:
   * - if stopped > 0 and testStatus is "running" then regionStatus is "Degraded"
   * - if stopped > 0 and testStatus is "cancelling" or "cleaning up" then regionStatus is "Stopping"
   * - else if running === desired then regionStatus is "Ready"
   * - else regionStatus is "Provisioning"
   *
   * **Validates: Requirements 4.3, 4.4, 4.5**
   */
  it("Property 7: region status derivation follows the specification rules", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }).filter((d) => d > 0),
        fc.constantFrom(
          TestStatus.RUNNING,
          TestStatus.CANCELLING,
          TestStatus.CLEANING_UP,
          TestStatus.PROVISIONING,
        ),
        (running, taskFailureCount, desired, testStatus) => {
          const tasksPerRegion: TasksPerRegion = {
            region: "us-east-1",
            running,
            pending: 0,
            desired,
          };
          const testTaskConfig: TestTaskConfig = {
            region: "us-east-1",
            taskCount: desired,
            concurrency: 1,
          };

          const result = computeTaskStatusItem(tasksPerRegion, testTaskConfig, testStatus, taskFailureCount);

          if (taskFailureCount > 0 && testStatus === TestStatus.RUNNING) {
            expect(result.regionStatus).toBe("Degraded");
          } else if (taskFailureCount > 0 && (testStatus === TestStatus.CANCELLING || testStatus === TestStatus.CLEANING_UP)) {
            expect(result.regionStatus).toBe("Stopping");
          } else if (running === desired) {
            expect(result.regionStatus).toBe("Ready");
          } else {
            expect(result.regionStatus).toBe("Provisioning");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 9: Percentage series values are correctly normalized
   *
   * For any TaskStatusItem, each series y-value equals (count / desired) * 100
   * clamped to [0, 100]. When desired is 0, all values are 0.
   *
   * **Validates: Requirements 3.1, 3.5**
   */
  it("Property 9: percentage series values are correctly normalized", () => {
    fc.assert(
      fc.property(taskStatusItemArbitrary, (item) => {
        const series = buildPercentageSeries([item]);

        for (const s of series) {
          const y = s.data[0].y;
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(100);

          if (item.desired > 0) {
            const key = s.title.toLowerCase() as keyof Pick<TaskStatusItem, "running" | "pending" | "provisioning" | "stopped">;
            const expected = Math.min(100, (item[key] / item.desired) * 100);
            expect(y).toBeCloseTo(expected);
          } else {
            expect(y).toBe(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("Task Status Computation — Unit Tests", () => {
  it("all-running edge case: percentage series shows 100% running when running equals desired", () => {
    const allRunningItem: TaskStatusItem = {
      region: "us-east-1",
      running: 5,
      pending: 0,
      provisioning: 0,
      stopped: 0,
      desired: 5,
      concurrency: 10,
      regionStatus: "Ready",
    };

    const series = buildPercentageSeries([allRunningItem]);
    const runningSeries = series.find((s) => s.title === "Running");
    expect(runningSeries?.data[0].y).toBe(100);

    const pendingSeries = series.find((s) => s.title === "Pending");
    expect(pendingSeries?.data[0].y).toBe(0);

    const provisioningSeries = series.find((s) => s.title === "Provisioning");
    expect(provisioningSeries?.data[0].y).toBe(0);

    const stoppedSeries = series.find((s) => s.title === "Stopped");
    expect(stoppedSeries?.data[0].y).toBe(0);
  });

  it("all-running edge case: computeTaskStatusItem returns regionStatus Ready", () => {
    const tasksPerRegion: TasksPerRegion = { region: "us-east-1", running: 5, pending: 0, desired: 5 };
    const testTaskConfig: TestTaskConfig = { region: "us-east-1", taskCount: 5, concurrency: 10 };

    const result = computeTaskStatusItem(tasksPerRegion, testTaskConfig, TestStatus.RUNNING, 0);

    expect(result.running).toBe(5);
    expect(result.pending).toBe(0);
    expect(result.provisioning).toBe(0);
    expect(result.stopped).toBe(0);
    expect(result.desired).toBe(5);
    expect(result.regionStatus).toBe("Ready");
  });

  it("taskFailureCount populates stopped and triggers Degraded status", () => {
    const tasksPerRegion: TasksPerRegion = { region: "us-east-1", running: 7, pending: 0, desired: 10 };
    const testTaskConfig: TestTaskConfig = { region: "us-east-1", taskCount: 10, concurrency: 10 };

    const result = computeTaskStatusItem(tasksPerRegion, testTaskConfig, TestStatus.RUNNING, 3);

    expect(result.running).toBe(7);
    expect(result.stopped).toBe(3);
    expect(result.provisioning).toBe(0);
    expect(result.regionStatus).toBe("Degraded");
  });

  it("provisioning is inferred as the gap between desired and known tasks", () => {
    const tasksPerRegion: TasksPerRegion = { region: "us-east-1", running: 3, pending: 2, desired: 10 };
    const testTaskConfig: TestTaskConfig = { region: "us-east-1", taskCount: 10, concurrency: 10 };

    const result = computeTaskStatusItem(tasksPerRegion, testTaskConfig, TestStatus.PROVISIONING, 0);

    expect(result.provisioning).toBe(5);
    expect(result.regionStatus).toBe("Provisioning");
  });
});
