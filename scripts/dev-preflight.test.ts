import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const rootPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; scripts: Record<string, string> };

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "closer-dev-preflight-"));
  const scripts = {
    dev: rootPackage.scripts.dev,
    "db:check": "node task.cjs check",
    "dev:api": "node task.cjs api",
    "dev:web": "node task.cjs web",
  };
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: rootPackage.name, scripts }),
  );
  writeFileSync(
    join(directory, "task.cjs"),
    [
      "const fs = require('node:fs');",
      "const task = process.argv[2];",
      "if (task === 'check') {",
      "  fs.writeFileSync(`${process.env.MARKER_DIR}/check`, 'ran');",
      "  if (process.env.GATE_FAIL === '1') process.exit(1);",
      "} else {",
      "  fs.writeFileSync(`${process.env.MARKER_DIR}/${task}`, 'ran');",
      "}",
    ].join("\n"),
  );
  return directory;
}

function runDev(directory: string, gateFails: boolean) {
  return spawnSync(process.execPath, ["run", "dev"], {
    cwd: directory,
    env: {
      ...process.env,
      GATE_FAIL: gateFails ? "1" : "0",
      MARKER_DIR: directory,
    },
    encoding: "utf8",
    windowsHide: true,
  });
}

function withFixture(run: (directory: string) => void) {
  const directory = createFixture();
  try {
    run(directory);
  } finally {
    const resolved = resolve(directory);
    if (
      resolve(tmpdir()) !== resolved &&
      !resolved.startsWith(`${resolve(tmpdir())}/`) &&
      !resolved.startsWith(`${resolve(tmpdir())}\\`)
    ) {
      throw new Error(`Refusing to remove a path outside the temporary directory: ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true });
  }
}

test("dev stops before launching the API or web process when db:check fails", () => {
  withFixture((directory) => {
    const result = runDev(directory, true);
    expect(result.status).not.toBe(0);
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(directory, "check"), "utf8")).toBe("ran");
    expect(() => readFileSync(join(directory, "api"), "utf8")).toThrow();
    expect(() => readFileSync(join(directory, "web"), "utf8")).toThrow();
  });
});

test("dev launches both processes only after db:check succeeds", () => {
  withFixture((directory) => {
    const result = runDev(directory, false);
    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(directory, "check"), "utf8")).toBe("ran");
    expect(readFileSync(join(directory, "api"), "utf8")).toBe("ran");
    expect(readFileSync(join(directory, "web"), "utf8")).toBe("ran");
  });
});
