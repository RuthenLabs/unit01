const ACTIONS = [
  "Quantum-entangling", "Refactoring", "Disentangling", "Hyper-indexing", "Slicing",
  "Optimizing", "Recalibrating", "Warming up", "Garbage-collecting", "Transpiling",
  "Polishing", "De-optimizing", "Jitting", "Bootstrapping", "Recursively searching",
  "Synthesizing", "Hydrating", "Dehydrating", "Hot-reloading", "Re-rendering",
  "Destructuring", "Parsing", "Compiling", "Decompiling", "De-serializing",
  "Garbage collecting", "Asynchronously resolving", "Micro-optimizing", "Over-engineering"
];

const SUBJECTS = [
  "flux capacitor", "AST nodes", "recursion loops", "callbacks", "arrays",
  "garbage collector", "cold starts", "rust compiler", "carbon footprint", "monads",
  "closures", "pointer addresses", "V8 engine", "webpack configs", "node_modules folder",
  "git branches", "semicolons", "async/await promises", "stack traces", "dangling pointers",
  "memory leaks", "TCP packets", "CSS layouts", "z-indexes", "dapp connections",
  "B-Trees", "dependency trees", "event loop ticks", "git commits"
];

const SUFFIXES = [
  "with extreme prejudice", "using rust-like speed", "to prevent memory leaks",
  "to maximize carbon efficiency", "in the background", "while drinking coffee",
  "for the 5th time today", "under strict sandbox rules", "using deep reinforcement learning",
  "via local Ollama inference", "in 4D hyperspace", "without any external dependencies",
  "for solo devs", "to satisfy the senior lead", "because YAGNI", "to prevent merge conflicts",
  "with zero-dependency packages", "just to see if it compiles"
];

export function getRandomGoofyVerb(): string {
  const a = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  const s = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
  const suf = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
  return `${a} ${s} ${suf}...`;
}
