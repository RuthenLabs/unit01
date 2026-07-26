// Suppress Node.js experimental warnings (like node:sqlite)
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning') return;
  console.warn(warning.stack || warning.message);
});
