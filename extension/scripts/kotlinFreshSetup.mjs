// Vitest's global setup: the tests import the shared Kotlin rules from generated/kotlin, which must be current.
import { assertKotlinFresh } from './kotlinFresh.mjs';

export default function setup() {
  assertKotlinFresh();
}
