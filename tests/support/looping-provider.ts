import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "../../src/provider.js";

export class LoopingProvider implements LlmProvider {
  private readonly response: LlmResponse;
  private readonly seenRequests: LlmRequest[] = [];

  constructor(response: LlmResponse) {
    this.response = response;
  }

  get requests(): readonly LlmRequest[] {
    return this.seenRequests;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.seenRequests.push(request);
    return this.response;
  }
}
