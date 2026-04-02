export async function test() {
  try {
    const core = await import("@polyglot/core") as any;
    if (typeof core.triggerAsyncValidation === 'function') {
      core.triggerAsyncValidation({});
    }
  } catch {
    // skip
  }
}
