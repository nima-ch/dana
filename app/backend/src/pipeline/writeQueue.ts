import PQueue from "p-queue"

// One serialized queue per topic — concurrent writes to different topics don't block each other
const queues = new Map<string, PQueue>()

function getQueue(topicId: string): PQueue {
  if (!queues.has(topicId)) {
    queues.set(topicId, new PQueue({ concurrency: 1 }))
  }
  return queues.get(topicId)!
}

export async function queuedWrite<T>(
  topicId: string,
  filePath: string,
  mutateFn: (current: T) => T,
  emptyValue: T
): Promise<T> {
  return getQueue(topicId).add(async () => {
    const file = Bun.file(filePath)
    const current: T = (await file.exists()) ? await file.json() as T : emptyValue
    const updated = mutateFn(current)
    await Bun.write(filePath, JSON.stringify(updated, null, 2))
    return updated
  }) as Promise<T>
}

export async function queuedRead<T>(filePath: string, emptyValue: T): Promise<T> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return emptyValue
  return file.json() as Promise<T>
}
