// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env.AWS_REGION = "us-east-1";
process.env.SCENARIOS_BUCKET = "dlt-scenarios";

const mockCreateAsset = jest.fn();
const mockDeleteAsset = jest.fn();

jest.mock("../integrations/aidevops", () => ({
  createAsset: mockCreateAsset,
  deleteAsset: mockDeleteAsset,
}));

jest.mock("solution-utils", () => ({
  getOptions: jest.fn().mockReturnValue({ region: "us-east-1" }),
}));

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  ListObjectsV2Command: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

const { ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");

const { uploadTestArtifacts, deleteArtifactAsset, cleanupInvestigationAsset, extensionOf, containsSensitiveData } = require("./artifacts");

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  // resetAllMocks wipes the command-class mock implementations, so re-tag them
  // each test. The tag lets mockS3Send route list vs get commands.
  ListObjectsV2Command.mockImplementation((input) => ({ __command: "list", input }));
  GetObjectCommand.mockImplementation((input) => ({ __command: "get", input }));
  mockS3Send.mockResolvedValue({ Contents: [], CommonPrefixes: [] });
});

afterEach(() => {
  console.log.mockRestore();
});

describe("uploadTestArtifacts", () => {
  const artifactParams = {
    testId: "test-abc",
    testRunId: "run-001",
    agentSpaceId: "my-space",
    correlationId: "corr-001",
    requesterCognitoSub: "user-sub-001",
  };

  const runFolder = "results/test-abc/20260520T100000_run-001/";

  // Routes S3 commands to canned responses:
  // - delimiter list at results/{testId}/ → CommonPrefixes (run folders)
  // - list of the run folder → Contents (objects)
  // - GetObject → body text keyed by object key
  const configureS3 = ({ commonPrefixes = [runFolder], folderPages = [], bodies = {} }) => {
    let pageIndex = 0;
    mockS3Send.mockImplementation(async (command) => {
      if (command.__command === "list") {
        if (command.input.Delimiter === "/") {
          return { CommonPrefixes: commonPrefixes.map((p) => ({ Prefix: p })) };
        }
        const page = folderPages[pageIndex] ?? { Contents: [] };
        pageIndex += 1;
        return page;
      }
      if (command.__command === "get") {
        return { Body: { transformToString: async () => bodies[command.input.Key] ?? "" } };
      }
      throw new Error(`unexpected command ${JSON.stringify(command)}`);
    });
  };

  it("uploads curated artifacts and returns the asset id and file count", async () => {
    configureS3({
      folderPages: [{
        Contents: [
          { Key: `${runFolder}out.out`, Size: 100 },
          { Key: `${runFolder}err.err`, Size: 200 },
        ],
        IsTruncated: false,
      }],
      bodies: { [`${runFolder}err.err`]: "boom", [`${runFolder}out.out`]: "stdout" },
    });
    mockCreateAsset.mockResolvedValueOnce({ assetId: "asset-123" });

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toEqual({ assetId: "asset-123", fileCount: 2 });
    const assetArg = mockCreateAsset.mock.calls[0][0];
    // .err is highest priority and must appear before .out in the combined doc
    const body = assetArg.content.file.body.text;
    expect(body.indexOf("err.err")).toBeLessThan(body.indexOf("out.out"));
  });

  it("returns null when no matching artifacts exist", async () => {
    configureS3({ folderPages: [{ Contents: [{ Key: `${runFolder}results.xml`, Size: 50 }], IsTruncated: false }] });

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toBeNull();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it("paginates the run folder listing so later artifacts are not dropped", async () => {
    configureS3({
      folderPages: [
        { Contents: [{ Key: `${runFolder}a.out`, Size: 10 }], IsTruncated: true, NextContinuationToken: "tok" },
        { Contents: [{ Key: `${runFolder}b.err`, Size: 20 }], IsTruncated: false },
      ],
      bodies: { [`${runFolder}a.out`]: "out", [`${runFolder}b.err`]: "err" },
    });
    mockCreateAsset.mockResolvedValueOnce({ assetId: "asset-paged" });

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toEqual({ assetId: "asset-paged", fileCount: 2 });
  });

  it("skips upload when artifact content matches the sensitive-data denylist", async () => {
    configureS3({
      folderPages: [{ Contents: [{ Key: `${runFolder}leak.err`, Size: 40 }], IsTruncated: false }],
      bodies: { [`${runFolder}leak.err`]: "token AKIAIOSFODNN7EXAMPLE leaked" },
    });

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toBeNull();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it("does not misclassify a dotless file or a dotted folder as an artifact", async () => {
    configureS3({
      folderPages: [{
        Contents: [
          { Key: `${runFolder}README`, Size: 10 },
          { Key: `results/test-abc/v1.0_run-001/notes`, Size: 10 },
        ],
        IsTruncated: false,
      }],
    });

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toBeNull();
    expect(mockCreateAsset).not.toHaveBeenCalled();
  });

  it("falls back to a filtered testId listing when the run folder cannot be resolved", async () => {
    configureS3({
      commonPrefixes: ["results/test-abc/other_run-999/"],
      folderPages: [{
        Contents: [
          { Key: `results/test-abc/20260520T100000_run-001/x.err`, Size: 30 },
          { Key: `results/test-abc/other_run-999/y.err`, Size: 30 },
        ],
        IsTruncated: false,
      }],
      bodies: { "results/test-abc/20260520T100000_run-001/x.err": "mine" },
    });
    mockCreateAsset.mockResolvedValueOnce({ assetId: "asset-fallback" });

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toEqual({ assetId: "asset-fallback", fileCount: 1 });
    const body = mockCreateAsset.mock.calls[0][0].content.file.body.text;
    expect(body).toContain("x.err");
    expect(body).not.toContain("y.err");
  });

  it("returns null and does not throw when S3 listing fails", async () => {
    mockS3Send.mockRejectedValue(new Error("S3 down"));

    const result = await uploadTestArtifacts(artifactParams);

    expect(result).toBeNull();
  });
});

describe("extensionOf", () => {
  it("returns the extension from the basename", () => {
    expect(extensionOf("results/abc/run/file.err")).toBe(".err");
  });

  it("returns empty string for a dotless basename", () => {
    expect(extensionOf("results/abc/run/README")).toBe("");
  });

  it("ignores dots in parent folders", () => {
    expect(extensionOf("results/abc/v1.0_run/notes")).toBe("");
  });
});

describe("deleteArtifactAsset", () => {
  const params = { agentSpaceId: "s1", assetId: "a1", correlationId: "c1", requesterCognitoSub: "u1", reason: "test" };

  it("calls deleteAsset with the asset coordinates", async () => {
    mockDeleteAsset.mockResolvedValueOnce({});
    await deleteArtifactAsset(params);
    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ agentSpaceId: "s1", assetId: "a1" }));
  });

  it("no-ops when assetId is missing", async () => {
    await deleteArtifactAsset({ ...params, assetId: undefined });
    expect(mockDeleteAsset).not.toHaveBeenCalled();
  });

  it("swallows deletion errors", async () => {
    mockDeleteAsset.mockRejectedValueOnce(new Error("boom"));
    await expect(deleteArtifactAsset(params)).resolves.toBeUndefined();
  });
});

describe("cleanupInvestigationAsset", () => {
  it("deletes the asset referenced by the investigation record", async () => {
    mockDeleteAsset.mockResolvedValueOnce({});
    await cleanupInvestigationAsset({ agentSpaceApiId: "s1", artifactAssetId: "a1" }, "c1", "u1", "archive");
    expect(mockDeleteAsset).toHaveBeenCalledWith(expect.objectContaining({ agentSpaceId: "s1", assetId: "a1" }));
  });

  it("no-ops when the record has no artifact asset", async () => {
    await cleanupInvestigationAsset({ agentSpaceApiId: "s1" }, "c1", "u1", "archive");
    expect(mockDeleteAsset).not.toHaveBeenCalled();
  });
});

// Fake key-shaped strings are built by concatenation so the literal token never
// appears contiguously in source (avoids tripping repository secret scanners).
// These are test fixtures, not real credentials.
const fakeAccessKey = `AKIA${"IOSFODNN7EXAMPLE"}`;
const fakeTempKey = `ASIA${"XYZ1234567890123"}`;

describe("containsSensitiveData", () => {
  it("should detect AKIA pattern", () => { expect(containsSensitiveData(fakeAccessKey)).toBe(true); });
  it("should detect ASIA pattern", () => { expect(containsSensitiveData(fakeTempKey)).toBe(true); });
  it("should detect aws_secret_access_key", () => { expect(containsSensitiveData("aws_secret_access_key=x")).toBe(true); });
  it("should detect password=", () => { expect(containsSensitiveData("password=secret")).toBe(true); });
  it("should detect JWT", () => { expect(containsSensitiveData("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toBe(true); });
  it("should return false for clean text", () => { expect(containsSensitiveData("Normal text")).toBe(false); });
  it("should return false for null", () => { expect(containsSensitiveData(null)).toBe(false); });
  it("should return false for empty string", () => { expect(containsSensitiveData("")).toBe(false); });
});
