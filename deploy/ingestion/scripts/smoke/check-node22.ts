const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (major !== 22) {
  process.stderr.write(
    [
      `[smoke] Node 22 LTS is required for local smoke runs.`,
      `[smoke] Current Node version: ${process.version}`,
      `[smoke] Run "nvm use" from the repository root, or install Node 22 first.`,
      `[smoke] This avoids Node 25 TimeoutNegativeWarning noise from kafkajs internals.`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write(`[smoke] Node ${process.version} baseline confirmed.\n`);
