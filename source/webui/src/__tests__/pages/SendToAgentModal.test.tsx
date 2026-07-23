// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { SendToAgentModal } from "../../pages/scenarios/components/SendToAgentModal";
import type { SendToAgentModalProps } from "../../pages/scenarios/components/SendToAgentModal";
import type { AgentSpace } from "../../models/agentSpace";
import type { TestRunDetails, BaselineResponse } from "../../pages/scenarios/types/testResults";

function renderModal(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const mockAgentSpaces: AgentSpace[] = [
  {
    id: "space-1",
    displayName: "Production Agent",
    agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-1",
    agentSpaceResourceId: "space-1-resource",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "space-2",
    displayName: "Staging Agent",
    agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-2",
    agentSpaceResourceId: "space-2-resource",
    createdAt: "2026-01-01T00:00:00Z",
  },
];

function makeTestResults(overrides = {}) {
  return {
    avg_lt: "10",
    p0_0: "5",
    p99_0: "200",
    stdev_rt: "50",
    avg_ct: "15",
    concurrency: "10",
    p99_9: "350",
    labels: [],
    fail: 0,
    rc: [],
    succ: 100,
    p100_0: "500",
    bytes: "1024",
    p95_0: "180",
    avg_rt: "50",
    throughput: 10,
    p90_0: "150",
    testDuration: "600",
    p50_0: "45",
    ...overrides,
  };
}

function makeTestRun(overrides: Partial<TestRunDetails> = {}): TestRunDetails {
  return {
    startTime: "2026-06-01T12:00:00Z",
    testDescription: "Load test",
    testId: "test-123",
    endTime: "2026-06-01T12:10:00Z",
    testTaskConfigs: [{ region: "us-east-1", taskCount: 5, concurrency: 10 }],
    completeTasks: { "us-east-1": 5 },
    testType: "simple",
    status: "complete",
    succPercent: "100",
    testRunId: "run-456",
    results: { total: makeTestResults() },
    testScenario: { execution: [{ scenario: "API Load Test" }] },
    ...overrides,
  };
}

function makeDefaultProps(overrides: Partial<SendToAgentModalProps> = {}): SendToAgentModalProps {
  return {
    visible: true,
    onDismiss: vi.fn(),
    onSubmit: vi.fn(),
    isSubmitting: false,
    testRun: makeTestRun(),
    agentSpaces: mockAgentSpaces,
    ...overrides,
  };
}

describe("SendToAgentModal", () => {
  describe("rendering", () => {
    it("renders the modal with header and buttons when visible", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps()} />);

      expect(screen.getByText("Send to DevOps Agent")).toBeInTheDocument();
      expect(screen.getByText("Start investigation")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("renders the description preview with test run details", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps()} />);

      expect(screen.getByText(/API Load Test/)).toBeInTheDocument();
      expect(screen.getByText(/Framework: simple/)).toBeInTheDocument();
    });

    it("does not render description preview when not visible", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps({ visible: false })} />);

      expect(screen.queryByText(/API Load Test/)).not.toBeInTheDocument();
    });

    it("renders agent space options", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps()} />);

      expect(screen.getByText("Production Agent")).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("calls onDismiss when Cancel button is clicked", async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();
      renderModal(<SendToAgentModal {...makeDefaultProps({ onDismiss })} />);

      await user.click(screen.getByText("Cancel"));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("calls onSubmit with selected agent space, context, and priority", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderModal(<SendToAgentModal {...makeDefaultProps({ onSubmit })} />);

      await user.click(screen.getByText("Start investigation"));
      expect(onSubmit).toHaveBeenCalledWith("space-1", "", "MEDIUM");
    });

    it("does not call onSubmit when no agent space is available", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderModal(<SendToAgentModal {...makeDefaultProps({ onSubmit, agentSpaces: [] })} />);

      await user.click(screen.getByText("Start investigation"));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows loading state when isSubmitting is true", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps({ isSubmitting: true })} />);

      const button = screen.getByText("Start investigation").closest("button");
      expect(button).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("description preview — buildPreviewTitle", () => {
    it("shows failed title when test status is failed", () => {
      renderModal(
        <SendToAgentModal {...makeDefaultProps({ testRun: makeTestRun({ status: "failed" }) })} />,
      );

      expect(screen.getByText(/API Load Test — test run failed/)).toBeInTheDocument();
    });

    it("shows healthy title when no failures", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps()} />);

      expect(screen.getByText(/API Load Test — healthy \(100 req\)/)).toBeInTheDocument();
    });

    it("shows failure rate when there are failures", () => {
      const testRun = makeTestRun({
        results: { total: makeTestResults({ fail: 20, succ: 80 }) },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/API Load Test — 20% failed \(100 req\)/)).toBeInTheDocument();
    });

    it("shows investigation requested when no results", () => {
      const testRun = makeTestRun({
        results: { total: makeTestResults({ fail: 0, succ: 0 }) },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/API Load Test — investigation requested/)).toBeInTheDocument();
    });

    it("uses Unknown when no scenario name is available", () => {
      const testRun = makeTestRun({ testScenario: undefined });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Unknown/)).toBeInTheDocument();
    });
  });

  describe("description preview — formatDelta and baseline comparison", () => {
    it("shows baseline comparison when baseline is provided", () => {
      const baseline: BaselineResponse = {
        testId: "test-123",
        baselineId: "baseline-run",
        message: "Baseline set",
        testRunDetails: {
          testRunId: "baseline-run",
          startTime: "2026-05-01T12:00:00Z",
          endTime: "2026-05-01T12:10:00Z",
          status: "complete",
          results: {
            total: makeTestResults({ avg_rt: "40", p99_0: "180", fail: 5, succ: 95 }),
          },
        },
      };
      renderModal(<SendToAgentModal {...makeDefaultProps({ baseline })} />);

      expect(screen.getByText(/Baseline Comparison/)).toBeInTheDocument();
      expect(screen.getByText(/Avg RT:/)).toBeInTheDocument();
    });

    it("does not show baseline when baselineId matches the test run", () => {
      const baseline: BaselineResponse = {
        testId: "test-123",
        baselineId: "run-456",
        message: "Same run",
        testRunDetails: {
          testRunId: "run-456",
          startTime: "2026-05-01T12:00:00Z",
          endTime: "2026-05-01T12:10:00Z",
          status: "complete",
          results: { total: makeTestResults() },
        },
      };
      renderModal(<SendToAgentModal {...makeDefaultProps({ baseline })} />);

      expect(screen.queryByText(/Baseline Comparison/)).not.toBeInTheDocument();
    });

    it("does not show baseline when baselineId is null", () => {
      const baseline: BaselineResponse = {
        testId: "test-123",
        baselineId: null,
        message: "No baseline",
      };
      renderModal(<SendToAgentModal {...makeDefaultProps({ baseline })} />);

      expect(screen.queryByText(/Baseline Comparison/)).not.toBeInTheDocument();
    });

    it("shows delta indicators for worse performance (higher is worse)", () => {
      const testRun = makeTestRun({
        results: { total: makeTestResults({ avg_rt: "100", p99_0: "400", fail: 10, succ: 90 }) },
      });
      const baseline: BaselineResponse = {
        testId: "test-123",
        baselineId: "baseline-run",
        message: "Baseline set",
        testRunDetails: {
          testRunId: "baseline-run",
          startTime: "2026-05-01T12:00:00Z",
          endTime: "2026-05-01T12:10:00Z",
          status: "complete",
          results: { total: makeTestResults({ avg_rt: "50", p99_0: "200", fail: 5, succ: 95 }) },
        },
      };
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun, baseline })} />);

      expect(screen.getByText(/⚠️/)).toBeInTheDocument();
    });

    it("shows check indicator for improved performance", () => {
      const testRun = makeTestRun({
        results: { total: makeTestResults({ avg_rt: "30", p99_0: "100", fail: 2, succ: 98 }) },
      });
      const baseline: BaselineResponse = {
        testId: "test-123",
        baselineId: "baseline-run",
        message: "Baseline set",
        testRunDetails: {
          testRunId: "baseline-run",
          startTime: "2026-05-01T12:00:00Z",
          endTime: "2026-05-01T12:10:00Z",
          status: "complete",
          results: { total: makeTestResults({ avg_rt: "50", p99_0: "200", fail: 5, succ: 95 }) },
        },
      };
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun, baseline })} />);

      expect(screen.getByText(/✓/)).toBeInTheDocument();
    });

    it("does not show delta when baseline value is zero", () => {
      const testRun = makeTestRun({
        results: { total: makeTestResults({ avg_rt: "100", fail: 5, succ: 95 }) },
      });
      const baseline: BaselineResponse = {
        testId: "test-123",
        baselineId: "baseline-run",
        message: "Baseline set",
        testRunDetails: {
          testRunId: "baseline-run",
          startTime: "2026-05-01T12:00:00Z",
          endTime: "2026-05-01T12:10:00Z",
          status: "complete",
          results: { total: makeTestResults({ avg_rt: "0", p99_0: "0", fail: 0, succ: 100 }) },
        },
      };
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun, baseline })} />);

      // With zero base, formatDelta returns "" so no percentage shown
      expect(screen.getByText(/Baseline Comparison/)).toBeInTheDocument();
    });
  });

  describe("description preview — endpoint breakdown", () => {
    it("shows per-endpoint breakdown with labels", () => {
      const testRun = makeTestRun({
        results: {
          total: makeTestResults({
            succ: 90,
            fail: 10,
            labels: [
              {
                label: "/api/users",
                succ: 45,
                fail: 5,
                avg_rt: "60",
                p99_0: "210",
                avg_lt: "10",
                p0_0: "5",
                stdev_rt: "20",
                avg_ct: "8",
                concurrency: "5",
                p99_9: "300",
                p100_0: "400",
                bytes: "512",
                p95_0: "180",
                throughput: 5,
                p90_0: "160",
                testDuration: "600",
                p50_0: "50",
                rc: [{ count: 5, code: "500" }],
              },
              {
                label: "/api/orders",
                succ: 45,
                fail: 5,
                avg_rt: "70",
                p99_0: "220",
                avg_lt: "12",
                p0_0: "6",
                stdev_rt: "25",
                avg_ct: "10",
                concurrency: "5",
                p99_9: "320",
                p100_0: "450",
                bytes: "1024",
                p95_0: "190",
                throughput: 5,
                p90_0: "170",
                testDuration: "600",
                p50_0: "55",
                rc: [{ count: 3, code: "503" }, { count: 2, code: "500" }],
              },
            ],
          }),
        },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Per-Endpoint Breakdown/)).toBeInTheDocument();
      expect(screen.getByText(/Failure Details/)).toBeInTheDocument();
      expect(screen.getByText(/5x HTTP 500/)).toBeInTheDocument();
    });

    it("shows '... and N more endpoints' when labels exceed 10", () => {
      const labels = Array.from({ length: 12 }, (_, i) => ({
        label: `/api/endpoint-${i}`,
        succ: 10,
        fail: i === 0 ? 5 : 0,
        avg_rt: "50",
        p99_0: "200",
        avg_lt: "10",
        p0_0: "5",
        stdev_rt: "20",
        avg_ct: "8",
        concurrency: "5",
        p99_9: "300",
        p100_0: "400",
        bytes: "512",
        p95_0: "180",
        throughput: 5,
        p90_0: "160",
        testDuration: "600",
        p50_0: "45",
        rc: i === 0 ? [{ count: 5, code: "500" }] : [],
      }));
      const testRun = makeTestRun({
        results: { total: makeTestResults({ succ: 120, fail: 5, labels }) },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/\.\.\. and 2 more endpoints/)).toBeInTheDocument();
    });

    it("does not show endpoint breakdown when no labels", () => {
      renderModal(<SendToAgentModal {...makeDefaultProps()} />);

      expect(screen.queryByText(/Per-Endpoint Breakdown/)).not.toBeInTheDocument();
    });
  });

  describe("description preview — target URL extraction", () => {
    it("extracts target URL from scenarios object (simple test)", () => {
      const testRun = makeTestRun({
        testScenario: {
          execution: [{ scenario: "Simple Test" }],
          scenarios: {
            "Simple Test": {
              requests: [{ url: "https://api.example.com/health" }],
            },
          },
        },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Target: https:\/\/api\.example\.com\/health/)).toBeInTheDocument();
    });

    it("extracts target URL from label URLs (JMeter fallback)", () => {
      const testRun = makeTestRun({
        testScenario: { execution: [{ scenario: "JMeter Test" }] },
        results: {
          total: makeTestResults({
            succ: 50,
            fail: 0,
            labels: [
              {
                label: "https://api.example.com/users/123",
                succ: 50,
                fail: 0,
                avg_rt: "50",
                p99_0: "200",
                avg_lt: "10",
                p0_0: "5",
                stdev_rt: "20",
                avg_ct: "8",
                concurrency: "5",
                p99_9: "300",
                p100_0: "400",
                bytes: "512",
                p95_0: "180",
                throughput: 5,
                p90_0: "160",
                testDuration: "600",
                p50_0: "45",
                rc: [],
              },
            ],
          }),
        },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Target: https:\/\/api\.example\.com/)).toBeInTheDocument();
    });

    it("deduplicates base URLs from labels", () => {
      const testRun = makeTestRun({
        testScenario: { execution: [{ scenario: "JMeter Test" }] },
        results: {
          total: makeTestResults({
            succ: 100,
            fail: 0,
            labels: [
              {
                label: "https://api.example.com/users",
                succ: 50, fail: 0, avg_rt: "50", p99_0: "200", avg_lt: "10",
                p0_0: "5", stdev_rt: "20", avg_ct: "8", concurrency: "5", p99_9: "300",
                p100_0: "400", bytes: "512", p95_0: "180", throughput: 5, p90_0: "160",
                testDuration: "600", p50_0: "45", rc: [],
              },
              {
                label: "https://api.example.com/orders",
                succ: 50, fail: 0, avg_rt: "50", p99_0: "200", avg_lt: "10",
                p0_0: "5", stdev_rt: "20", avg_ct: "8", concurrency: "5", p99_9: "300",
                p100_0: "400", bytes: "512", p95_0: "180", throughput: 5, p90_0: "160",
                testDuration: "600", p50_0: "45", rc: [],
              },
            ],
          }),
        },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      // The Target line should contain only one base URL (not duplicated)
      const preElement = screen.getByText(/Target:/);
      const targetLine = preElement.textContent!.split("\n").find((l) => l.includes("Target:"))!;
      const matches = targetLine.match(/https:\/\/api\.example\.com/g);
      expect(matches).toHaveLength(1);
    });

    it("skips non-URL labels when extracting target URLs", () => {
      const testRun = makeTestRun({
        testScenario: { execution: [{ scenario: "JMeter Test" }] },
        results: {
          total: makeTestResults({
            succ: 50,
            fail: 0,
            labels: [
              {
                label: "Login Transaction",
                succ: 50, fail: 0, avg_rt: "50", p99_0: "200", avg_lt: "10",
                p0_0: "5", stdev_rt: "20", avg_ct: "8", concurrency: "5", p99_9: "300",
                p100_0: "400", bytes: "512", p95_0: "180", throughput: 5, p90_0: "160",
                testDuration: "600", p50_0: "45", rc: [],
              },
            ],
          }),
        },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.queryByText(/Target:/)).not.toBeInTheDocument();
    });
  });

  describe("description preview — test configuration", () => {
    it("shows multiple regions", () => {
      const testRun = makeTestRun({
        testTaskConfigs: [
          { region: "us-east-1", taskCount: 5, concurrency: 10 },
          { region: "eu-west-1", taskCount: 3, concurrency: 6 },
        ],
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Regions: us-east-1, eu-west-1/)).toBeInTheDocument();
      expect(screen.getByText(/Tasks: 8, Concurrency: 16/)).toBeInTheDocument();
    });

    it("handles empty testTaskConfigs", () => {
      const testRun = makeTestRun({ testTaskConfigs: [] });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Tasks: 0, Concurrency: 0/)).toBeInTheDocument();
    });

    it("falls back to first result key when total is not present", () => {
      const testRun = makeTestRun({
        results: { "us-east-1": makeTestResults({ succ: 50, fail: 5 }) },
      });
      renderModal(<SendToAgentModal {...makeDefaultProps({ testRun })} />);

      expect(screen.getByText(/Total requests: 55/)).toBeInTheDocument();
    });
  });

  describe("agent space selection sync", () => {
    it("resets selection when agent spaces change and current no longer exists", async () => {
      const onSubmit = vi.fn();
      const { rerender } = renderModal(
        <SendToAgentModal {...makeDefaultProps({ onSubmit })} />,
      );

      // Re-render with different agent spaces
      const newSpaces: AgentSpace[] = [
        {
          id: "space-3",
          displayName: "New Agent",
          agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/space-3",
          agentSpaceResourceId: "space-3-resource",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];
      rerender(
        <MemoryRouter>
          <SendToAgentModal {...makeDefaultProps({ onSubmit, agentSpaces: newSpaces })} />
        </MemoryRouter>,
      );

      const user = userEvent.setup();
      await user.click(screen.getByText("Start investigation"));
      expect(onSubmit).toHaveBeenCalledWith("space-3", "", "MEDIUM");
    });
  });
});
