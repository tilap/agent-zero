export interface SteeringSource {
  /** Return and clear whatever text is pending; called once per round. */
  drain(): readonly string[];
}
