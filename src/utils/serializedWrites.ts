/** Run persistence jobs in submission order, even if a previous job fails. */
export function createSerializedWriter<T>(persist: (value: T) => Promise<void>) {
  let tail: Promise<void> = Promise.resolve()
  return (value: T): Promise<void> => {
    const write = tail.catch(() => {}).then(() => persist(value))
    tail = write
    return write
  }
}
