import { ZodError } from "zod";

export function readToolSuccess<T>(data: T, roomVersion: number, message: string) {
  return {
    ok: true as const,
    data,
    roomVersion,
    message,
  };
}

export async function executeToolSafely(
  execute: () => unknown | Promise<unknown>,
  getRoomVersion: () => number,
): Promise<string> {
  try {
    return JSON.stringify(await execute());
  } catch (error) {
    if (error instanceof ZodError) {
      return JSON.stringify({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The tool arguments are invalid.",
          recovery: "Correct the arguments to match the registered input schema and retry.",
        },
        roomVersion: getRoomVersion(),
      });
    }
    return JSON.stringify({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The tool could not complete safely.",
        recovery: "Read the latest meeting context, then retry if the action is still appropriate.",
      },
      roomVersion: getRoomVersion(),
    });
  }
}
