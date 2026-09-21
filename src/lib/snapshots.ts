import type { Snapshot } from './types'

// One gate for both pushed events and RPC replies, including collector restarts.
export function snapshotGate() {
  let generation = -1
  let revision = -1
  return (snapshot: Snapshot) => {
    if (!Number.isSafeInteger(snapshot.collector_generation) || !Number.isSafeInteger(snapshot.revision)) return false
    if (snapshot.collector_generation < generation || (snapshot.collector_generation === generation && snapshot.revision < revision)) return false
    generation = snapshot.collector_generation
    revision = snapshot.revision
    return true
  }
}
