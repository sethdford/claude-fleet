/**
 * Ring Buffer — O(1) fixed-size FIFO buffer
 * Replaces Array.shift() which is O(n) for time-series data.
 */

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    const index = (this.head + this.count) % this.capacity;
    if (this.count === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.count++;
    }
    this.buffer[index] = item;
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity]!);
    }
    return result;
  }

  get length(): number {
    return this.count;
  }
}
