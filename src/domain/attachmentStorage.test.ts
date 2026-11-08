// ParkCheck - Attachment Storage & Security Tests
// Specification Reference: Phase E, Section 5

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getStorageDriverConfig, saveAttachmentFile, attachmentExists } from "./storageDriver";
import fs from "fs/promises";
import path from "path";

describe("Attachment Storage Driver & Durability", () => {
  const originalEnv = { ...process.env };
  const testComplexId = "test-comp-storage-123";

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    // Clean up test uploads directory
    try {
      const complexUploadDir = path.join(process.cwd(), "uploads", testComplexId);
      await fs.rm(complexUploadDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error if dir didn't exist
    }
  });

  it("Configures local driver by default when S3 credentials are absent", () => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.S3_BUCKET;

    const config = getStorageDriverConfig();
    expect(config.driver).toBe("local");
    expect(config.isConfigured).toBe(true);
    expect(config.isPersistentAcrossRestarts).toBe(true);
    expect(config.storageTarget).toContain("uploads");
  });

  it("Detects S3 driver configuration and flags missing credentials", () => {
    process.env.STORAGE_DRIVER = "s3";
    delete process.env.S3_BUCKET;

    const config = getStorageDriverConfig();
    expect(config.driver).toBe("s3");
    expect(config.isConfigured).toBe(false);
    expect(config.isPersistentAcrossRestarts).toBe(false);
    expect(config.recommendation).toContain("Faltan variables S3");
  });

  it("Saves attachment atomically to disk and creates complex-isolated folder", async () => {
    const testBuffer = Buffer.from("fake-jpeg-image-content-for-testing");
    const originalName = "scratched_bumper.jpg";

    const result = await saveAttachmentFile(testComplexId, originalName, testBuffer);

    expect(result.storageKey).toBeDefined();
    expect(result.storageKey).toContain(testComplexId);
    expect(result.absolutePath).toBeDefined();

    // Verify file exists on disk
    const exists = await attachmentExists(result.storageKey);
    expect(exists).toBe(true);

    // Verify file content matches
    if (result.absolutePath) {
      const savedData = await fs.readFile(result.absolutePath);
      expect(savedData.toString()).toBe("fake-jpeg-image-content-for-testing");
    }
  });

  it("Sanitizes malicious filename characters to prevent path traversal", async () => {
    const testBuffer = Buffer.from("image-content");
    const maliciousName = "../../etc/passwd.png";

    const result = await saveAttachmentFile(testComplexId, maliciousName, testBuffer);

    expect(result.storageKey).toContain(testComplexId);
    expect(result.storageKey).not.toContain("..");
    expect(result.storageKey).toContain("passwd.png");

    const exists = await attachmentExists(result.storageKey);
    expect(exists).toBe(true);
  });
});
