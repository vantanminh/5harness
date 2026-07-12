import { describe, expect, it } from "vitest";
import {
  detectPackageManager,
  updateCommand,
} from "../src/commands/update.js";

describe("harness update", () => {
  it("detects npm from user-agent", () => {
    const prev = process.env.npm_config_user_agent;
    try {
      process.env.npm_config_user_agent =
        "npm/10.8.2 node/v22.5.0 win32 x64 workspaces/false";
      expect(detectPackageManager()).toBe("npm");
    } finally {
      if (prev !== undefined) {
        process.env.npm_config_user_agent = prev;
      } else {
        delete process.env.npm_config_user_agent;
      }
    }
  });

  it("detects pnpm from user-agent", () => {
    const prev = process.env.npm_config_user_agent;
    try {
      process.env.npm_config_user_agent = "pnpm/9.7.0 npm/? node/v22.5.0 win32 x64";
      expect(detectPackageManager()).toBe("pnpm");
    } finally {
      if (prev !== undefined) {
        process.env.npm_config_user_agent = prev;
      } else {
        delete process.env.npm_config_user_agent;
      }
    }
  });

  it("detects yarn from user-agent", () => {
    const prev = process.env.npm_config_user_agent;
    try {
      process.env.npm_config_user_agent =
        "yarn/4.4.0 npm/? node/v22.5.0 win32 x64";
      expect(detectPackageManager()).toBe("yarn");
    } finally {
      if (prev !== undefined) {
        process.env.npm_config_user_agent = prev;
      } else {
        delete process.env.npm_config_user_agent;
      }
    }
  });

  it("detects bun from user-agent", () => {
    const prev = process.env.npm_config_user_agent;
    try {
      process.env.npm_config_user_agent =
        "bun/1.1.20 npm/? node/v22.5.0 win32 x64";
      expect(detectPackageManager()).toBe("bun");
    } finally {
      if (prev !== undefined) {
        process.env.npm_config_user_agent = prev;
      } else {
        delete process.env.npm_config_user_agent;
      }
    }
  });

  it("honors HARNESS_PM override", () => {
    const prevPM = process.env.HARNESS_PM;
    const prevAgent = process.env.npm_config_user_agent;
    try {
      process.env.HARNESS_PM = "pnpm";
      process.env.npm_config_user_agent =
        "npm/10.8.2 node/v22.5.0 win32 x64 workspaces/false";
      expect(detectPackageManager()).toBe("pnpm");
    } finally {
      if (prevPM !== undefined) {
        process.env.HARNESS_PM = prevPM;
      } else {
        delete process.env.HARNESS_PM;
      }
      if (prevAgent !== undefined) {
        process.env.npm_config_user_agent = prevAgent;
      } else {
        delete process.env.npm_config_user_agent;
      }
    }
  });

  it("returns correct update command for each PM", () => {
    expect(updateCommand("npm")).toEqual({
      cmd: "npm",
      args: ["install", "-g", "5harness@latest"],
    });
    expect(updateCommand("pnpm")).toEqual({
      cmd: "pnpm",
      args: ["add", "-g", "5harness@latest"],
    });
    expect(updateCommand("yarn")).toEqual({
      cmd: "yarn",
      args: ["global", "add", "5harness@latest"],
    });
    expect(updateCommand("bun")).toEqual({
      cmd: "bun",
      args: ["install", "-g", "5harness@latest"],
    });
  });
});
