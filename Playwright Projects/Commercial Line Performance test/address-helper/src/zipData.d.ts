declare module './zipData' {
  export const zipToCityState: Record<string, { city: string; state: string }>;
  export const stateToZips: Record<string, string[]>;
}