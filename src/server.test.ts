import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./helpers.js", async () => {
  const actual =
    await vi.importActual<typeof import("./helpers.js")>("./helpers.js");
  return {
    ...actual,
    log: vi.fn(),
  };
});

const setRequestHandler = vi.fn();
const ServerMock = vi.fn().mockImplementation(() => ({
  setRequestHandler,
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: ServerMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPlanfixServer", () => {
  it("registers request handlers", async () => {
    const { createPlanfixServer, TOOLS } = await import("./server.js");
    const server = createPlanfixServer();
    expect(server).toBeDefined();
    expect(ServerMock).toHaveBeenCalled();
    expect(setRequestHandler).toHaveBeenCalledTimes(2);

    const listHandler = setRequestHandler.mock.calls[0][1];
    const listed = await listHandler();
    // The raw API passthrough is hidden unless PLANFIX_ENABLE_RAW_REQUEST=1.
    expect(listed.tools.map((t: any) => t.name)).toEqual(
      TOOLS.map((t) => t.name).filter((n) => n !== "planfix_request"),
    );
    const byName = (n: string) => listed.tools.find((t: any) => t.name === n);
    expect(byName("planfix_search_task").annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(byName("planfix_update_contact").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName("planfix_upload_file").annotations.readOnlyHint).toBe(false);

    const callHandler = setRequestHandler.mock.calls[1][1];
    const tool = { name: "t", handler: vi.fn(async () => "ok") };
    (TOOLS as any).push(tool);
    const result = await callHandler({ params: { name: "t", arguments: {} } });
    expect(result.structuredContent).toBe("ok");
  });

  it("refuses to call the hidden raw request tool", async () => {
    const { createPlanfixServer } = await import("./server.js");
    createPlanfixServer();
    const callHandler = setRequestHandler.mock.calls[1][1];
    const result = await callHandler({
      params: { name: "planfix_request", arguments: { path: "task/1" } },
    });
    expect(result.structuredContent.error).toMatch(/Handler not found/);
  });
});
