export interface LLMProvider {
  readonly name: string;
  generate(prompt: string): Promise<string>;
}
