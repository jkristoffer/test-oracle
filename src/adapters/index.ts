import { SupportedEcosystem } from "../contracts";
import { nodeAdapter } from "./node/adapter";
import { TestAdapter } from "./types";

const adapters: Partial<Record<SupportedEcosystem, TestAdapter>> = {
  node: nodeAdapter
};

export function getAdapter(ecosystem: string): TestAdapter | undefined {
  return adapters[ecosystem as SupportedEcosystem];
}

export function getAdapterNames(): SupportedEcosystem[] {
  return Object.keys(adapters) as SupportedEcosystem[];
}
